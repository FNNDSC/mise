/**
 * @file The browser CALYPSO client: attach, execute, and session events.
 *
 * A thin surface over the published wire contract. The client attaches to a
 * CALYPSO daemon over the browser's native WebSocket, declares no local
 * capabilities (this surface cannot run shell commands, collect hidden
 * input, execute pipeline segments, or open an editor), and exposes the
 * session as typed callbacks. Capability requests the daemon raises anyway
 * are answered with the matching error reply so the engine fails the request
 * cleanly instead of hanging the session.
 *
 * Boundary rule: this module imports only `@fnndsc/menu` — the
 * published contract — never the execution stack.
 *
 * @module
 */
import {
  CONTRACT_VERSION,
  serverMessage_parse,
  type ServerMessage,
  type PromptContext,
  type ProgressMessage,
  type WireEnvelope,
} from '@fnndsc/menu';

/** The output channels a command can stream on. */
export type OutputChannel = 'data' | 'err' | 'status';

/** Re-exported so console modules need not know the protocol package's shape. */
export type { ProgressMessage };

/**
 * The stack identity a daemon reports in its attach ack.
 *
 * @property chell - The daemon's installed chell version.
 * @property calypso - The daemon's installed calypso version.
 * @property build - The daemon's short build hash.
 */
export interface StackInfo {
  chell: string;
  calypso: string;
  build: string;
  brasa?: string;
  chili?: string;
  salsa?: string;
  cumin?: string;
}

/**
 * The facts of a successful attach.
 *
 * @property session - The shared session id all surfaces attach to.
 * @property protocolVersion - The daemon's contract version.
 * @property stack - The daemon's installed versions, when reported.
 */
export interface AttachInfo {
  session: string;
  protocolVersion: number;
  stack?: StackInfo;
}

/**
 * One executed line's complete outcome.
 *
 * @property envelopes - The final envelope per command in the line.
 * @property liveChannels - Channels that already streamed this command's
 *   output live; a renderer suppresses the envelope's rendered text for those
 *   channels to avoid printing the output twice.
 */
export interface ExecuteOutcome {
  envelopes: WireEnvelope[];
  liveChannels: Set<'data' | 'err'>;
}

/**
 * Callbacks through which the client delivers session activity.
 *
 * @property output_receive - A live output chunk from this surface's own
 *   executing command.
 * @property promptline_receive - The refreshed prompt context, pushed on
 *   attach and after every command.
 * @property session_receive - A session-bus envelope produced by another
 *   surface attached to the same session.
 * @property envelope_observe - Every envelope this surface sees, own results
 *   and bus broadcasts alike; instruments (panels) subscribe here.
 * @property close_handle - The socket closed.
 */
export interface ClientHandlers {
  output_receive?: (channel: OutputChannel, chunk: string) => void;
  progress_receive?: (message: ProgressMessage) => void;
  promptline_receive?: (context: PromptContext) => void;
  telemetry_receive?: (index: { jobs: number; feeds: number }) => void;
  session_receive?: (surface: string, envelope: WireEnvelope) => void;
  envelope_observe?: (envelope: WireEnvelope) => void;
  close_handle?: () => void;
}

/** A pending execute request awaiting its correlated result. */
interface PendingExecute {
  resolve: (outcome: ExecuteOutcome) => void;
  reject: (error: Error) => void;
  liveChannels: Set<'data' | 'err'>;
}

/** A completion reply: the candidates and the prefix they complete. */
export interface CompleteOutcome {
  candidates: string[];
  prefix: string;
}

/** A pending completion request awaiting its correlated reply. */
interface PendingComplete {
  resolve: (outcome: CompleteOutcome) => void;
  reject: (error: Error) => void;
}

/**
 * A browser surface attached to one CALYPSO session.
 *
 * @example
 * ```
 * const client = await ArgusClient.session_attach('ws://127.0.0.1:9000', token, handlers);
 * const outcome = await client.line_execute('ls');
 * ```
 */
export class ArgusClient {
  private readonly socket: WebSocket;
  private readonly handlers: ClientHandlers;
  /** The attach token, reused to authorise byte-route fetches. */
  private readonly token: string;
  private readonly pending: Map<string, PendingExecute> = new Map();
  private readonly pendingCompletions: Map<string, PendingComplete> = new Map();
  private nextId: number = 0;

  private constructor(socket: WebSocket, handlers: ClientHandlers, token: string) {
    this.socket = socket;
    this.handlers = handlers;
    this.token = token;
    this.socket.onmessage = (event: MessageEvent): void => this.message_handle(String(event.data));
    this.socket.onclose = (): void => this.handlers.close_handle?.();
  }

  /**
   * Opens a WebSocket to a daemon and performs the attach handshake.
   *
   * @param url - The daemon's WebSocket URL (`ws://127.0.0.1:<port>`).
   * @param token - The daemon's attach token.
   * @param handlers - Session activity callbacks.
   * @returns The attached client and the attach facts.
   * @throws {Error} When the socket fails, the token is refused, or the
   *   daemon replies with anything but an attach ack.
   */
  public static session_attach(
    url: string,
    token: string,
    handlers: ClientHandlers,
  ): Promise<{ client: ArgusClient; attach: AttachInfo }> {
    return new Promise((resolve, reject) => {
      const socket: WebSocket = new WebSocket(url);
      socket.onerror = (): void => reject(new Error(`cannot reach the daemon at ${url}`));
      socket.onopen = (): void => {
        socket.send(
          JSON.stringify({
            type: 'attach',
            protocolVersion: CONTRACT_VERSION,
            token,
            capabilities: {
              shellCommands: false,
              hiddenInput: false,
              // A browser can save a file but has no directory to fill, so a
              // folder must be archived into one file before it can arrive.
              fileDelivery: true,
              localFilesystem: false,
            },
          }),
        );
      };
      socket.onmessage = (event: MessageEvent): void => {
        const message: ServerMessage | null = message_fromPayload(String(event.data));
        if (!message) {
          reject(new Error('invalid attach response'));
          socket.close();
          return;
        }
        if (message.type === 'error') {
          reject(new Error(message.reason));
          socket.close();
          return;
        }
        if (message.type !== 'attached') {
          reject(new Error(`unexpected attach response: ${message.type}`));
          socket.close();
          return;
        }
        const client: ArgusClient = new ArgusClient(socket, handlers, token);
        resolve({
          client,
          attach: {
            session: message.session,
            protocolVersion: message.protocolVersion,
            ...(message.stack !== undefined ? { stack: message.stack } : {}),
          },
        });
      };
    });
  }

  /**
   * Executes one input line through the session.
   *
   * @param line - The command line as the operator typed it.
   * @returns The line's envelopes and which channels already streamed live.
   * @throws {Error} When the daemon reports an execution error.
   */
  public line_execute(line: string): Promise<ExecuteOutcome> {
    const id: string = `argus-${this.nextId++}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, liveChannels: new Set<'data' | 'err'>() });
      this.socket.send(JSON.stringify({ type: 'execute', id, line }));
    });
  }

  /**
   * Requests completion candidates for a partial input line.
   *
   * @param prefix - The input line up to the cursor.
   * @returns The candidates and the prefix they complete.
   * @throws {Error} When the daemon reports an error for the request.
   */
  public line_complete(prefix: string): Promise<CompleteOutcome> {
    const id: string = `argus-c-${this.nextId++}`;
    return new Promise((resolve, reject) => {
      this.pendingCompletions.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ type: 'complete', id, prefix }));
    });
  }

  /** Closes the WebSocket. */
  public connection_close(): void {
    this.socket.close();
  }

  /**
   * Routes one daemon message: correlated results and output to their pending
   * command, session traffic to the handlers, and capability requests to
   * their refusal replies.
   *
   * @param payload - The raw message text.
   */
  private message_handle(payload: string): void {
    const message: ServerMessage | null = message_fromPayload(payload);
    if (!message) {
      return;
    }
    switch (message.type) {
      case 'result': {
        const request: PendingExecute | undefined = this.pending.get(message.id);
        if (request) {
          this.pending.delete(message.id);
          request.resolve({ envelopes: message.envelopes, liveChannels: request.liveChannels });
        }
        for (const envelope of message.envelopes) {
          this.handlers.envelope_observe?.(envelope);
        }
        break;
      }
      case 'complete': {
        const request: PendingComplete | undefined = this.pendingCompletions.get(message.id);
        if (request) {
          this.pendingCompletions.delete(message.id);
          request.resolve({ candidates: message.candidates, prefix: message.prefix });
        }
        break;
      }
      case 'output': {
        if (message.channel === 'data' || message.channel === 'err') {
          this.pending.get(message.id)?.liveChannels.add(message.channel);
        }
        this.handlers.output_receive?.(message.channel, message.chunk);
        break;
      }
      case 'progress': {
        this.handlers.progress_receive?.(message);
        break;
      }
      case 'session': {
        this.handlers.session_receive?.(message.surface, message.envelope);
        this.handlers.envelope_observe?.(message.envelope);
        break;
      }
      case 'promptline': {
        this.handlers.promptline_receive?.(message.context);
        break;
      }
      case 'telemetry': {
        this.handlers.telemetry_receive?.(message.index);
        break;
      }
      case 'error': {
        if (message.id !== undefined) {
          const request: PendingExecute | undefined = this.pending.get(message.id);
          if (request) {
            this.pending.delete(message.id);
            request.reject(new Error(message.reason));
          }
          const completion: PendingComplete | undefined = this.pendingCompletions.get(message.id);
          if (completion) {
            this.pendingCompletions.delete(message.id);
            completion.reject(new Error(message.reason));
          }
        }
        break;
      }
      // This surface declared no local capabilities; refuse each request in
      // its own vocabulary so the engine fails cleanly rather than hanging.
      case 'prompt': {
        this.reply_send({ type: 'promptError', promptId: message.promptId, reason: 'the argus surface cannot answer prompts' });
        break;
      }
      case 'pipe': {
        this.reply_send({ type: 'pipeError', pipeId: message.pipeId, reason: 'the argus surface cannot run pipeline segments' });
        break;
      }
      case 'shell': {
        this.reply_send({ type: 'shellError', shellId: message.shellId, reason: 'the argus surface cannot run shell commands' });
        break;
      }
      case 'edit': {
        this.reply_send({ type: 'editError', editId: message.editId, reason: 'the argus surface cannot open an editor' });
        break;
      }
      // File delivery is the one capability a browser has and a terminal
      // fakes: it hands the file to the download manager, where the person
      // sitting in front of it can find it.
      case 'deliver': {
        void this.deliver_run(message);
        break;
      }
      default:
        break;
    }
  }

  /**
   * Saves a delivered file through the browser.
   *
   * The bytes come from the daemon's token-gated byte route rather than the
   * session bus, so a large file does not cross a channel meant for session
   * state — and the browser streams it the way it streams any download.
   *
   * @param message - The delivery request from the daemon.
   */
  private async deliver_run(message: {
    deliverId: string;
    path: string;
    filename: string;
  }): Promise<void> {
    try {
      const url: string =
        `/vfs?path=${encodeURIComponent(message.path)}&token=${encodeURIComponent(this.token)}`;
      const response: Response = await fetch(url);
      if (!response.ok) {
        throw new Error(`the daemon refused to serve this file (HTTP ${response.status})`);
      }
      const blob: Blob = await response.blob();
      const objectUrl: string = URL.createObjectURL(blob);
      const anchor: HTMLAnchorElement = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = message.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Revoking immediately can cancel a download the browser has not yet
      // started reading, so the handle is released on the next turn.
      setTimeout((): void => URL.revokeObjectURL(objectUrl), 0);
      this.reply_send({
        type: 'deliverResult',
        deliverId: message.deliverId,
        location: message.filename,
        bytes: blob.size,
      });
    } catch (error: unknown) {
      const reason: string = error instanceof Error ? error.message : String(error);
      this.reply_send({ type: 'deliverError', deliverId: message.deliverId, reason });
    }
  }

  /**
   * Sends one reply message to the daemon.
   *
   * @param reply - The message object to serialize.
   */
  private reply_send(reply: Record<string, unknown>): void {
    this.socket.send(JSON.stringify(reply));
  }
}

/**
 * Parses and validates one daemon payload against the wire contract.
 *
 * @param payload - The raw message text.
 * @returns The typed message, or null when the payload is not a valid
 *   contract message.
 */
function message_fromPayload(payload: string): ServerMessage | null {
  try {
    const parsed = serverMessage_parse(JSON.parse(payload));
    return parsed.ok && parsed.value !== undefined ? parsed.value : null;
  } catch {
    return null;
  }
}
