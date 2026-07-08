/**
 * @file The remote engine: a `ChellEngine` backed by a daemon over the wire.
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
import { serverMessage_parse, CONTRACT_VERSION, type ServerMessage } from '@fnndsc/calypso';
import type { CommandEnvelope } from '@fnndsc/cumin';
import type { ChellEngine, CompletionResult } from '../core/engine.js';
import { envelope_deliver } from '../core/sink.js';

/** A pending request awaiting its correlated reply. */
interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

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
  /** Opens content in this machine's editor and returns the edited result. */
  onEdit?: (content: string, extension: string | undefined) => Promise<{ content: string; changed: boolean }>;
  /** Called when the connection closes unexpectedly. */
  onClose?: () => void;
}

/**
 * A `ChellEngine` implementation that drives a remote daemon.
 */
export class RemoteEngine implements ChellEngine {
  private readonly ws: WebSocket;
  private readonly pending: Map<string, Pending> = new Map<string, Pending>();
  private readonly onSession: ((surface: string, envelope: CommandEnvelope) => void) | undefined;
  private readonly onPrompt: ((message: string, hidden: boolean) => Promise<string>) | undefined;
  private readonly onPipe: ((command: string, input: Buffer) => Promise<Buffer>) | undefined;
  private readonly onEdit: ((content: string, extension: string | undefined) => Promise<{ content: string; changed: boolean }>) | undefined;
  private latestPrompt: string = '';
  private nextId: number = 0;

  /**
   * @param ws - An open, already-attached socket to the daemon.
   * @param options - The callbacks for session broadcasts and prompts.
   */
  private constructor(ws: WebSocket, options: RemoteEngineOptions) {
    this.ws = ws;
    this.onSession = options.onSession;
    this.onPrompt = options.onPrompt;
    this.onPipe = options.onPipe;
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
        ws.send(JSON.stringify({ type: 'attach', protocolVersion: CONTRACT_VERSION, token: options.token }));
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
    const envelopes: CommandEnvelope[] = await this.request<CommandEnvelope[]>('execute', { line });
    // Deliver to the active sink exactly as the in-process engine delivers
    // live, so the REPL host renders remote output without any change.
    for (const envelope of envelopes) {
      envelope_deliver(envelope);
    }
    return envelopes;
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
  private request<T>(type: 'execute' | 'complete', fields: Record<string, string>): Promise<T> {
    const id: string = String(this.nextId++);
    return new Promise((resolve: (value: unknown) => void, reject: (err: Error) => void) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ type, id, ...fields }));
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
      return;
    }
    const message: ServerMessage = parsed.value;
    switch (message.type) {
      case 'result':
        this.pending_settle(message.id, (p: Pending) => p.resolve(message.envelopes));
        break;
      case 'complete':
        this.pending_settle(message.id, (p: Pending) =>
          p.resolve({ candidates: message.candidates, prefix: message.prefix }));
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
        this.latestPrompt = message.text;
        break;
      case 'pipe':
        void this.pipe_run(message.pipeId, message.command, message.input);
        break;
      case 'edit':
        void this.edit_run(message.editId, message.content, message.extension);
        break;
      case 'error':
        if (message.id !== undefined) {
          this.pending_settle(message.id, (p: Pending) => p.reject(new Error(message.reason)));
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
    const answer: string = this.onPrompt ? await this.onPrompt(message, hidden) : '';
    this.ws.send(JSON.stringify({ type: 'promptAnswer', promptId, answer }));
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
    const output: Buffer = this.onPipe ? await this.onPipe(command, inputBytes) : inputBytes;
    this.ws.send(JSON.stringify({ type: 'pipeResult', pipeId, output: output.toString('base64') }));
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
    const result: { content: string; changed: boolean } = this.onEdit
      ? await this.onEdit(content, extension)
      : { content, changed: false };
    this.ws.send(JSON.stringify({ type: 'editResult', editId, content: result.content, changed: result.changed }));
  }

  /**
   * Applies a settlement to the pending request for an id, if one exists.
   *
   * @param id - The correlation id.
   * @param settle - The settlement to apply.
   */
  private pending_settle(id: string, settle: (pending: Pending) => void): void {
    const pending: Pending | undefined = this.pending.get(id);
    if (pending) {
      this.pending.delete(id);
      settle(pending);
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
