/**
 * @file The editor, as the host wires it: the kernel's `edit` answered with
 * a pane.
 *
 * `edit <file>` reads the file in the kernel and asks the surface to edit it.
 * A terminal opens `$EDITOR`; this surface opens an EDIT pane beside the
 * focused one and answers at once that it opened. The pane lives on, and each
 * save it makes is the line the operator could have typed, echoed and run
 * (aegis.adoc: an-editors-save-is-a-line).
 *
 * A pane is one file: a second `edit` of the same file finds its pane (and
 * leaves unsaved changes standing), a different file opens another pane.
 *
 * A module of the host: the host hands in its spawn and placement verbs; the
 * module keeps the pane instances and their saves.
 */
import type { ExecuteOutcome, SurfaceEdit } from '../calypso/client.js';
import { EditPanel } from '../features/edit/panel.js';
import { editLine_compose, extension_of, saveLine_compose } from '../features/edit/line.js';
import type { ReplayPlace } from './desktop.js';
import type { HostContext } from './hostContext.js';
import { paneInstance_dispose, type PaneInstance, type PaneKind } from './panes.js';

/** What the editor asks of the host. */
export interface EditorHooks {
  instance_spawn: (kind: PaneKind, inheritFrom?: string) => PaneInstance;
  birth_record: (childId: string, parent: string, dir: 'row' | 'col', before: boolean) => void;
  /** The split a replayed open must use; null in normal use. */
  replayPlace_get: () => ReplayPlace | null;
  /** A pane on stage to open beside when nothing is focused; null when none stands. */
  errandHost_find: () => string | null;
  /** The launcher steps aside before a pane opens. */
  launcher_yield: () => void;
  template_stamp: (templateId: string) => HTMLElement;
}

/** The editor verbs a wired host has. */
export interface EditorModule {
  /** Builds one EDIT pane. */
  instance_build: (id: string) => PaneInstance;
  /** The kernel asked this surface to edit a file: true when a pane took it. */
  edit_receive: (request: SurfaceEdit) => boolean;
  /**
   * Opens a file in an EDIT pane by asking the kernel, the pane on stage
   * first (a replay places it; the row verb presses it).
   *
   * @returns The pane's id, or null when none could stand.
   */
  edit_open: (path: string, options?: { visible?: boolean }) => string | null;
}

/**
 * Wires the editor to a host.
 *
 * @param context - The layout, the panels, the console and the wire.
 * @param hooks - The host's spawn and placement verbs.
 * @returns The editor verbs.
 */
export function editor_wire(context: Pick<HostContext, 'layout' | 'panels' | 'subjects' | 'terminal' | 'client'>, hooks: EditorHooks): EditorModule {
  const { layout, panels, subjects } = context;

  /**
   * Writes a pane's text to its file as a line: echoed, run, its answer
   * written. It runs as a typed line does, never silent: its answer streams
   * into the console and it reaches the session's scrollback, where a silent
   * line's answer would be swallowed. The file took it when every envelope
   * says ok.
   */
  const save = async (path: string, text: string): Promise<boolean> => {
    const { terminal, client } = context;
    const line: string = saveLine_compose(path, text);
    terminal.line_echo(line);
    let outcome: ExecuteOutcome;
    try {
      outcome = await client.line_execute(line);
    } catch (error: unknown) {
      terminal.output_write('err', `\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m\n`);
      return false;
    }
    terminal.outcome_write(outcome);
    return outcome.envelopes.length > 0 && outcome.envelopes.every((envelope): boolean => envelope.status === 'ok');
  };

  const instance_build = (id: string): PaneInstance => {
    const mount: HTMLElement = hooks.template_stamp('tpl-pane-edit');
    const panel: EditPanel = new EditPanel(mount, {
      save,
      note: (line: string): void => context.terminal.line_note(line),
    });
    panels.set('edit', id, panel);
    return {
      id,
      kind: 'edit',
      mount,
      dispose: (): void => {
        panel.dispose();
        panels.delete(id);
        subjects.pane_leave(id);
      },
    };
  };

  /** The EDIT pane on stage holding a file, if one does. */
  const paneOf_path = (path: string): string | null => {
    const shown: Set<string> = new Set(layout.panes_shown());
    for (const [id, panel] of panels.entries('edit')) {
      if (shown.has(id) && panel.path_get() === path) return id;
    }
    return null;
  };

  /** A new EDIT pane split beside the focused pane (or where a replay says). */
  const pane_spawn = (): string | null => {
    hooks.launcher_yield();
    const shown: Set<string> = new Set(layout.panes_shown());
    const focused: string | null = layout.focused_get();
    const host: string | null = focused !== null && shown.has(focused) ? focused : hooks.errandHost_find();
    if (host === null) return null;
    const spawned: PaneInstance = hooks.instance_spawn('edit');
    const place: ReplayPlace | null = hooks.replayPlace_get();
    if (!layout.leaf_split(host, place?.dir ?? 'col', spawned.id, place?.before ?? false)) {
      paneInstance_dispose(spawned.id);
      layout.mount_remove(spawned.id);
      return null;
    }
    hooks.birth_record(spawned.id, host, place?.dir ?? 'col', place?.before ?? false);
    return spawned.id;
  };

  const edit_receive = (request: SurfaceEdit): boolean => {
    const path: string = request.path ?? '';
    if (path === '') {
      // A save needs a file to go to; an edit the kernel could not name is refused.
      throw new Error('the editor pane needs the file it edits, and the request named none');
    }
    const id: string | null = paneOf_path(path) ?? pane_spawn();
    if (id === null) return false;
    const panel: EditPanel | undefined = panels.get('edit', id);
    if (panel === undefined) return false;
    layout.focus_set(id);
    if (panel.dirty_is()) {
      // A second `edit` of a file being changed keeps the change: the field is
      // the operator's work, and only REVERT throws it away.
      context.terminal.line_note(`edit: ${path}: its pane has unsaved changes; they stand (REVERT reads the file again)`);
      return true;
    }
    void panel.content_show({ path, content: request.content, extension: request.extension ?? extension_of(path) });
    return true;
  };

  const edit_open = (path: string, options: { visible?: boolean } = {}): string | null => {
    const id: string | null = paneOf_path(path) ?? pane_spawn();
    if (id === null) return null;
    const panel: EditPanel | undefined = panels.get('edit', id);
    if (panel === undefined) return null;
    layout.focus_set(id);
    if (!panel.dirty_is()) panel.opening_show(path);
    const line: string = editLine_compose(path);
    if (options.visible === true) {
      context.terminal.line_run(line);
      return id;
    }
    // A replay asks quietly: the pane is the account of what it did.
    void context.client.line_execute(line, { silent: true, observe: false }).then((outcome: ExecuteOutcome): void => {
      const refused = outcome.envelopes.find((envelope): boolean => envelope.status !== 'ok');
      if (refused !== undefined) panel.opening_fail((refused.renderedErr ?? '').replace(/\x1b\[[0-9;]*m/g, '').trim() || 'the kernel refused');
    }).catch((error: unknown): void => panel.opening_fail(error instanceof Error ? error.message : String(error)));
    return id;
  };

  return { instance_build, edit_receive, edit_open };
}
