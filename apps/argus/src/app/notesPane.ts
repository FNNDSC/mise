/**
 * @file The NOTES pane, as the host wires it: built from its template,
 * filled by asking the session `notes`, and opened beside the focused pane
 * (the dashboard's WHAT'S NEW block, the typed `notes pane`), or focused
 * when one already stands.
 *
 * A module of the host, shaped as the HELP pane's: the host hands in its
 * spawn and placement verbs and a quiet line to the session.
 */
import { SESSION_NOTES_MODEL_KIND, sessionNotesSchema, type SessionNotes } from '@fnndsc/menu';
import type { ExecuteOutcome } from '../calypso/client.js';
import { NotesPanel } from '../features/notes/panel.js';
import type { HostContext } from './hostContext.js';
import type { HelpPaneHooks } from './helpPane.js';
import { paneInstance_dispose, type PaneInstance } from './panes.js';

/** What the NOTES pane asks of the host beyond the HELP pane's set. */
export interface NotesPaneHooks extends HelpPaneHooks {
  /** Asks the session a line, quietly. */
  ask: (line: string) => Promise<ExecuteOutcome>;
}

/** The NOTES pane verbs a wired host has. */
export interface NotesPaneModule {
  /** Builds one NOTES pane. */
  instance_build: (id: string) => PaneInstance;
  /** Opens NOTES beside the focused pane (alone, from the dashboard) and fills it; returns what happened, for the console. */
  open: () => string;
  /** The newest release's notes, for the dashboard block; null when the session has none. */
  latest: () => Promise<SessionNotes | null>;
}

/** The `session.notes` model an outcome carries, or null. */
export function notesModel_of(outcome: ExecuteOutcome): SessionNotes | null {
  for (const envelope of outcome.envelopes) {
    if (envelope.model?.kind !== SESSION_NOTES_MODEL_KIND) continue;
    const parsed = sessionNotesSchema.safeParse(envelope.model.data);
    if (parsed.success) return parsed.data;
  }
  return null;
}

/**
 * Wires the NOTES pane to a host.
 *
 * @param context - The layout, the panels and the subjects.
 * @param hooks - The host's spawn and placement verbs, and the session line.
 * @returns The NOTES pane verbs.
 */
export function notesPane_wire(context: Pick<HostContext, 'layout' | 'panels' | 'subjects'>, hooks: NotesPaneHooks): NotesPaneModule {
  const { layout, panels, subjects } = context;
  const ask = async (line: string): Promise<SessionNotes | null> => notesModel_of(await hooks.ask(line));

  const instance_build = (id: string): PaneInstance => {
    const mount: HTMLElement = hooks.template_stamp('tpl-pane-notes');
    panels.set('notes', id, new NotesPanel(mount, { ask }));
    return {
      id,
      kind: 'notes',
      mount,
      dispose: (): void => {
        panels.delete(id);
        subjects.pane_leave(id);
      },
    };
  };

  const fill = (id: string): void => {
    void ask('notes').then((model: SessionNotes | null): void => {
      if (model !== null) panels.get('notes', id)?.model_show(model);
    });
  };

  const open = (): string => {
    const already: string | undefined = panels.ids('notes').find((id: string): boolean => layout.panes_shown().includes(id));
    if (already !== undefined) {
      layout.focus_set(already);
      fill(already);
      return 'notes: on stage';
    }
    const fromDashboard: boolean = hooks.launcher_active();
    hooks.launcher_yield();
    const host: string = layout.focused_get() ?? 'files';
    const spawned: PaneInstance = hooks.instance_spawn('notes');
    const placed: boolean = fromDashboard ? layout.leaf_replace('files', spawned.id) : layout.leaf_split(host, 'col', spawned.id, false);
    if (!placed) {
      paneInstance_dispose(spawned.id);
      layout.mount_remove(spawned.id);
      return 'notes: could not open a pane';
    }
    if (fromDashboard) layout.focus_set(spawned.id);
    else hooks.birth_record(spawned.id, host, 'col', false);
    fill(spawned.id);
    return 'notes: what the installed releases changed, as a pane (notes in the console prints it)';
  };

  return { instance_build, open, latest: (): Promise<SessionNotes | null> => ask('notes') };
}
