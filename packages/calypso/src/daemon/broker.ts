/**
 * @file Correlated request broker.
 *
 * One lifecycle for every correlation-id request/reply exchange over a
 * WebSocket: the daemon's four surface-delegated brokers (prompt, pipeline
 * segment, host shell, edit) and the remote client's own pending requests all
 * previously reimplemented this shape independently, with divergent
 * correctness (leaked close-listeners, settles that accepted answers from any
 * socket, kinds with no failure path). This class is the single
 * implementation: id generation, the pending map, close-listener hygiene, and
 * origin validation live here; what a request or reply looks like on the wire
 * stays with the caller, so the protocol is unchanged.
 *
 * @module
 */
import type { WebSocket } from 'ws';

/** A pending request awaiting its correlated reply. */
interface BrokerPending<TReply> {
  /** The socket the request went to; only it may settle the request. */
  origin: WebSocket;
  /** The close handler registered on the origin, removed on settle. */
  onClose: () => void;
  resolve: (reply: TReply) => void;
  reject: (err: Error) => void;
}

/**
 * A broker for one kind of correlated request over a WebSocket.
 *
 * Guarantees, uniformly for every kind: an id unique within the broker, a
 * rejection when the origin socket closes before answering, removal of the
 * close listener once settled (no per-request listener leak), and settles
 * accepted only from the socket the request was sent to (no cross-surface
 * answering).
 *
 * @example
 * ```
 * const prompts = new RequestBroker<string>('p', 'surface disconnected before answering');
 * const answer = await prompts.open(surface.socket, (promptId) =>
 *   send(surface.socket, { type: 'prompt', promptId, message, hidden }));
 * // on a promptAnswer message:
 * prompts.settle(socket, message.promptId, message.answer);
 * ```
 */
export class RequestBroker<TReply> {
  private readonly pending: Map<string, BrokerPending<TReply>> = new Map<string, BrokerPending<TReply>>();
  private seq: number = 0;

  /**
   * @param idPrefix - Prefix for generated correlation ids (e.g. `'p'`).
   * @param disconnectReason - Rejection message when the origin closes first.
   */
  constructor(
    private readonly idPrefix: string,
    private readonly disconnectReason: string,
  ) {}

  /**
   * Opens a request with a generated id: registers the pending entry and its
   * close guard, then invokes `send` with the id to put the request on the
   * wire.
   *
   * @param origin - The socket the request goes to; only it may settle.
   * @param send - Callback that transmits the request, given the new id.
   * @returns The correlated reply.
   * @throws {Error} With the broker's disconnect reason when the origin closes
   *   before answering, or the reason given to {@link fail}.
   */
  public open(origin: WebSocket, send: (id: string) => void): Promise<TReply> {
    return this.openWithId(`${this.idPrefix}${this.seq++}`, origin, send);
  }

  /**
   * Opens a request under a caller-supplied id, for callers that already
   * correlate ids externally (the remote client's execute/complete counter).
   *
   * @param id - The correlation id to register.
   * @param origin - The socket the request goes to; only it may settle.
   * @param send - Callback that transmits the request, given the id.
   * @returns The correlated reply.
   * @throws {Error} As {@link open}.
   */
  public openWithId(id: string, origin: WebSocket, send: (id: string) => void): Promise<TReply> {
    return new Promise((resolve: (reply: TReply) => void, reject: (err: Error) => void) => {
      const onClose = (): void => {
        if (this.pending.delete(id)) {
          reject(new Error(this.disconnectReason));
        }
      };
      this.pending.set(id, { origin, onClose, resolve, reject });
      origin.once('close', onClose);
      send(id);
    });
  }

  /**
   * Whether this origin already has a request in flight.
   *
   * Some requests may be concurrent and some may not: a surface can render
   * two pipeline segments at once, but it cannot sensibly be asked two
   * questions at once. The broker reports the fact; what to do about it
   * belongs to the caller.
   *
   * @param origin - The socket to ask about.
   * @returns True when a request opened on that socket is still awaiting a reply.
   */
  public pending_has(origin: WebSocket): boolean {
    for (const entry of this.pending.values()) {
      if (entry.origin === origin) return true;
    }
    return false;
  }

  /**
   * Resolves a pending request with its reply. Ignored when the id is unknown
   * or the reply arrives from a socket other than the request's origin.
   *
   * @param socket - The socket the reply arrived on.
   * @param id - The correlation id.
   * @param reply - The reply value.
   */
  public settle(socket: WebSocket, id: string, reply: TReply): void {
    const entry: BrokerPending<TReply> | undefined = this.pending.get(id);
    if (!entry || entry.origin !== socket) return;
    this.pending.delete(id);
    entry.origin.removeListener('close', entry.onClose);
    entry.resolve(reply);
  }

  /**
   * Rejects a pending request with a reported failure. Ignored when the id is
   * unknown or the failure arrives from a socket other than the request's
   * origin.
   *
   * @param socket - The socket the failure arrived on.
   * @param id - The correlation id.
   * @param reason - Human-readable failure reason.
   */
  public fail(socket: WebSocket, id: string, reason: string): void {
    const entry: BrokerPending<TReply> | undefined = this.pending.get(id);
    if (!entry || entry.origin !== socket) return;
    this.pending.delete(id);
    entry.origin.removeListener('close', entry.onClose);
    entry.reject(new Error(reason));
  }
}
