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
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { HostedEngine, CompletionResult } from './engine.js';
import { staticRequest_handle, contentType_forPath } from './static.js';
import { token_matches } from './token.js';
import { RequestBroker } from './broker.js';
import { CONTRACT_VERSION } from '@fnndsc/menu';
import { clientMessage_parse, attach_parse } from '@fnndsc/menu';
import type { ServerMessage, executeMessageSchema, completeRequestSchema, cancelMessageSchema, ProgressEvent, PromptContext, FileDeliverRequest, Regard } from '@fnndsc/menu';
import type { z } from 'zod';
import type { CommandEnvelope } from '@fnndsc/cumin';

/**
 * The hosting process's stack identity, sent to surfaces in the attach ack.
 * Injected by the host (which resolves it from brasa) rather than resolved
 * here, keeping the transport server free of engine dependencies.
 *
 * @property chell - The daemon's installed chell version.
 * @property calypso - The daemon's installed calypso version.
 * @property build - The daemon's short build hash.
 */
export interface DaemonStackInfo {
  chell: string;
  calypso: string;
  build: string;
  brasa?: string;
  chili?: string;
  salsa?: string;
  cumin?: string;
}

type ExecuteMessage = z.infer<typeof executeMessageSchema>;
type CompleteRequest = z.infer<typeof completeRequestSchema>;
type CancelMessage = z.infer<typeof cancelMessageSchema>;

/** An attached surface: its socket, bus id, and locally executable capabilities. */
interface Surface {
  socket: WebSocket;
  id: string;
  capabilities: {
    shellCommands: boolean;
    hiddenInput: boolean;
    fileDelivery: boolean;
    localFilesystem: boolean;
  };
}

/** One scrollback entry: an envelope and the surface that produced it. */
interface SessionEntry {
  surface: string;
  envelope: CommandEnvelope;
}

/**
 * Where a delivered file landed, returned by {@link CalypsoDaemon.deliver_current}.
 *
 * @property location - The surface's honest account of the destination.
 * @property bytes - How many bytes it delivered.
 */
export interface DeliverOutcome {
  location: string;
  bytes: number;
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
 *   surface renders it with its own theme. The daemon passes the last executed
 *   command's measured facts so the context can carry them. Omitted when a
 *   host does not push a prompt (e.g. tests).
 * @property webRoot - A directory of static files (the built web surface) the
 *   daemon's HTTP side serves alongside the WebSocket contract. Omitted, plain
 *   HTTP requests receive 404 and only the WebSocket upgrade is answered.
 */
/** The last executed command's measured facts, for the prompt context. */
export interface PromptLastCommand {
  durationMs: number;
  exitCode: number;
}

export interface DaemonOptions {
  engine: HostedEngine;
  token: string;
  port?: number;
  host?: string;
  scrollbackSize?: number;
  promptProvider?: (last?: PromptLastCommand) => PromptContext | Promise<PromptContext>;
  /**
   * Supplies the live process-index counts for the once-a-second telemetry
   * heartbeat. Omitted, no heartbeat is sent (e.g. tests).
   */
  telemetryProvider?: () => { jobs: number; feeds: number };
  /** The hosting process's versions and build hash, reported on attach. */
  stack?: DaemonStackInfo;
  webRoot?: string;
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
  private readonly promptProvider:
    | ((last?: PromptLastCommand) => PromptContext | Promise<PromptContext>)
    | undefined;
  /** The last executed command's measured facts, sticky across pushes. */
  private lastCommand: PromptLastCommand | undefined;
  private readonly telemetryProvider: (() => { jobs: number; feeds: number }) | undefined;
  private telemetryTimer: NodeJS.Timeout | null = null;
  private readonly stack: DaemonStackInfo | undefined;
  /** The one session all surfaces share; returned in each attach ack. */
  private readonly sessionId: string = randomBytes(8).toString('hex');
  private readonly surfaces: Set<Surface> = new Set<Surface>();
  private readonly scrollback: SessionEntry[] = [];
  private readonly webRoot: string | undefined;
  private wss: WebSocketServer | null = null;
  private httpServer: Server | null = null;
  /**
   * Execution is serialized across the whole session (one foreground command
   * at a time), so a prompt raised mid-command has one unambiguous surface to
   * ask — the one running the current command.
   */
  private queue: Promise<void> = Promise.resolve();
  /** The session's retained regard: the last indication from any surface. */
  private regard: Regard | null = null;
  private currentOrigin: Surface | null = null;
  private currentId: string | null = null;
  // One RequestBroker per surface-delegated request kind. The broker owns the
  // whole correlation lifecycle uniformly: id generation, close-guard,
  // origin-validated settles, listener cleanup. See broker.ts.
  private readonly prompts: RequestBroker<string> = new RequestBroker<string>('p', 'surface disconnected before answering');
  private readonly pipes: RequestBroker<Buffer> = new RequestBroker<Buffer>('x', 'surface disconnected before returning pipe output');
  private readonly shells: RequestBroker<number> = new RequestBroker<number>('h', 'surface disconnected before returning the shell result');
  private readonly edits: RequestBroker<EditOutcome> = new RequestBroker<EditOutcome>('e', 'surface disconnected before returning the edit');
  private readonly deliveries: RequestBroker<DeliverOutcome> = new RequestBroker<DeliverOutcome>('d', 'surface disconnected before the file was delivered');

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
    this.telemetryProvider = options.telemetryProvider;
    this.stack = options.stack;
    this.webRoot = options.webRoot;
  }

  /**
   * Starts the telemetry heartbeat: once a second, the live index counts go
   * to every attached surface. Idle wires stay quiet — no surfaces, no send.
   */
  private telemetry_start(): void {
    if (this.telemetryProvider === undefined || this.telemetryTimer !== null) {
      return;
    }
    const provider: () => { jobs: number; feeds: number } = this.telemetryProvider;
    this.telemetryTimer = setInterval((): void => {
      if (this.surfaces.size === 0) {
        return;
      }
      const index: { jobs: number; feeds: number } = provider();
      for (const surface of this.surfaces) {
        this.send(surface.socket, { type: 'telemetry', index });
      }
    }, 1000);
    // The heartbeat must not hold the process open on its own.
    this.telemetryTimer.unref();
  }

  /**
   * Starts listening.
   *
   * The daemon owns an explicit HTTP server: WebSocket upgrades carry the
   * session contract, and plain requests serve the configured web root (404
   * when none is configured), so one loopback port carries both the wire and
   * the web surface that speaks it.
   *
   * @returns The bound port (useful when an ephemeral port was requested).
   */
  public start(): Promise<number> {
    return new Promise((resolve: (port: number) => void, reject: (err: Error) => void) => {
      const httpServer: Server = createServer(
        (request: IncomingMessage, response: ServerResponse) => {
          const requestPath: string = (request.url ?? '/').split('?')[0] ?? '/';
          if (requestPath === '/vfs') {
            void this.vfs_serve(request, response);
            return;
          }
          if (this.webRoot !== undefined) {
            staticRequest_handle(this.webRoot, request, response);
            return;
          }
          response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('not found');
        },
      );
      const wss: WebSocketServer = new WebSocketServer({ server: httpServer });
      wss.on('connection', (socket: WebSocket) => this.connection_handle(socket));
      httpServer.on('error', reject);
      httpServer.listen(this.port, this.host, () => {
        resolve((httpServer.address() as AddressInfo).port);
      });
      this.wss = wss;
      this.httpServer = httpServer;
      this.telemetry_start();
    });
  }

  /**
   * Stops listening and closes all connections.
   *
   * @returns A promise resolving when the server has closed.
   */
  public stop(): Promise<void> {
    if (this.telemetryTimer !== null) {
      clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }
    return new Promise((resolve: () => void) => {
      if (!this.wss || !this.httpServer) {
        resolve();
        return;
      }
      for (const client of this.wss.clients) {
        client.terminate();
      }
      const httpServer: Server = this.httpServer;
      this.wss.close(() => {
        httpServer.close(() => resolve());
      });
      this.wss = null;
      this.httpServer = null;
    });
  }

  /**
   * Serves one ChRIS file's bytes over HTTP: `GET /vfs?path=...&token=...`.
   *
   * The route exists so browser surfaces can render file content natively
   * (an image in a panel) instead of through the terminal stream. It is
   * gated by the same attach token as the wire (compared in constant time)
   * and requires the hosted engine to provide `file_read`; refusals and
   * failures answer 404 so the response does not confirm what exists.
   *
   * @param request - The incoming HTTP request.
   * @param response - The response to write.
   */
  private async vfs_serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const refuse = (status: number, message: string): void => {
      response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(message);
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      refuse(405, 'method not allowed');
      return;
    }
    const query: URLSearchParams = new URL(request.url ?? '/', 'http://localhost').searchParams;
    if (!token_matches(this.token, query.get('token') ?? '')) {
      refuse(404, 'not found');
      return;
    }
    const filePath: string | null = query.get('path');
    const read = this.engine.file_read?.bind(this.engine);
    if (filePath === null || filePath.length === 0 || read === undefined) {
      refuse(404, 'not found');
      return;
    }
    try {
      const bytes: Buffer = await read(filePath);
      response.writeHead(200, {
        'content-type': contentType_forPath(filePath),
        'content-length': bytes.length,
      });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch {
      refuse(404, 'not found');
    }
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
      } else if (value.type === 'cancel') {
        this.cancel_run(attached, value);
      } else if (value.type === 'complete') {
        void this.complete_run(socket, value);
      } else if (value.type === 'promptAnswer') {
        this.prompts.settle(socket, value.promptId, value.answer);
      } else if (value.type === 'promptError') {
        this.prompts.fail(socket, value.promptId, value.reason);
      } else if (value.type === 'pipeResult') {
        this.pipes.settle(socket, value.pipeId, Buffer.from(value.output, 'base64'));
      } else if (value.type === 'pipeError') {
        this.pipes.fail(socket, value.pipeId, value.reason);
      } else if (value.type === 'shellResult') {
        this.shells.settle(socket, value.shellId, value.exitCode);
      } else if (value.type === 'shellError') {
        this.shells.fail(socket, value.shellId, value.reason);
      } else if (value.type === 'editResult') {
        this.edits.settle(socket, value.editId, { content: value.content, changed: value.changed });
      } else if (value.type === 'editError') {
        this.edits.fail(socket, value.editId, value.reason);
      } else if (value.type === 'deliverResult') {
        this.deliveries.settle(socket, value.deliverId, { location: value.location, bytes: value.bytes });
      } else if (value.type === 'deliverError') {
        this.deliveries.fail(socket, value.deliverId, value.reason);
      } else if (value.type === 'regard') {
        this.regard_receive(value.regard);
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
   * Relays a cancellation request only to the surface's own foreground command.
   *
   * @param origin - Surface asking to cancel a command.
   * @param message - Correlated command identifier to cancel.
   * @returns Nothing. The running command reports its normal final envelope.
   */
  private cancel_run(origin: Surface, message: CancelMessage): void {
    if (this.currentOrigin !== origin || this.currentId !== message.id) {
      this.send(origin.socket, { type: 'error', reason: 'cancel: no matching foreground command' });
      return;
    }
    if (!this.engine.line_cancel?.()) {
      this.send(origin.socket, { type: 'error', reason: 'cancel: command cannot be interrupted' });
    }
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
    const surface: Surface = {
      socket,
      id: randomBytes(8).toString('hex'),
      capabilities: {
        shellCommands: attach.value.capabilities?.shellCommands ?? false,
        hiddenInput: attach.value.capabilities?.hiddenInput ?? false,
        fileDelivery: attach.value.capabilities?.fileDelivery ?? false,
        localFilesystem: attach.value.capabilities?.localFilesystem ?? false,
      },
    };
    this.surfaces.add(surface);
    this.send(socket, {
      type: 'attached',
      session: this.sessionId,
      protocolVersion: CONTRACT_VERSION,
      ...(this.stack !== undefined ? { stack: this.stack } : {}),
    });
    this.scrollback_replay(socket);
    // The newcomer shows the right prompt immediately, before any command.
    void this.promptline_push(surface);
    // Regard is a retained cell: a late attacher receives the current value
    // rather than waiting for the operator's next indication.
    const retained: Regard | null = this.regard ?? this.engine.regard_get?.() ?? null;
    if (retained !== null) {
      this.send(socket, { type: 'regard', regard: retained });
    }
    return surface;
  }

  /**
   * Retains a regard write (last write wins), mirrors it into the engine as
   * session truth, and rebroadcasts it to every attached surface — the
   * writer included, so all surfaces converge on the same retained value.
   *
   * @param regard - The indicated address with its provenance.
   */
  private regard_receive(regard: Regard): void {
    this.regard = regard;
    this.engine.regard_note?.(regard);
    for (const surface of this.surfaces) {
      this.send(surface.socket, { type: 'regard', regard });
    }
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
    const context: PromptContext = await this.promptProvider(this.lastCommand);
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
    let envelopes: CommandEnvelope[] | undefined;
    let failureReason: string | undefined;
    const startedAt: number = performance.now();
    try {
      try {
        envelopes = await this.engine.line_execute(message.line);
      } catch (err: unknown) {
        failureReason = err instanceof Error ? err.message : String(err);
      }
      this.lastCommand = {
        durationMs: Math.round(performance.now() - startedAt),
        exitCode:
          failureReason !== undefined ||
          (envelopes?.some((envelope): boolean => envelope.status === 'error') ?? false)
            ? 1
            : 0,
      };
      // A remote REPL draws its next prompt as soon as `result` resolves the
      // command. Push the refreshed context first so that prompt cannot lag
      // one command behind state changes such as `cd`.
      await this.promptline_push();
      if (envelopes !== undefined) {
        this.send(origin.socket, { type: 'result', id: message.id, envelopes });
        for (const envelope of envelopes) {
          this.bus_publish(origin, envelope);
        }
      } else {
        this.send(origin.socket, {
          type: 'error',
          id: message.id,
          reason: failureReason ?? 'engine execution failed',
        });
      }
    } finally {
      this.currentOrigin = null;
      this.currentId = null;
    }
  }

  /**
   * Raises a prompt on the surface running the current command, returning its
   * answer. The host installs an engine-side input broker that calls this; the
   * engine therefore prompts through the wire without knowing the transport.
   *
   * @param message - The prompt text to show.
   * @param hidden - Whether to request no-echo entry (a password).
   * @returns The surface's answer.
   * @throws {Error} When no command is executing, the surface cannot securely
   *   collect a requested hidden answer, or the surface disconnects before
   *   answering.
   */
  public prompt_current(message: string, hidden: boolean): Promise<string> {
    const origin: Surface | null = this.currentOrigin;
    if (!origin) {
      return Promise.reject(new Error('no active command to prompt for'));
    }
    if (hidden && !origin.capabilities.hiddenInput) {
      return Promise.reject(new Error('this surface cannot securely collect hidden input'));
    }
    return this.prompts.open(origin.socket, (promptId: string): void => {
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
    return this.pipes.open(origin.socket, (pipeId: string): void => {
      this.send(origin.socket, { type: 'pipe', pipeId, command, input: input.toString('base64') });
    });
  }

  /**
   * Runs a host-shell command on the surface running the current command.
   * The daemon never spawns the process itself.
   *
   * @param command - The shell command without the leading `!`.
   * @returns The surface process exit code.
   * @throws {Error} When no command is executing or the surface disconnects.
   */
  public shell_current(command: string): Promise<number> {
    const origin: Surface | null = this.currentOrigin;
    if (!origin) {
      return Promise.reject(new Error('no active command to run a shell command for'));
    }
    if (!origin.capabilities.shellCommands) {
      return Promise.reject(new Error('the originating surface cannot run shell commands'));
    }
    return this.shells.open(origin.socket, (shellId: string): void => {
      this.send(origin.socket, { type: 'shell', shellId, command });
    });
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
    return this.edits.open(origin.socket, (editId: string): void => {
      this.send(origin.socket, { type: 'edit', editId, content, extension });
    });
  }

  /**
   * Reports what the surface running the current command can do on its own
   * machine. A daemon has no capabilities of its own to offer: every one it
   * presents belongs to whichever surface asked.
   *
   * @returns The executing surface's declared capabilities; nothing when no
   *   command is running.
   */
  public capabilities_current(): { fileDelivery: boolean; localFilesystem: boolean } | null {
    const origin: Surface | null = this.currentOrigin;
    return origin ? {
      fileDelivery: origin.capabilities.fileDelivery,
      localFilesystem: origin.capabilities.localFilesystem,
    } : null;
  }

  /**
   * Asks the surface running the current command to place a file where its
   * operator can reach it. The host installs a `fileDeliver` on its engine-side
   * surface that calls this, so `download` writes to the operator's machine and
   * never to the daemon host's disk.
   *
   * Only the request crosses here. The surface fetches the bytes itself from
   * `/vfs`, which is the same token-gated route a browser already uses to
   * render a file natively.
   *
   * @param request - What to deliver and where the operator asked for it.
   * @returns Where the file landed and how large it was.
   * @throws {Error} When no command is executing or the surface disconnects.
   */
  public deliver_current(request: FileDeliverRequest): Promise<DeliverOutcome> {
    const origin: Surface | null = this.currentOrigin;
    if (!origin) {
      return Promise.reject(new Error('no active command to deliver a file for'));
    }
    if (!origin.capabilities.fileDelivery) {
      return Promise.reject(new Error('this surface cannot receive a file'));
    }
    return this.deliveries.open(origin.socket, (deliverId: string): void => {
      this.send(origin.socket, {
        type: 'deliver',
        deliverId,
        path: request.path,
        filename: request.filename,
        ...(request.destination !== undefined ? { destination: request.destination } : {}),
        ...(request.size !== undefined ? { size: request.size } : {}),
        ...(request.contentType !== undefined ? { contentType: request.contentType } : {}),
      });
    });
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
