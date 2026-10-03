/**
 * @file The HELP pane, as the host wires it: built from its template, and
 * opened beside the focused pane (the dashboard's HELP tile, the typed
 * `help`), or focused when one already stands.
 *
 * A module of the host: the host hands in its spawn and placement verbs.
 */
import { HelpPanel } from '../features/help/panel.js';
import type { HostContext } from './hostContext.js';
import { paneInstance_dispose, type PaneInstance, type PaneKind } from './panes.js';

/** What the HELP pane asks of the host. */
export interface HelpPaneHooks {
  instance_spawn: (kind: PaneKind, inheritFrom?: string) => PaneInstance;
  birth_record: (childId: string, parent: string, dir: 'row' | 'col', before: boolean) => void;
  /** The launcher steps aside before a pane opens. */
  launcher_yield: () => void;
  template_stamp: (templateId: string) => HTMLElement;
}

/** The HELP pane verbs a wired host has. */
export interface HelpPaneModule {
  /** Builds one HELP pane. */
  instance_build: (id: string) => PaneInstance;
  /** Opens HELP beside the focused pane; returns what happened, for the console. */
  open: () => string;
}

/**
 * Wires the HELP pane to a host.
 *
 * @param context - The layout, the panels and the subjects.
 * @param hooks - The host's spawn and placement verbs.
 * @returns The HELP pane verbs.
 */
export function helpPane_wire(context: Pick<HostContext, 'layout' | 'panels' | 'subjects'>, hooks: HelpPaneHooks): HelpPaneModule {
  const { layout, panels, subjects } = context;

  const instance_build = (id: string): PaneInstance => {
    const mount: HTMLElement = hooks.template_stamp('tpl-pane-help');
    panels.set('help', id, new HelpPanel(mount));
    return {
      id,
      kind: 'help',
      mount,
      dispose: (): void => {
        panels.delete(id);
        subjects.pane_leave(id);
      },
    };
  };

  const open = (): string => {
    const already: string | undefined = panels.ids('help').find((id: string): boolean => layout.panes_shown().includes(id));
    if (already !== undefined) {
      layout.focus_set(already);
      return 'help: on stage';
    }
    hooks.launcher_yield();
    const host: string = layout.focused_get() ?? 'files';
    const spawned: PaneInstance = hooks.instance_spawn('help');
    if (!layout.leaf_split(host, 'col', spawned.id, false)) {
      paneInstance_dispose(spawned.id);
      layout.mount_remove(spawned.id);
      return 'help: could not open a pane';
    }
    hooks.birth_record(spawned.id, host, 'col', false);
    return 'help: the keys and the verbs, as a pane (help keys, help verbs print them here)';
  };

  return { instance_build, open };
}
