/**
 * @file A wait's progress, drawn where the wait is.
 *
 * AEGIS law a-wait-over-two-seconds-shows-progress: anything that changes
 * the surface and takes more than two seconds shows a bar that moves, or —
 * when the end cannot be counted (a question to the session) — says what
 * it is waiting on and runs an indeterminate bar. A wait with nothing on
 * screen reads as a dead surface.
 *
 * The readout sits over the field it is filling, bottom-left, and takes no
 * pointer: the field under it stays live while it waits.
 *
 * @module
 */

/** A wait's readout over one field. */
export class WaitProgress {
  private readonly root: HTMLDivElement;
  private readonly label: HTMLSpanElement;
  private readonly fill: HTMLSpanElement;

  /**
   * Mounts the readout, hidden, over a field.
   *
   * @param host - The field; positioned, so the readout can sit over it.
   */
  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'wait-progress';
    this.root.hidden = true;
    this.root.setAttribute('role', 'progressbar');
    this.root.setAttribute('aria-valuemin', '0');
    this.root.setAttribute('aria-valuemax', '100');
    this.label = document.createElement('span');
    this.label.className = 'wait-progress-label';
    const track: HTMLSpanElement = document.createElement('span');
    track.className = 'wait-progress-track';
    this.fill = document.createElement('span');
    this.fill.className = 'wait-progress-fill';
    track.appendChild(this.fill);
    this.root.append(this.label, track);
    host.appendChild(this.root);
  }

  /**
   * Shows the wait.
   *
   * @param label - What is being waited on, in the surface's words.
   * @param fraction - How far it has come, 0..1; null when it cannot be counted.
   */
  public show(label: string, fraction: number | null): void {
    this.root.hidden = false;
    this.label.textContent = fraction === null ? label : `${label} · ${Math.floor(fraction * 100)}%`;
    this.root.classList.toggle('wait-progress-indeterminate', fraction === null);
    this.fill.style.width = fraction === null ? '' : `${Math.max(0, Math.min(1, fraction)) * 100}%`;
    if (fraction === null) this.root.removeAttribute('aria-valuenow');
    else this.root.setAttribute('aria-valuenow', String(Math.floor(fraction * 100)));
  }

  /** The wait is over. */
  public hide(): void {
    this.root.hidden = true;
  }

  /** @returns Whether a wait is showing. */
  public shown(): boolean {
    return !this.root.hidden;
  }
}
