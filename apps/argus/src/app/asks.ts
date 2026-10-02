/**
 * @file Where a question stands. A transient question belongs where the
 * hand is: a verb pressed on a pane asks on that pane; a `path` ask borrows
 * a browser beside the pane that asked, as an errand with a bar of its own;
 * only a question with no pane to stand on goes to the console, which
 * exposes itself to ask it. The console records every exchange either way,
 * so the scrollback stays the whole story of the session.
 *
 * A module of the host: the host hands in its spawn, its births, the
 * replay place, the rooted listing and the console drawer as hooks.
 */
import type { SurfaceAsk } from '../calypso/client.js';
import { paneAsk_open, type PaneAskRequest } from '../features/ask/paneAsk.js';
import type { FilesPanel } from '../features/files/panel.js';
import type { ReplayPlace } from './desktop.js';
import type { HostContext } from './hostContext.js';
import type { LayoutNode } from './layout.js';
import { paneInstance_dispose, type PaneInstance, type PaneKind } from './panes.js';

/** What the asks need of the host. */
export interface AskHooks {
  instance_spawn: (kind: PaneKind, inheritFrom?: string) => PaneInstance;
  birth_record: (childId: string, parent: string, dir: 'row' | 'col', before: boolean) => void;
  replayPlace_get: () => ReplayPlace | null;
  rootedListing_show: (id: string, panel: FilesPanel, path: string) => void;
  /** Opens the console drawer: a closed console is a question nobody can see. */
  console_expose: () => void;
}

/** The ask verbs a wired host has. */
export interface Asks {
  /** A pane on stage where an errand or the band's work lands: the focused one if it is on stage, else the first leaf. */
  errandHost_find: () => string | null;
  /** The question a `path` ask puts on stage, as an errand beside the host pane. */
  errand_open: (request: SurfaceAsk) => Promise<string | null>;
  /**
   * Abandons the errand on stage, when there is one.
   *
   * @returns Whether one stood.
   */
  errand_abandon: () => boolean;
  /** Runs a row's or a field's verb as the visible command it is, and remembers which pane pressed it. */
  verbLine_run: (id: string, line: string) => void;
  /** The pane whose pressed verb is running a line, taken once: a later question never inherits a stale pane. */
  askingPane_take: () => string | null;
  /** Puts a question on the pane that provoked it, or on the console when the pane is not on stage. */
  ask_onPane: (id: string, request: PaneAskRequest) => Promise<string | null>;
}

/**
 * Wires the asks to a host.
 *
 * @param context - The layout, the panels, the pane mounts and the console.
 * @param hooks - The host's spawn, births, replay place, listing and drawer.
 * @returns The ask verbs.
 */
export function asks_wire(context: Pick<HostContext, 'layout' | 'panels' | 'paneInstance_get' | 'terminal'>, hooks: AskHooks): Asks {
  const { panels, paneInstance_get } = context;
  let errandClose: (() => void) | null = null;
  /**
   * The pane whose pressed verb is running a line. A verb lowers to a
   * command, and the command may have a question of its own — `rm -i`
   * asks before it removes. That question belongs where the press was.
   */
  let askingPane: string | null = null;

  const errandHost_find = (): string | null => {
    const { layout } = context;
    const tree: LayoutNode | null = layout.tree_get();
    if (tree === null) return null;
    const leaves: string[] = [];
    const walk = (node: LayoutNode): void => {
      if ('pane' in node) { leaves.push(node.pane); return; }
      walk(node.first);
      walk(node.second);
    };
    walk(tree);
    const focused: string | null = layout.focused_get();
    if (focused !== null && leaves.includes(focused)) return focused;
    return leaves[0] ?? null;
  };

  /**
   * An ask is never a box: it borrows the instrument that already shows the
   * space being asked about. A location wants a browser, so one opens
   * beside the pane that asked — a NEW one, since hijacking the operator's
   * own browser would lose their place — anchored where the ask said, and
   * it closes when the errand ends either way. The errand's controls ride a
   * bar of their own across the top of the pane: the question as a caption,
   * the composed path as an editable field, and one verb that commits.
   */
  const errand_open = async (request: SurfaceAsk): Promise<string | null> => {
    const { layout, terminal } = context;
    // Beside a pane that is actually on stage: focus outlives a preset
    // change, and splitting beside a pane not in the tree fails silently —
    // an errand that never opens and a question nobody is asked.
    const host: string | null = errandHost_find();
    if (host === null) return null;
    const spawned: PaneInstance = hooks.instance_spawn('files');
    const place: ReplayPlace | null = hooks.replayPlace_get();
    if (!layout.leaf_split(host, place?.dir ?? 'col', spawned.id, place?.before ?? false)) {
      paneInstance_dispose(spawned.id);
      layout.mount_remove(spawned.id);
      return null;
    }
    hooks.birth_record(spawned.id, host, place?.dir ?? 'col', place?.before ?? false);
    const panel: FilesPanel | undefined = panels.get('files', spawned.id);
    const anchor: string = request.path?.anchor ?? '~';
    if (panel !== undefined) hooks.rootedListing_show(spawned.id, panel, anchor);

    const body: HTMLElement | null = spawned.mount.querySelector<HTMLElement>('.files-body');
    if (body === null) {
      paneInstance_dispose(spawned.id);
      layout.mount_remove(spawned.id);
      return null;
    }
    const bar: HTMLElement = document.createElement('div');
    bar.className = 'errand-bar';
    body.insertBefore(bar, body.firstChild);
    const caption: HTMLElement = document.createElement('span');
    caption.className = 'errand-caption';
    caption.textContent = request.message.trim();
    const field: HTMLInputElement = document.createElement('input');
    field.className = 'errand-path';
    field.spellcheck = false;
    const commit: HTMLButtonElement = document.createElement('button');
    commit.className = 'pacs-capsule errand-commit';
    commit.textContent = request.commit ?? 'USE THIS';
    // The path typed IS the answer, whole: the command that asked makes the
    // holding folder itself and says so, or refuses by name, as a terminal
    // does; a browser's own frame still carries MKDIR.
    bar.append(caption, field, commit);

    /** Composes the answer from where the browser stands. */
    const path_compose = (): void => {
      const here: string = panel?.path_current() ?? anchor;
      const suggest: string | undefined = request.path?.suggest;
      field.value = request.path?.wantsDirectory === true || suggest === undefined
        ? here
        : `${here.replace(/\/$/, '')}/${suggest}`;
    };
    path_compose();
    // Walking the browser re-composes, so the field always names where the
    // operator is standing — until they edit it, which is their last word.
    let edited: boolean = false;
    field.addEventListener('input', (): void => { edited = true; });
    const walked = (): void => { if (!edited) path_compose(); };
    spawned.mount.addEventListener('click', walked);

    terminal.question_set(true);
    return new Promise((resolve: (answer: string | null) => void): void => {
      const settle = (answer: string | null): void => {
        spawned.mount.removeEventListener('click', walked);
        terminal.question_set(false);
        errandClose = null;
        layout.leaf_close(spawned.id);
        paneInstance_dispose(spawned.id);
        layout.mount_remove(spawned.id);
        resolve(answer);
      };
      errandClose = (): void => settle(null);
      commit.addEventListener('click', (): void => settle(field.value.trim() === '' ? null : field.value.trim()));
      field.addEventListener('keydown', (event: KeyboardEvent): void => {
        if (event.key === 'Enter') settle(field.value.trim() === '' ? null : field.value.trim());
      });
    });
  };

  const errand_abandon = (): boolean => {
    if (errandClose === null) return false;
    errandClose();
    return true;
  };

  const verbLine_run = (id: string, line: string): void => {
    askingPane = id;
    context.terminal.line_run(line);
  };

  const askingPane_take = (): string | null => {
    const provoker: string | null = askingPane;
    askingPane = null;
    return provoker;
  };

  const ask_onPane = async (id: string, request: PaneAskRequest): Promise<string | null> => {
    const { terminal } = context;
    const mount: HTMLElement | undefined = paneInstance_get(id)?.mount;
    // A pane that is not on stage cannot carry a question; the console can,
    // and it exposes itself to do it.
    if (mount === undefined) {
      hooks.console_expose();
      return terminal.ask_open({
        message: request.message,
        kind: request.kind,
        ...(request.suggest === undefined ? {} : { suggest: request.suggest }),
      });
    }
    const noted: (answer: string | null) => void = terminal.ask_note(request.message);
    const answer: string | null = await paneAsk_open(mount, request);
    // A secret never enters the transcript, not even as a length.
    noted(request.kind === 'secret' && answer !== null ? '••••••' : answer);
    return answer;
  };

  return { errandHost_find, errand_open, errand_abandon, verbLine_run, askingPane_take, ask_onPane };
}
