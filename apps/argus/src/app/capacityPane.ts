/**
 * @file The CAPACITY pane, as the host wires it: built from its template,
 * filled by asking the session `capacity [<family>]`, and opened beside the
 * focused pane (the dashboard's CAPACITY tile, a family's row on it, the
 * typed `capacity pane [<family>]`), or focused and re-asked when one
 * already stands.
 *
 * A module of the host, shaped as the NOTES pane's: the host hands in its
 * spawn and placement verbs and a quiet line to the session.
 */
import { STRATUS_CAPACITY_MODEL_KIND, capacityModelSchema, type CapacityModel } from '@fnndsc/menu';
import type { ExecuteOutcome } from '../calypso/client.js';
import { CapacityPanel } from '../features/capacity/panel.js';
import type { HostContext } from './hostContext.js';
import type { NotesPaneHooks } from './notesPane.js';
import { paneInstance_dispose, type PaneInstance } from './panes.js';

/** The CAPACITY pane verbs a wired host has. */
export interface CapacityPaneModule {
  /** Builds one CAPACITY pane. */
  instance_build: (id: string) => PaneInstance;
  /** Opens CAPACITY beside the focused pane (alone, from the dashboard) on a family, or on every family the region offers when none is named; returns what happened, for the console. */
  open: (family: string) => string;
}

/** The `stratus.capacity` model an outcome carries, or null. */
export function capacityModel_extract(outcome: ExecuteOutcome): CapacityModel | null {
  for (const envelope of outcome.envelopes) {
    if (envelope.model?.kind !== STRATUS_CAPACITY_MODEL_KIND) continue;
    const parsed = capacityModelSchema.safeParse(envelope.model.data);
    if (parsed.success) return parsed.data;
  }
  return null;
}

/**
 * Wires the CAPACITY pane to a host.
 *
 * @param context - The layout, the panels and the subjects.
 * @param hooks - The host's spawn and placement verbs, and the session line.
 * @returns The CAPACITY pane verbs.
 */
export function capacityPane_wire(context: Pick<HostContext, 'layout' | 'panels' | 'subjects'>, hooks: NotesPaneHooks): CapacityPaneModule {
  const { layout, panels, subjects } = context;
  const ask = async (line: string): Promise<CapacityModel | null> => capacityModel_extract(await hooks.ask(line));

  const instance_build = (id: string): PaneInstance => {
    const mount: HTMLElement = hooks.template_stamp('tpl-pane-capacity');
    panels.set('capacity', id, new CapacityPanel(mount, { ask }));
    return {
      id,
      kind: 'capacity',
      mount,
      dispose: (): void => {
        panels.delete(id);
        subjects.pane_leave(id);
      },
    };
  };

  const fill = (id: string, family: string): void => {
    void panels.get('capacity', id)?.family_ask(family);
  };

  const open = (family: string): string => {
    const said: string = family === '' ? 'every family the region offers' : family;
    const already: string | undefined = panels.ids('capacity').find((id: string): boolean => layout.panes_shown().includes(id));
    if (already !== undefined) {
      layout.focus_set(already);
      fill(already, family);
      return `capacity: on stage, reading ${said}`;
    }
    const fromDashboard: boolean = hooks.launcher_active();
    hooks.launcher_yield();
    const host: string = layout.focused_get() ?? 'files';
    const spawned: PaneInstance = hooks.instance_spawn('capacity');
    const placed: boolean = fromDashboard ? layout.leaf_replace('files', spawned.id) : layout.leaf_split(host, 'col', spawned.id, false);
    if (!placed) {
      paneInstance_dispose(spawned.id);
      layout.mount_remove(spawned.id);
      return 'capacity: could not open a pane';
    }
    if (fromDashboard) layout.focus_set(spawned.id);
    else hooks.birth_record(spawned.id, host, 'col', false);
    fill(spawned.id, family);
    return `capacity: what the region has free for ${said}, as a pane (capacity in the console prints it)`;
  };

  return { instance_build, open };
}
