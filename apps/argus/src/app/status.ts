/**
 * @file The top-panel status instrument: session telemetry.
 *
 * The LCARS top bar carries the facts the attach handshake and prompt
 * pushes already yield: the connected identity, the session id, the contract
 * version, the daemon's stack version, and a connection lamp. Everything
 * here is read-only projection; the bar issues no commands.
 *
 * @module
 */
import type { PromptContext } from '@fnndsc/calypso/protocol';
import type { AttachInfo } from '../calypso/client.js';

/** The ids of the status fields the bar owns, as they appear in index.html. */
interface StatusFields {
  identity: HTMLElement;
  session: HTMLElement;
  contract: HTMLElement;
  stack: HTMLElement;
  lamp: HTMLElement;
}

/**
 * The status bar: paints session telemetry into the LCARS top panel.
 */
export class StatusBar {
  private readonly fields: StatusFields;

  /**
   * @param root - The document to query the status fields from.
   * @throws {Error} When a required status element is missing from the page.
   */
  constructor(root: Document) {
    this.fields = {
      identity: element_require(root, 'status-identity'),
      session: element_require(root, 'status-session'),
      contract: element_require(root, 'status-contract'),
      stack: element_require(root, 'status-stack'),
      lamp: element_require(root, 'status-lamp'),
    };
  }

  /**
   * Paints the attach facts: session id, contract version, daemon stack.
   *
   * @param attach - The attach ack facts.
   */
  public attach_show(attach: AttachInfo): void {
    this.fields.session.textContent = attach.session.slice(0, 8).toUpperCase();
    this.fields.contract.textContent = `WIRE V${attach.protocolVersion}`;
    this.fields.stack.textContent =
      attach.stack !== undefined ? `CHELL ${attach.stack.chell} · CALYPSO ${attach.stack.calypso}` : 'STACK UNKNOWN';
  }

  /**
   * Paints the identity from a prompt context push.
   *
   * @param context - The engine-known prompt facts.
   */
  public promptContext_show(context: PromptContext): void {
    const host: string = context.uri.replace(/^https?:\/\//, '');
    this.fields.identity.textContent = `${context.user}@${host}`.toUpperCase();
  }

  /**
   * Sets the connection lamp.
   *
   * @param connected - Whether the session socket is open.
   */
  public connection_show(connected: boolean): void {
    this.fields.lamp.textContent = connected ? 'ONLINE' : 'OFFLINE';
    this.fields.lamp.classList.toggle('lamp-online', connected);
    this.fields.lamp.classList.toggle('lamp-offline', !connected);
  }
}

/**
 * Fetches a required element by id.
 *
 * @param root - The document to query.
 * @param id - The element id.
 * @returns The element.
 * @throws {Error} When the element does not exist.
 */
function element_require(root: Document, id: string): HTMLElement {
  const element: HTMLElement | null = root.getElementById(id);
  if (element === null) {
    throw new Error(`required element #${id} is missing`);
  }
  return element;
}
