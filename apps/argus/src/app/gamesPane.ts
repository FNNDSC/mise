/**
 * @file The GAMES pane, as the host wires it: built from its template, and
 * opened — or reused, when one stands — on a `games.show` model the kernel
 * answered (`sl`, `cmatrix`, `rain`, `asciiquarium`, `tetris`, `snake`).
 *
 * A module of the host, shaped as the HELP pane's: the host hands in its
 * spawn and placement verbs.
 */
import { GamesPanel, program_isName } from '../features/games/panel.js';
import type { HostContext } from './hostContext.js';
import type { HelpPaneHooks } from './helpPane.js';
import { paneInstance_dispose, type PaneInstance } from './panes.js';

/** The GAMES pane verbs a wired host has. */
export interface GamesPaneModule {
  /** Builds one GAMES pane. */
  instance_build: (id: string) => PaneInstance;
  /** Runs a program the kernel named, on the GAMES pane on stage or a new one beside the focused pane; returns what happened, for the console. */
  show: (data: unknown) => string;
}

/**
 * Wires the GAMES pane to a host.
 *
 * @param context - The layout, the panels and the subjects.
 * @param hooks - The host's spawn and placement verbs (the HELP pane's set).
 * @returns The GAMES pane verbs.
 */
export function gamesPane_wire(context: Pick<HostContext, 'layout' | 'panels' | 'subjects'>, hooks: HelpPaneHooks): GamesPaneModule {
  const { layout, panels, subjects } = context;

  const instance_build = (id: string): PaneInstance => {
    const mount: HTMLElement = hooks.template_stamp('tpl-pane-games');
    const panel: GamesPanel = new GamesPanel(mount);
    panels.set('games', id, panel);
    return {
      id,
      kind: 'games',
      mount,
      dispose: (): void => {
        panel.dispose();
        panels.delete(id);
        subjects.pane_leave(id);
      },
    };
  };

  const show = (data: unknown): string => {
    const program: unknown = typeof data === 'object' && data !== null ? (data as { program?: unknown }).program : undefined;
    if (typeof program !== 'string' || !program_isName(program)) return `games: no program named ${String(program)}`;
    const standing: string | undefined = panels.ids('games').find((id: string): boolean => layout.panes_shown().includes(id));
    if (standing !== undefined) {
      layout.focus_set(standing);
      panels.get('games', standing)?.program_run(program);
      return `games: ${program} on the GAMES pane`;
    }
    const fromDashboard: boolean = hooks.launcher_active();
    hooks.launcher_yield();
    const host: string = layout.focused_get() ?? 'files';
    const spawned: PaneInstance = hooks.instance_spawn('games');
    const placed: boolean = fromDashboard ? layout.leaf_replace('files', spawned.id) : layout.leaf_split(host, 'col', spawned.id, false);
    if (!placed) {
      paneInstance_dispose(spawned.id);
      layout.mount_remove(spawned.id);
      return 'games: could not open a pane';
    }
    if (fromDashboard) layout.focus_set(spawned.id);
    else hooks.birth_record(spawned.id, host, 'col', false);
    panels.get('games', spawned.id)?.program_run(program);
    return `games: ${program} in a GAMES pane (Esc gives the keyboard back; its PAUSE and RESTART pills on the frame)`;
  };

  return { instance_build, show };
}
