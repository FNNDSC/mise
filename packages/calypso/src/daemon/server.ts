/**
 * @file The CALYPSO daemon: a WebSocket host over one engine, with a session
 * bus.
 *
 * The daemon binds the loopback interface only and hosts a single hosted
 * engine. A surface attaches with the contract version and the attach token
 * (compared in constant time); once attached it drives the engine with
 * `execute` and `complete` messages and receives `result` and completion
 * replies. Command execution is serialized per connection — shell semantics,
 * and what keeps each command's error boundary correct.
 *
 * All attached surfaces share one session. A **session bus** broadcasts every
 * result envelope to the *other* attached surfaces (tagged with the surface
 * that produced it), so a command issued in one surface is immediately
 * visible in the rest. A bounded **scrollback** ring buffer of recent
 * envelopes is replayed to an attaching surface so it does not join blind;
 * scrollback is presentation, not truth — a daemon restart loses it, which is
 * correct, and the durable record is an opt-in transcript materialized to
 * CUBE.
 *
 * CUBE credentials never cross the wire: the engine the daemon hosts holds its
 * own CUBE session, established by the launcher exactly as the CLI does;
 * surfaces authenticate to the daemon, not to CUBE.
 *
 * @module
 */
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { HostedEngine, CompletionResult } from './engine.js';
import { token_matches } from './token.js';
import { CONTRACT_VERSION } from '../protocol/version.js';
import { clientMessage_parse, attach_parse } from '../protocol/validate.js';
import type { ServerMessage, executeMessageSchema, completeRequestSchema, ProgressEvent, PromptContext } from '../protocol/messages.js';
import type { z } from 'zod';
import type { CommandEnvelope } from '@fnndsc/cumin';

type ExecuteMessage = z.infer<typeof executeMessageSchema>;
type CompleteRequest = z.infer<typeof completeRequestSchema>;

/** An attached surface: its socket and the id it is tagged with on the bus. */
interface Surface {
  socket: WebSocket;
  id: string;
}

/** One scrollback entry: an envelope and the surface that produced it. */
interface SessionEntry {
  surface: string;
  envelope: CommandEnvelope;
}

/** Promise callbacks for one pipeline segment executing on a surface. */
interface PendingPipe {
  resolve: (output: Buffer) => void;
  reject: (error: Error) => void;
}

/** The result of a surface's local edit, returned by {@link CalypsoDaemon.edit_current}. */
export interface EditOutcome {
  content: string;
  changed: boolean;
}

/** The default number of envelopes retained for scrollback replay. */
const SCROLLBACK_DEFAULT: number = 200;

/**
 * Options for creating a daemon.
 *
 * @property engine - The engine to host.
 * @property token - The attach token a surface must present.
 * @property port - The port to bind; 0 (default) picks an ephemeral port.
 * @property host - The interface to bind; loopback (`127.0.0.1`) by default.
 * @property scrollbackSize - How many recent envelopes to retain for replay
 *   to an attaching surface; defaults to 200.
 * @property promptProvider - Supplies the current session's prompt context,
 *   which the daemon pushes to surfaces after each command and on attach; each
 *   surface renders it with its own theme. Omitted when a host does not push a
 *   prompt (e.g. tests).
 */
export interface DaemonOptions {
  engine: HostedEngine;
  token: string;
  port?: number;
  host?: string;
  scrollbackSize?: number;
  promptProvider?: () => PromptContext | Promise<PromptContext>;
}

/**
 * A WebSocket daemon hosting one engine for attached surfaces, with a session
 * bus broadcasting activity across them.
 */
export class CalypsoDaemon {
  private readonly engine: HostedEngine;
  private readonly token: string;
  private readonly port: number;
  private readonly host: string;
  private readonly scrollbackSize: number;
  private readonly promptProvider: (() => PromptContext | Promise<PromptContext>) | undefined;
  /** The one session all surfaces share; returned in each attach ack. */
  private readonly sessionId: string = randomBytes(8).toString('hex');
  private readonly surfaces: Set<Surface> = new Set<Surface>();
  private readonly scrollback: SessionEntry[] = [];
  private wss: WebSocketServer | null = null;
  /**
   * Execution is serialized across the whole session (one foreground command
   * at a time), so a prompt raised mid-command has one unambiguous surface to
   * ask — the one running the current command.
   */
  private queue: Promise<void> = Promise.resolve();
  private currentOrigin: Surface | null = null;
  private currentId: string | null = null;
  private readonly pendingPrompts: Map<string, (answer: string) => void> = new Map<string, (answer: string) => void>();
  private promptSeq: number = 0;
  private readonly pendingPipes: Map<string, PendingPipe> = new Map<string, PendingPipe>();
  private pipeSeq: number = 0;
  private readonly pendingEdits: Map<string, (result: EditOutcome) => void> = new Map<string, (result: EditOutcome) => void>();
  private editSeq: number = 0;

  /**
   * @param options - The engine to host, the attach token, the bind address,
   *   and the scrollback size.
   */
  constructor(options: DaemonOptions) {
    this.engine = options.engine;
    this.token = options.token;
    this.port = options.port ?? 0;
    this.host = options.host ?? '127.0.0.1';
    this.scrollbackSize = options.scrollbackSize ?? SCROLLBACK_DEFAULT;
    this.promptProvider = options.promptProvider;
  }

  /**
   * Starts listening.
   *
   * @returns The bound port (useful when an ephemeral port was requested).
   */
  public start(): Promise<number> {
    return new Promise((resolve: (port: number) => void, reject: (err: Error) => void) => {
      const wss: WebSocketServer = new WebSocketServer({ host: this.host, port: this.port });
      wss.on('listening', () => resolve((wss.address() as AddressInfo).port));
      wss.on('error', reject);
      wss.on('connection', (socket: WebSocket) => this.connection_handle(socket));
      this.wss = wss;
    });
  }

  /**
   * Stops listening and closes all connections.
   *
   * @returns A promise resolving when the server has closed.
   */
  public stop(): Promise<void> {
    return new Promise((resolve: () => void) => {
      if (!this.wss) {
        resolve();
        return;
      }
      for (const client of this.wss.clients) {
        client.terminate();
      }
      this.wss.close(() => resolve());
      this.wss = null;
    });
  }

  /**
   * Handles one surface connection: an attach handshake, then serialized
   * command dispatch, with the surface removed from the bus on close.
   *
   * @param socket - The connected surface.
   */
  private connection_handle(socket: WebSocket): void {
    let surface: Surface | null = null;

    socket.on('message', (data: RawData) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch (err: unknown) {
        const message: string = err instanceof Error ? err.message : String(err);
        this.send(socket, { type: 'error', reason: `malformed JSON: ${message}` });
        return;
      }

      if (!surface) {
        surface = this.attach_handle(socket, parsed);
        return;
      }

      const message = clientMessage_parse(parsed);
      if (!message.ok || message.value === undefined) {
        this.send(socket, { type: 'error', reason: message.error ?? 'invalid message' });
        return;
      }
      const value = message.value;
      const attached: Surface = surface;
      if (value.type === 'execute') {
        // One shared queue: commands from every surface run one at a time.
        this.queue = this.queue.then(() => this.execute_run(attached, value));
      } else if (value.type === 'complete') {
        void this.complete_run(socket, value);
      } else if (value.type === 'promptAnswer') {
        this.promptAnswer_settle(value.promptId, value.answer);
      } else if (value.type === 'pipeResult') {
        this.pipeResult_settle(value.pipeId, value.output);
      } else if (value.type === 'pipeError') {
        this.pipeError_settle(value.pipeId, value.reason);
      } else if (value.type === 'editResult') {
        this.editResult_settle(value.editId, { content: value.content, changed: value.changed });
      } else {
        this.send(socket, { type: 'error', reason: 'already attached' });
      }
    });

    socket.on('close', () => {
      if (surface) {
        this.surfaces.delete(surface);
      }
    });
  }

  /**
   * Validates an attach handshake: contract version, then constant-time
   * token check. On success the surface is acknowledged, registered on the
   * bus, and replayed the scrollback so it does not join blind; on failure it
   * is told why and disconnected.
   *
   * @param socket - The connecting surface.
   * @param raw - The first message received.
   * @returns The registered surface, or null when the attach was refused.
   */
  private attach_handle(socket: WebSocket, raw: unknown): Surface | null {
    const attach = attach_parse(raw);
    if (!attach.ok || attach.value === undefined) {
      this.send(socket, { type: 'error', reason: attach.error ?? 'invalid attach' });
      socket.close();
      return null;
    }
    if (!token_matches(this.token, attach.value.token)) {
      this.send(socket, { type: 'error', reason: 'invalid token' });
      socket.close();
      return null;
    }
    // Each connection is a distinct surface (its own bus tag); all attach to
    // the one shared session returned in the ack.
    const surface: Surface = { socket, id: randomBytes(8).toString('hex') };
    this.surfaces.add(surface);
    this.send(socket, { type: 'attached', session: this.sessionId, protocolVersion: CONTRACT_VERSION });
    this.scrollback_replay(socket);
    // The newcomer shows the right prompt immediately, before any command.
    void this.promptline_push(surface);
    return surface;
  }

  /**
   * Renders the current prompt (when the host supplies a provider) and pushes
   * it to a surface, or to all surfaces when none is given. Called after each
   * command — the context may have changed — and on attach.
   *
   * @param target - The surface to push to; omitted to push to all.
   */
  private async promptline_push(target?: Surface): Promise<void> {
    if (!this.promptProvider) {
      return;
    }
    const context: PromptContext = await this.promptProvider();
    if (target) {
      this.send(target.socket, { type: 'promptline', context });
      return;
    }
    for (const surface of this.surfaces) {
      this.send(surface.socket, { type: 'promptline', context });
    }
  }

  /**
   * Replays the retained scrollback to a freshly attached surface as session
   * events, so it arrives seeing recent activity rather than blank.
   *
   * @param socket - The surface to replay to.
   */
  private scrollback_replay(socket: WebSocket): void {
    for (const entry of this.scrollback) {
      this.send(socket, { type: 'session', surface: entry.surface, envelope: entry.envelope });
    }
  }

  /**
   * Records an envelope in scrollback (trimming to the retention bound) and
   * broadcasts it to every attached surface except the one that produced it,
   * which already received it as the correlated `result`.
   *
   * @param origin - The surface that produced the envelope.
   * @param envelope - The envelope to publish.
   */
  private bus_publish(origin: Surface, envelope: CommandEnvelope): void {
    this.scrollback.push({ surface: origin.id, envelope });
    if (this.scrollback.length > this.scrollbackSize) {
      this.scrollback.splice(0, this.scrollback.length - this.scrollbackSize);
    }
    for (const surface of this.surfaces) {
      if (surface !== origin) {
        this.send(surface.socket, { type: 'session', surface: origin.id, envelope });
      }
    }
  }

  /**
   * Runs one execute request: replies to the requester with the result, and
   * publishes each envelope to the session bus.
   *
   * @param origin - The surface that submitted the request.
   * @param message - The execute request.
   */
  private async execute_run(origin: Surface, message: ExecuteMessage): Promise<void> {
    // The command runs with this surface as the prompt target, so any prompt
    // the engine raises is asked of the surface that submitted the command.
    this.currentOrigin = origin;
    this.currentId = message.id;
    try {
      const envelopes: CommandEnvelope[] = await this.engine.line_execute(message.line);
      this.send(origin.socket, { type: 'result', id: message.id, envelopes });
      for (const envelope of envelopes) {
        this.bus_publish(origin, envelope);
      }
    } catch (err: unknown) {
      const reason: string = err instanceof Error ? err.message : String(err);
      this.send(origin.socket, { type: 'error', id: message.id, reason });
    } finally {
      this.currentOrigin = null;
      this.currentId = null;
    }
    // The command may have changed session context (cwd, connection); push the
    // refreshed prompt to every surface.
    await this.promptline_push();
  }

  /**
   * Raises a prompt on the surface running the current command, returning its
   * answer. The host installs an engine-side input broker that calls this; the
   * engine therefore prompts through the wire without knowing the transport.
   *
   * @param message - The prompt text to show.
   * @param hidden - Whether to request no-echo entry (a password).
   * @returns The surface's answer.
   * @throws {Error} When no command is executing (nothing to prompt for) or the
   *   surface disconnects before answering.
   */
  public prompt_current(message: string, hidden: boolean): Promise<string> {
    const origin: Surface | null = this.currentOrigin;
    if (!origin) {
      return Promise.reject(new Error('no active command to prompt for'));
    }
    const promptId: string = `p${this.promptSeq++}`;
    return new Promise((resolve: (answer: string) => void, reject: (err: Error) => void) => {
      this.pendingPrompts.set(promptId, resolve);
      const onClose = (): void => {
        if (this.pendingPrompts.delete(promptId)) {
          reject(new Error('surface disconnected before answering'));
        }
      };
      origin.socket.once('close', onClose);
      this.send(origin.socket, { type: 'prompt', promptId, message, hidden });
    });
  }

  /**
   * Streams structured progress from the executing command to its origin
   * surface. Progress is live-only; when no command is active or the surface is
   * gone, the event is dropped.
   *
   * @param event - The structured progress facts.
   * @returns True when the event was sent to a surface.
   */
  public progress_current(event: ProgressEvent): boolean {
    const origin: Surface | null = this.currentOrigin;
    const id: string | null = this.currentId;
    if (!origin || !id || origin.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.send(origin.socket, { type: 'progress', id, ...event });
    return true;
  }

  /**
   * Streams an opaque live output chunk from the executing command to its
   * origin surface. Output is live telemetry, distinct from final envelopes;
   * when no command is active or the origin surface is gone, it is dropped.
   *
   * @param channel - The output channel that produced the chunk.
   * @param chunk - The text chunk to forward.
   * @returns True when the chunk was sent to a surface.
   */
  public output_current(channel: 'data' | 'err' | 'status', chunk: string): boolean {
    const origin: Surface | null = this.currentOrigin;
    const id: string | null = this.currentId;
    if (!origin || !id || origin.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.send(origin.socket, { type: 'output', id, channel, chunk });
    return true;
  }

  /**
   * Resolves a pending prompt with the surface's answer.
   *
   * @param promptId - The prompt correlation id.
   * @param answer - The answer the surface supplied.
   */
  private promptAnswer_settle(promptId: string, answer: string): void {
    const resolve: ((answer: string) => void) | undefined = this.pendingPrompts.get(promptId);
    if (resolve) {
      this.pendingPrompts.delete(promptId);
      resolve(answer);
    }
  }

  /**
   * Runs a pipeline segment on the surface running the current command,
   * returning its output. The host installs a `pipeSegment` on its engine-side
   * surface that calls this, so a pipeline's segments run on the client and
   * never on the daemon host. Data crosses the wire base64-encoded.
   *
   * @param command - The segment command line.
   * @param input - The bytes to feed the segment.
   * @returns The segment's output bytes.
   * @throws {Error} When no command is executing or the surface disconnects.
   */
  public pipe_current(command: string, input: Buffer): Promise<Buffer> {
    const origin: Surface | null = this.currentOrigin;
    if (!origin) {
      return Promise.reject(new Error('no active command to run a pipe segment for'));
    }
    const pipeId: string = `x${this.pipeSeq++}`;
    return new Promise((resolve: (output: Buffer) => void, reject: (err: Error) => void) => {
      this.pendingPipes.set(pipeId, { resolve, reject });
      const onClose = (): void => {
        if (this.pendingPipes.delete(pipeId)) {
          reject(new Error('surface disconnected before returning pipe output'));
        }
      };
      origin.socket.once('close', onClose);
      this.send(origin.socket, { type: 'pipe', pipeId, command, input: input.toString('base64') });
    });
  }

  /**
   * Resolves a pending pipe segment with the surface's output.
   *
   * @param pipeId - The pipe correlation id.
   * @param output - The base64-encoded segment output.
   */
  private pipeResult_settle(pipeId: string, output: string): void {
    const pending: PendingPipe | undefined = this.pendingPipes.get(pipeId);
    if (pending) {
      this.pendingPipes.delete(pipeId);
      pending.resolve(Buffer.from(output, 'base64'));
    }
  }

  /**
   * Rejects a pending pipeline segment with the surface's failure.
   *
   * @param pipeId - The pipe correlation id.
   * @param reason - Human-readable command failure.
   */
  private pipeError_settle(pipeId: string, reason: string): void {
    const pending: PendingPipe | undefined = this.pendingPipes.get(pipeId);
    if (pending) {
      this.pendingPipes.delete(pipeId);
      pending.reject(new Error(reason));
    }
  }

  /**
   * Opens content in the editor of the surface running the current command
   * and returns the edited result. The host installs a `localEdit` on its
   * engine-side surface that calls this, so `edit` opens the operator's own
   * editor and never one on the daemon host.
   *
   * @param content - The content to edit.
   * @param extension - An optional filename extension for syntax mode.
   * @returns The edited content and whether it changed.
   * @throws {Error} When no command is executing or the surface disconnects.
   */
  public edit_current(content: string, extension: string | undefined): Promise<EditOutcome> {
    const origin: Surface | null = this.currentOrigin;
    if (!origin) {
      return Promise.reject(new Error('no active command to edit for'));
    }
    const editId: string = `e${this.editSeq++}`;
    return new Promise((resolve: (result: EditOutcome) => void, reject: (err: Error) => void) => {
      this.pendingEdits.set(editId, resolve);
      const onClose = (): void => {
        if (this.pendingEdits.delete(editId)) {
          reject(new Error('surface disconnected before returning the edit'));
        }
      };
      origin.socket.once('close', onClose);
      this.send(origin.socket, { type: 'edit', editId, content, extension });
    });
  }

  /**
   * Resolves a pending edit with the surface's result.
   *
   * @param editId - The edit correlation id.
   * @param outcome - The edited content and changed flag.
   */
  private editResult_settle(editId: string, outcome: EditOutcome): void {
    const resolve: ((result: EditOutcome) => void) | undefined = this.pendingEdits.get(editId);
    if (resolve) {
      this.pendingEdits.delete(editId);
      resolve(outcome);
    }
  }

  /**
   * Runs one completion request and sends its reply, or an error. Completion
   * is a read and is not broadcast.
   *
   * @param socket - The surface to reply to.
   * @param message - The completion request.
   */
  private async complete_run(socket: WebSocket, message: CompleteRequest): Promise<void> {
    try {
      const result: CompletionResult = await this.engine.line_complete(message.prefix);
      this.send(socket, {
        type: 'complete',
        id: message.id,
        prefix: result.prefix,
        candidates: result.candidates,
      });
    } catch (err: unknown) {
      const reason: string = err instanceof Error ? err.message : String(err);
      this.send(socket, { type: 'error', id: message.id, reason });
    }
  }

  /**
   * Sends a message to a surface if the socket is still open.
   *
   * @param socket - The destination surface.
   * @param message - The message to send.
   */
  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }
}
