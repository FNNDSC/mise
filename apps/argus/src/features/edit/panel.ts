/**
 * @file The EDIT pane: one file, in a guest field, saved by visible lines.
 *
 * The kernel's `edit` asks the surface to edit a file; this pane is where a
 * browser does it. The field is CodeMirror's (an-instruments-field-is-foreign)
 * and the frame is mise's: SAVE and REVERT ride the mode frame, the bar says
 * DIRTY or SAVED, and FOCUS is lit while the field holds the keyboard. A
 * save is never a hidden write: the host runs it as the line the operator
 * could have typed, so the transcript holds every save
 * (aegis.adoc: an-editors-save-is-a-line).
 *
 * @module
 */
import { barState_set } from '../roster/bar.js';
import { STALE_PAGE_READOUT, stalePage_is } from '../../app/stalePage.js';
import type { EditField } from './field.js';

/** What the pane asks of its host. */
export interface EditHandlers {
  /** Writes the text to the file as a visible line; resolves whether it took. */
  save: (path: string, text: string) => Promise<boolean>;
  /** Writes a line of the surface's own into the transcript. */
  note: (line: string) => void;
}

/** A file to show in the pane. */
export interface EditOpen {
  /** The file, where saves go. */
  path: string;
  /** Its text as the kernel read it. */
  content: string;
  /** Its extension, for the field's syntax colours. */
  extension: string;
}

/** The EDIT pane's controller. */
export class EditPanel {
  private readonly mount: HTMLElement;
  private readonly handlers: EditHandlers;
  private readonly titleSpan: HTMLElement | null;
  private readonly stateSpan: HTMLElement | null;
  private readonly fieldSection: HTMLElement;
  private readonly savePill: HTMLButtonElement;
  private readonly revertPill: HTMLButtonElement;
  private readonly focusMark: HTMLElement | null;
  private field: EditField | null = null;
  private path: string | null = null;
  /** The file's text as last read or saved: what DIRTY is measured against. */
  private original: string = '';
  private saving: boolean = false;
  private fieldBuild: Promise<EditField | null> | null = null;

  /**
   * @param mount - The stamped pane element (`tpl-pane-edit`).
   * @param handlers - Host callbacks.
   */
  constructor(mount: HTMLElement, handlers: EditHandlers) {
    this.mount = mount;
    this.handlers = handlers;
    this.titleSpan = mount.querySelector<HTMLElement>('.pane-title');
    this.stateSpan = mount.querySelector<HTMLElement>('.pane-state');
    this.fieldSection = this.element_require<HTMLElement>('.edit-field');
    this.savePill = this.element_require<HTMLButtonElement>('.edit-save');
    this.revertPill = this.element_require<HTMLButtonElement>('.edit-revert');
    this.focusMark = mount.querySelector<HTMLElement>('.edit-focus');
    this.savePill.addEventListener('click', (): void => { void this.save(); });
    this.revertPill.addEventListener('click', (): void => this.revert());
    // Ctrl-S (Cmd-S) saves from inside the field: the browser's own save of
    // the page is never what an operator editing a file meant.
    mount.addEventListener('keydown', (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        event.stopPropagation();
        void this.save();
      }
    }, { capture: true });
    // The mark is painted from the gestures as well as the focus events: a
    // window without focus (a headless run, a background tab) still moves
    // the keyboard but fires no focusin.
    this.fieldSection.addEventListener('mousedown', (): void => this.focusMark_set(true));
    this.fieldSection.addEventListener('focusin', (): void => this.focusMark_set(true));
    this.fieldSection.addEventListener('focusout', (event: FocusEvent): void => {
      if (!(event.relatedTarget instanceof Node) || !this.fieldSection.contains(event.relatedTarget)) this.focusMark_set(false);
    });
    this.controls_sync();
  }

  /**
   * Says on the bar that a file is on its way, before the kernel has read it.
   *
   * @param path - The file being opened.
   */
  public opening_show(path: string): void {
    this.path = path;
    this.title_set(path);
    barState_set(this.stateSpan, 'wait', 'OPENING');
  }

  /**
   * Shows a file: a fresh field the first time, the same field after.
   *
   * @param open - The file and its text.
   * @returns Once the field stands.
   */
  public async content_show(open: EditOpen): Promise<void> {
    this.path = open.path;
    this.original = open.content;
    this.title_set(open.path);
    // One field per pane, built once; a second open while it builds waits on the same build.
    this.fieldBuild ??= this.field_build(open);
    const field: EditField | null = await this.fieldBuild;
    if (field === null) return;
    if (field.text_get() !== this.original) field.text_set(this.original);
    this.controls_sync();
    field.focus();
    this.focusMark_set(true);
  }

  /**
   * Loads the guest library and builds the field, saying on the bar when the
   * page is of an older build than the server's and the chunk is gone.
   *
   * @param open - The first file, whose text the field opens with.
   * @returns The field, or null when its code could not be loaded.
   */
  private async field_build(open: EditOpen): Promise<EditField | null> {
    let fieldModule: typeof import('./field.js');
    try {
      fieldModule = await import('./field.js');
    } catch (error: unknown) {
      if (!stalePage_is(error)) throw error;
      barState_set(this.stateSpan, 'stale', STALE_PAGE_READOUT);
      this.handlers.note(`edit: ${STALE_PAGE_READOUT.toLowerCase()} — the editor's code is of an older build than the server has`);
      return null;
    }
    this.field = await fieldModule.editField_create(this.fieldSection, open.content, open.extension, (): void => this.controls_sync());
    return this.field;
  }

  /**
   * Says on the bar that the file could not be opened.
   *
   * @param reason - Why, in words.
   */
  public opening_fail(reason: string): void {
    barState_set(this.stateSpan, 'refused', `NOT OPENED · ${reason.toUpperCase()}`);
  }

  /**
   * Writes the field to the file, as a line, when it differs from the file.
   *
   * @returns Whether the file now holds the field's text.
   */
  public async save(): Promise<boolean> {
    if (this.field === null || this.path === null || this.saving) return false;
    const text: string = this.field.text_get();
    if (text === this.original) return true;
    this.saving = true;
    this.controls_sync();
    let took: boolean = false;
    try {
      took = await this.handlers.save(this.path, text);
    } finally {
      this.saving = false;
    }
    if (took) this.original = text;
    this.controls_sync();
    if (!took) barState_set(this.stateSpan, 'refused', 'NOT SAVED · THE CONSOLE SAYS WHY');
    return took;
  }

  /** Puts the file's text back in the field, every change since the last save gone. */
  public revert(): void {
    if (this.field === null || !this.dirty_is()) return;
    this.field.text_set(this.original);
    this.controls_sync();
  }

  /** Whether the field differs from the file. */
  public dirty_is(): boolean {
    return this.field !== null && this.field.text_get() !== this.original;
  }

  /** The file the pane edits, or null before the first open. */
  public path_get(): string | null {
    return this.path;
  }

  /**
   * Takes the keyboard back from the field (Esc's first step on this pane).
   *
   * @returns True when the field held it.
   */
  public field_release(): boolean {
    if (this.field === null || !this.field.hasFocus()) return false;
    this.field.blur();
    this.focusMark_set(false);
    return true;
  }

  /** Releases the field. */
  public dispose(): void {
    this.field?.destroy();
    this.field = null;
  }

  /** The bar and the frame follow the field: DIRTY lights SAVE and REVERT, SAVED dims them. */
  private controls_sync(): void {
    const dirty: boolean = this.dirty_is();
    this.savePill.disabled = !dirty || this.saving;
    this.revertPill.disabled = !dirty || this.saving;
    this.mount.dataset['dirty'] = dirty ? 'yes' : 'no';
    if (this.field === null) return;
    if (this.saving) barState_set(this.stateSpan, 'wait', 'SAVING');
    else if (dirty) barState_set(this.stateSpan, 'note', 'DIRTY');
    else barState_set(this.stateSpan, 'settled', 'SAVED');
  }

  /** The bar's title: the verb and the file, as the console would say it. */
  private title_set(path: string): void {
    if (this.titleSpan !== null) this.titleSpan.textContent = `EDIT ${path.split('/').pop() ?? path}`.toUpperCase();
    this.mount.title = path;
  }

  private focusMark_set(on: boolean): void {
    if (this.focusMark !== null) this.focusMark.hidden = !on;
  }

  private element_require<T extends HTMLElement>(selector: string): T {
    const found: T | null = this.mount.querySelector<T>(selector);
    if (found === null) throw new Error(`edit pane: no ${selector} in its template`);
    return found;
  }
}
