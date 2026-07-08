/**
 * @file The CALYPSO daemon: a WebSocket host over one engine.
 *
 * The daemon binds the loopback interface only and hosts a single hosted
 * engine. A surface attaches with the contract version and the attach token
 * (compared in constant time); once attached, it drives the engine with
 * `execute` and `complete` messages and receives `result` and completion
 * replies. Command execution is serialized per connection — shell semantics,
 * and what keeps each command's error boundary correct.
 *
 * This first slice returns each command's final result envelopes. Live output
 * streaming and the cross-surface session bus build on it (see the session-bus
 * work). CUBE credentials never cross the wire: the engine the daemon hosts
 * holds its own CUBE session, established by the launcher exactly as the CLI
 * does; surfaces authenticate to the daemon, not to CUBE.
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
import type { ServerMessage, executeMessageSchema, completeRequestSchema } from '../protocol/messages.js';
import type { z } from 'zod';
import type { CommandEnvelope } from '@fnndsc/cumin';

type ExecuteMessage = z.infer<typeof executeMessageSchema>;
type CompleteRequest = z.infer<typeof completeRequestSchema>;

/**
 * Options for creating a daemon.
 *
 * @property engine - The engine to host.
 * @property token - The attach token a surface must present.
 * @property port - The port to bind; 0 (default) picks an ephemeral port.
 * @property host - The interface to bind; loopback (`127.0.0.1`) by default.
 */
export interface DaemonOptions {
  engine: HostedEngine;
  token: string;
  port?: number;
  host?: string;
}

/**
 * A WebSocket daemon hosting one engine for attached surfaces.
 */
export class CalypsoDaemon {
  private readonly engine: HostedEngine;
  private readonly token: string;
  private readonly port: number;
  private readonly host: string;
  private wss: WebSocketServer | null = null;

  /**
   * @param options - The engine to host, the attach token, and the bind
   *   address.
   */
  constructor(options: DaemonOptions) {
    this.engine = options.engine;
    this.token = options.token;
    this.port = options.port ?? 0;
    this.host = options.host ?? '127.0.0.1';
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
   * command dispatch.
   *
   * @param socket - The connected surface.
   */
  private connection_handle(socket: WebSocket): void {
    let attached: boolean = false;
    // Serializes execution: one foreground command at a time, the rest queued.
    let queue: Promise<void> = Promise.resolve();

    socket.on('message', (data: RawData) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch (err: unknown) {
        const message: string = err instanceof Error ? err.message : String(err);
        this.send(socket, { type: 'error', reason: `malformed JSON: ${message}` });
        return;
      }

      if (!attached) {
        attached = this.attach_handle(socket, parsed);
        return;
      }

      const message = clientMessage_parse(parsed);
      if (!message.ok || message.value === undefined) {
        this.send(socket, { type: 'error', reason: message.error ?? 'invalid message' });
        return;
      }
      const value = message.value;
      if (value.type === 'execute') {
        queue = queue.then(() => this.execute_run(socket, value));
      } else if (value.type === 'complete') {
        void this.complete_run(socket, value);
      } else {
        this.send(socket, { type: 'error', reason: 'already attached' });
      }
    });
  }

  /**
   * Validates an attach handshake: contract version, then constant-time
   * token check. On success the surface is acknowledged; on failure it is
   * told why and disconnected.
   *
   * @param socket - The connecting surface.
   * @param raw - The first message received.
   * @returns True when the surface is now attached.
   */
  private attach_handle(socket: WebSocket, raw: unknown): boolean {
    const attach = attach_parse(raw);
    if (!attach.ok || attach.value === undefined) {
      this.send(socket, { type: 'error', reason: attach.error ?? 'invalid attach' });
      socket.close();
      return false;
    }
    if (!token_matches(this.token, attach.value.token)) {
      this.send(socket, { type: 'error', reason: 'invalid token' });
      socket.close();
      return false;
    }
    const session: string = attach.value.session ?? randomBytes(8).toString('hex');
    this.send(socket, { type: 'attached', session, protocolVersion: CONTRACT_VERSION });
    return true;
  }

  /**
   * Runs one execute request and sends its result, or an error.
   *
   * @param socket - The surface to reply to.
   * @param message - The execute request.
   */
  private async execute_run(socket: WebSocket, message: ExecuteMessage): Promise<void> {
    try {
      const envelopes: CommandEnvelope[] = await this.engine.line_execute(message.line);
      this.send(socket, { type: 'result', id: message.id, envelopes });
    } catch (err: unknown) {
      const reason: string = err instanceof Error ? err.message : String(err);
      this.send(socket, { type: 'error', id: message.id, reason });
    }
  }

  /**
   * Runs one completion request and sends its reply, or an error.
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
