/**
 * @file The top-panel status instrument: live session telemetry.
 *
 * The bar carries what changes. It used to carry a session id and three
 * version numbers — facts nobody acts on, occupying the one part of the page
 * always in view. Versions matter exactly when they disagree, so they appear
 * only then, and `version` reports them in full on demand.
 *
 * What replaces them was already on the wire and discarded: the daemon pushes
 * its process-index warm-up state with every prompt context, which is a live
 * count of the jobs this session knows about. The activity readout comes from
 * the typed progress channel, so the bar knows work is happening without the
 * console having to say so.
 *
 * Everything here is read-only projection; the bar issues no commands.
 *
 * @module
 */
import { CONTRACT_VERSION, type PromptContext } from '@fnndsc/menu';
import type { AttachInfo, ProgressMessage } from '../calypso/client.js';

/** The ids of the status fields the bar owns, as they appear in index.html. */
interface StatusFields {
  identity: HTMLElement;
  jobs: HTMLElement;
  activity: HTMLElement;
  latency: HTMLElement;
  mismatch: HTMLElement;
  lamp: HTMLElement;
  host: HTMLElement;
}

/** Frames for the activity indicator, matching the console's spinner. */
const ACTIVITY_FRAMES: readonly [string, ...string[]] = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'];

/** How often the activity indicator advances, in milliseconds. */
const ACTIVITY_FRAME_MS: number = 100;

/**
 * The status bar: paints live session telemetry into the LCARS top panel.
 */
export class StatusBar {
  private readonly fields: StatusFields;
  private readonly running: Set<string> = new Set<string>();
  private activityTimer: number | null = null;
  private activityFrame: number = 0;

  /**
   * @param root - The document to query the status fields from.
   * @throws {Error} When a required status element is missing from the page.
   */
  constructor(root: Document) {
    this.fields = {
      identity: element_require(root, 'status-identity'),
      jobs: element_require(root, 'status-jobs'),
      activity: element_require(root, 'status-activity'),
      latency: element_require(root, 'status-latency'),
      mismatch: element_require(root, 'status-mismatch'),
      lamp: element_require(root, 'status-lamp'),
      host: element_require(root, 'status-host'),
    };
  }

  /**
   * Records the attach facts, surfacing them only where they disagree.
   *
   * A matching contract and a healthy stack are the expected case and say
   * nothing worth a permanent readout. A mismatch is the one time these
   * numbers change what an operator should do, so that is when they appear.
   *
   * @param attach - The attach ack facts.
   */
  public attach_show(attach: AttachInfo): void {
    if (attach.protocolVersion !== CONTRACT_VERSION) {
      this.fields.mismatch.textContent =
        `WIRE V${attach.protocolVersion} ≠ V${CONTRACT_VERSION}`;
      this.fields.mismatch.title =
        'This surface and the daemon speak different contract versions. Some messages may be dropped.';
      this.hostControl_show(attach.hostControl ?? []);
      return;
    }
    this.fields.mismatch.textContent = '';
    this.fields.mismatch.title = attach.stack !== undefined
      ? `chell ${attach.stack.chell} · calypso ${attach.stack.calypso} · build ${attach.stack.build}`
      : '';
    this.hostControl_show(attach.hostControl ?? []);
  }

  /**
   * The HOST lamp: amber while the daemon acts on its own host, absent
   * otherwise — an annunciation, not an alert, and never at rest.
   *
   * @param tiers - The daemon's declared host-control tiers.
   */
  public hostControl_show(tiers: string[]): void {
    this.fields.host.textContent = tiers.length > 0 ? `HOST ${tiers.join(' ')}` : '';
    this.fields.host.title = tiers.length > 0
      ? 'This daemon was started with --host-control: `!` and pipes run on the daemon host, upload/download reach its disk.'
      : '';
  }

  /**
   * Paints the identity, the process-index count, and the last round-trip.
   *
   * @param context - The engine-known prompt facts.
   */
  public promptContext_show(context: PromptContext): void {
    const host: string = context.uri.replace(/^https?:\/\//, '');
    this.fields.identity.textContent = `${context.user}@${host}`.toUpperCase();

    const warmup = context.procWarmup;
    if (warmup === undefined) {
      this.fields.jobs.textContent = '';
    } else {
      const total: string = warmup.total !== undefined ? `/${warmup.total}` : '';
      const state: string = warmup.state !== undefined ? ` ${warmup.state.toUpperCase()}` : '';
      this.fields.jobs.textContent = `JOBS ${warmup.loaded}${total}${state}`;
    }

    this.fields.latency.textContent = context.lastCommandDurationMs > 0
      ? `${context.lastCommandDurationMs}MS`
      : '';
  }

  /**
   * Tracks live work so the bar shows that something is happening.
   *
   * Keyed the same way the console's progress rows are keyed, so one operation
   * reporting many items counts once rather than once per item.
   *
   * @param message - A progress event from the daemon.
   */
  public progress_observe(message: ProgressMessage): void {
    const key: string = `${message.operation}:${message.itemId ?? ''}`;
    if (message.phase === 'complete' || message.phase === 'failed') {
      this.running.delete(key);
    } else {
      this.running.add(key);
    }
    this.activity_paint();
  }

  /** Clears live work, at the boundary of the command that announced it. */
  public activity_clear(): void {
    this.running.clear();
    this.activity_paint();
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
    if (!connected) {
      this.activity_clear();
    }
  }

  /** Starts, stops, and repaints the activity readout to match live work. */
  private activity_paint(): void {
    if (this.running.size === 0) {
      if (this.activityTimer !== null) {
        clearInterval(this.activityTimer);
        this.activityTimer = null;
      }
      this.fields.activity.textContent = '';
      return;
    }
    const draw = (): void => {
      const frame: string = ACTIVITY_FRAMES[this.activityFrame] ?? ACTIVITY_FRAMES[0];
      this.fields.activity.textContent = `${frame} ${this.running.size} RUNNING`;
    };
    draw();
    if (this.activityTimer === null) {
      this.activityTimer = window.setInterval((): void => {
        this.activityFrame = (this.activityFrame + 1) % ACTIVITY_FRAMES.length;
        draw();
      }, ACTIVITY_FRAME_MS);
    }
  }
}

/**
 * Fetches a required element by id.
 *
 * @param root - The document to query.
 * @param id - The element id.
 * @returns The element.
 * @throws {Error} When the element is absent.
 */
function element_require(root: Document, id: string): HTMLElement {
  const element: HTMLElement | null = root.getElementById(id);
  if (element === null) {
    throw new Error(`status bar: no element with id '${id}'`);
  }
  return element;
}
