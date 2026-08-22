/**
 * @file The remote engine: a `BrasaEngine` backed by a daemon over the wire.
 *
 * This is the transport swap that lets the same REPL drive either an in-process
 * engine or a CALYPSO daemon. It implements the engine interface by sending
 * `execute` / `complete` messages over a WebSocket and awaiting the correlated
 * `result` / completion replies, validating every message against calypso's
 * wire contract at the boundary. Session-bus broadcasts (another surface's
 * activity) are delivered to an optional callback so the host can render them.
 *
 * @module
 */
import { WebSocket } from 'ws';
import chalk from 'chalk';
import { serverMessage_parse, CONTRACT_VERSION, RequestBroker, type ServerMessage } from '@fnndsc/calypso';
import type { CommandEnvelope } from '@fnndsc/cumin';
import type { BrasaEngine, CompletionResult } from '@fnndsc/brasa';
import { envelope_deliver, sink_get, type OutputSink } from '@fnndsc/brasa';
import { promptFromContext_render } from '../core/prompt/session.js';

/** Options for connecting a remote engine. */
export interface RemoteEngineOptions {
  /** The daemon WebSocket URL, e.g. `ws://127.0.0.1:4300`. */
  url: string;
  /** The attach token. */
  token: string;
  /** Called with each session-bus broadcast from another surface. */
  onSession?: (surface: string, envelope: CommandEnvelope) => void;
  /** Answers a prompt the daemon raised during a command (password, confirmation). */
  onPrompt?: (message: string, hidden: boolean) => Promise<string>;
  /** Runs a pipeline segment on this machine and returns its output. */
  onPipe?: (command: string, input: Buffer) => Promise<Buffer>;
  /** Runs a host-shell command on this machine and returns its exit code. */
  onShell?: (command: string) => Promise<number>;
  /** Opens content in this machine's editor and returns the edited result. */
  onEdit?: (content: string, extension: string | undefined) => Promise<{ content: string; changed: boolean }>;
  /** Called when the connection closes unexpectedly. */
  onClose?: () => void;
}

/**
 * The daemon-reported stack identity from the attach handshake: its installed
 * chell and calypso versions plus the short build hash. Absent on daemons that
 * predate the field.
 *
 * @property chell - The daemon's installed chell version.
 * @property calypso - The daemon's installed calypso version.
 * @property build - The daemon's short build hash.
 */
export interface DaemonStack {
  chell: string;
  calypso: string;
  build: string;
  brasa?: string;
  chili?: string;
  salsa?: string;
  cumin?: string;
}

/**
 * A `BrasaEngine` implementation that drives a remote daemon.
 */
export class RemoteEngine implements BrasaEngine {
  private readonly ws: WebSocket;
  // The same correlation lifecycle the daemon uses for its surface-delegated
  // requests; here it correlates this client's execute/complete requests and
  // rejects them if the daemon connection closes first.
  private readonly requests: RequestBroker<unknown> = new RequestBroker<unknown>('r', 'daemon disconnected before replying');
  private readonly onSession: ((surface: string, envelope: CommandEnvelope) => void) | undefined;
  private readonly onPrompt: ((message: string, hidden: boolean) => Promise<string>) | undefined;
  private readonly onPipe: ((command: string, input: Buffer) => Promise<Buffer>) | undefined;
  private readonly onShell: ((command: string) => Promise<number>) | undefined;
  private readonly onEdit: ((content: string, extension: string | undefined) => Promise<{ content: string; changed: boolean }>) | undefined;
  private latestPrompt: string = '';
  private stackReport: DaemonStack | undefined;
  private nextId: number = 0;
  private activeExecuteId: string | undefined;
  private readonly liveEnvelopeChannels: Map<string, Set<'data' | 'err'>> = new Map<string, Set<'data' | 'err'>>();

  /**
   * @param ws - An open, already-attached socket to the daemon.
   * @param options - The callbacks for session broadcasts and prompts.
   */
  private constructor(ws: WebSocket, options: RemoteEngineOptions) {
    this.ws = ws;
    this.onSession = options.onSession;
    this.onPrompt = options.onPrompt;
    this.onPipe = options.onPipe;
    this.onShell = options.onShell;
    this.onEdit = options.onEdit;
  }

  /**
   * Connects to a daemon, performs the attach handshake, and returns a ready
   * remote engine.
   *
   * @param options - The daemon URL, attach token, and callbacks.
   * @returns The connected remote engine.
   * @throws {Error} When the connection fails or the attach is refused.
   */
  public static connect(options: RemoteEngineOptions): Promise<RemoteEngine> {
    return new Promise((resolve: (engine: RemoteEngine) => void, reject: (err: Error) => void) => {
      const ws: WebSocket = new WebSocket(options.url);

      ws.once('error', (err: Error) => reject(err));

      ws.once('open', () => {
        ws.send(JSON.stringify({
          type: 'attach',
          protocolVersion: CONTRACT_VERSION,
          token: options.token,
          capabilities: {
            shellCommands: options.onShell !== undefined,
            hiddenInput: options.onPrompt !== undefined,
          },
        }));
        ws.once('message', (data: Buffer) => {
          const parsed = serverMessage_parse(safeJson_parse(data.toString()));
          if (!parsed.ok || parsed.value === undefined) {
            reject(new Error(`attach failed: ${parsed.error ?? 'invalid response'}`));
            ws.close();
            return;
          }
          const message: ServerMessage = parsed.value;
          if (message.type === 'error') {
            reject(new Error(`attach refused: ${message.reason}`));
            ws.close();
            return;
          }
          if (message.type !== 'attached') {
            reject(new Error(`unexpected attach response: ${message.type}`));
            ws.close();
            return;
          }
          const engine: RemoteEngine = new RemoteEngine(ws, options);
          engine.stackReport = message.stack;
          ws.on('message', (payload: Buffer) => engine.message_handle(payload));
          if (options.onClose) {
            ws.on('close', () => options.onClose?.());
          }
          resolve(engine);
        });
      });
    });
  }

  /** @inheritdoc */
  public async line_execute(line: string): Promise<CommandEnvelope[]> {
    const id: string = String(this.nextId++);
    this.activeExecuteId = id;
    try {
      const envelopes: CommandEnvelope[] = await this.request<CommandEnvelope[]>('execute', { line }, id);
      const liveChannels: Set<'data' | 'err'> | undefined = this.liveEnvelopeChannels.get(id);
      this.liveEnvelopeChannels.delete(id);
      // Deliver to the active sink exactly as the in-process engine delivers
      // live, so the REPL host renders remote output without any change.
      for (const envelope of envelopes) {
        envelope_deliver(liveChannels ? {
          ...envelope,
          rendered: liveChannels.has('data') ? '' : envelope.rendered,
          renderedErr: liveChannels.has('err') ? undefined : envelope.renderedErr,
        } : envelope);
      }
      return envelopes;
    } finally {
      if (this.activeExecuteId === id) this.activeExecuteId = undefined;
    }
  }

  /** @inheritdoc */
  public line_cancel(): boolean {
    if (this.activeExecuteId === undefined) return false;
    this.ws.send(JSON.stringify({ type: 'cancel', id: this.activeExecuteId }));
    return true;
  }

  /** @inheritdoc */
  public line_complete(linePrefix: string): Promise<CompletionResult> {
    return this.request<CompletionResult>('complete', { prefix: linePrefix });
  }

  /**
   * Sends a correlated request and returns a promise for its reply.
   *
   * @param type - The request message type.
   * @param fields - The message fields besides `type` and `id`.
   * @returns The reply payload.
   */
  private request<T>(type: 'execute' | 'complete', fields: Record<string, string>, requestId?: string): Promise<T> {
    const id: string = requestId ?? String(this.nextId++);
    return this.requests.openWithId(id, this.ws, (correlationId: string): void => {
      this.ws.send(JSON.stringify({ type, id: correlationId, ...fields }));
    }) as Promise<T>;
  }

  /**
   * Dispatches a message from the daemon: correlated replies resolve their
   * pending request, session broadcasts reach the callback, and uncorrelated
   * errors are surfaced.
   *
   * @param payload - The raw message bytes.
   */
  private message_handle(payload: Buffer): void {
    const parsed = serverMessage_parse(safeJson_parse(payload.toString()));
    if (!parsed.ok || parsed.value === undefined) {
      // An invalid daemon message usually means protocol drift between the
      // daemon and this client; dropping it silently would leave any
      // correlated pending request hanging with no explanation.
      console.error(chalk.yellow(`[!] Ignoring invalid daemon message: ${parsed.ok ? 'empty payload' : (parsed.error ?? 'unparseable')}`));
      return;
    }
    const message: ServerMessage = parsed.value;
    switch (message.type) {
      case 'result':
        this.requests.settle(this.ws, message.id, message.envelopes);
        break;
      case 'complete':
        this.requests.settle(this.ws, message.id, { candidates: message.candidates, prefix: message.prefix });
        break;
      case 'session':
        // The wire envelope is a CommandEnvelope; calypso's schema infers the
        // model payload as optional-unknown, a zod nicety the runtime shape
        // does not reflect. Narrow at this single boundary.
        if (this.onSession) this.onSession(message.surface, message.envelope as CommandEnvelope);
        break;
      case 'prompt':
        void this.prompt_answer(message.promptId, message.message, message.hidden);
        break;
      case 'promptline':
        // Render the daemon's context with this surface's own theme, so a
        // remote prompt looks the way the local operator configured it.
        this.latestPrompt = promptFromContext_render(message.context);
        break;
      case 'progress':
        {
          const { type: _type, id: _id, ...event } = message;
          sink_get().progress_write(event);
        }
        break;
      case 'output':
        if (message.channel === 'data' || message.channel === 'err') {
          const channels: Set<'data' | 'err'> = this.liveEnvelopeChannels.get(message.id) ?? new Set<'data' | 'err'>();
          channels.add(message.channel);
          this.liveEnvelopeChannels.set(message.id, channels);
        }
        this.output_render(message.channel, message.chunk);
        break;
      case 'pipe':
        void this.pipe_run(message.pipeId, message.command, message.input);
        break;
      case 'shell':
        void this.shell_run(message.shellId, message.command);
        break;
      case 'edit':
        void this.edit_run(message.editId, message.content, message.extension);
        break;
      case 'error':
        if (message.id !== undefined) {
          this.requests.fail(this.ws, message.id, message.reason);
        }
        break;
      default:
        break;
    }
  }

  /**
   * Answers a prompt the daemon raised: asks the local surface and sends the
   * answer back. With no prompt handler, answers empty so the command does not
   * hang.
   *
   * @param promptId - The prompt correlation id.
   * @param message - The prompt text.
   * @param hidden - Whether the entry should be hidden (a password).
   */
  private async prompt_answer(promptId: string, message: string, hidden: boolean): Promise<void> {
    try {
      if (!this.onPrompt) {
        // A silent empty answer would let the command proceed on fabricated
        // input; an inability to prompt is a failure and reports as one.
        throw new Error('this surface cannot prompt');
      }
      const answer: string = await this.onPrompt(message, hidden);
      this.ws.send(JSON.stringify({ type: 'promptAnswer', promptId, answer }));
    } catch (error: unknown) {
      const reason: string = error instanceof Error ? error.message : String(error);
      this.ws.send(JSON.stringify({ type: 'promptError', promptId, reason }));
    }
  }

  /**
   * Runs a pipeline segment the daemon asked for on this machine and returns
   * its output. Data crosses the wire base64-encoded. With no pipe handler,
   * returns the input unchanged so the pipeline does not hang.
   *
   * @param pipeId - The pipe correlation id.
   * @param command - The segment command line.
   * @param input - The base64-encoded input bytes.
   */
  private async pipe_run(pipeId: string, command: string, input: string): Promise<void> {
    const inputBytes: Buffer = Buffer.from(input, 'base64');
    try {
      if (!this.onPipe) {
        // Passing input through unchanged would silently turn the segment
        // into a no-op; an inability to run it is a failure.
        throw new Error('this surface cannot run pipeline segments');
      }
      const output: Buffer = await this.onPipe(command, inputBytes);
      this.ws.send(JSON.stringify({ type: 'pipeResult', pipeId, output: output.toString('base64') }));
    } catch (error: unknown) {
      const reason: string = error instanceof Error ? error.message : String(error);
      this.ws.send(JSON.stringify({ type: 'pipeError', pipeId, reason }));
    }
  }

  /**
   * Runs a host-shell command the daemon delegated to this surface and returns
   * only its exit status; the process owns this surface's terminal directly.
   *
   * @param shellId - Correlation id for the shell request.
   * @param command - The shell command without the leading `!`.
   */
  private async shell_run(shellId: string, command: string): Promise<void> {
    try {
      if (!this.onShell) {
        throw new Error('this surface cannot run shell commands');
      }
      const exitCode: number = await this.onShell(command);
      this.ws.send(JSON.stringify({ type: 'shellResult', shellId, exitCode }));
    } catch (error: unknown) {
      const reason: string = error instanceof Error ? error.message : String(error);
      this.ws.send(JSON.stringify({ type: 'shellError', shellId, reason }));
    }
  }

  /**
   * Opens content in this machine's editor (the daemon asked for it) and
   * returns the edited result. With no edit handler, returns the content
   * unchanged so the command does not hang.
   *
   * @param editId - The edit correlation id.
   * @param content - The content to edit.
   * @param extension - An optional filename extension.
   */
  private async edit_run(editId: string, content: string, extension: string | undefined): Promise<void> {
    try {
      if (!this.onEdit) {
        // Returning the content unchanged would report a successful edit that
        // never happened; an inability to edit is a failure.
        throw new Error('this surface cannot edit');
      }
      const result: { content: string; changed: boolean } = await this.onEdit(content, extension);
      this.ws.send(JSON.stringify({ type: 'editResult', editId, content: result.content, changed: result.changed }));
    } catch (error: unknown) {
      const reason: string = error instanceof Error ? error.message : String(error);
      this.ws.send(JSON.stringify({ type: 'editError', editId, reason }));
    }
  }

  /**
   * Renders a streamed output chunk to the local sink on its channel.
   *
   * @param channel - The sink channel the chunk belongs to.
   * @param chunk - The streamed text.
   */
  private output_render(channel: 'data' | 'err' | 'status', chunk: string): void {
    const sink: OutputSink = sink_get();
    if (channel === 'data') {
      sink.data_write(chunk);
    } else if (channel === 'err') {
      sink.err_write(chunk);
    } else {
      sink.status_write(chunk);
    }
  }

  /**
   * The latest themed prompt string the daemon pushed, or empty before the
   * first push.
   *
   * @returns The current prompt string.
   */
  public promptLine(): string {
    return this.latestPrompt;
  }

  /**
   * The stack identity the daemon reported in its attach handshake.
   *
   * @returns The daemon's versions and build hash, or undefined when the
   *   daemon predates the field.
   */
  public daemonStack(): DaemonStack | undefined {
    return this.stackReport;
  }

  /**
   * Closes the connection.
   */
  public close(): void {
    this.ws.close();
  }
}

/**
 * Parses JSON, returning `undefined` on failure so callers can validate the
 * result rather than catch.
 *
 * @param text - The JSON text.
 * @returns The parsed value, or undefined when the text is not valid JSON.
 */
function safeJson_parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
