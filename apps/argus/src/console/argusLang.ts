/**
 * @file The argus language: every surface gesture as a textual verb.
 *
 * Lines whose first word is a reserved subject run here, client-side, and
 * never touch the wire; everything else is a session command as before.
 * Verbs act on the FOCUSED pane by default; `@id` after the subject names a
 * pane explicitly, and `%n` names the n-th pane created during a desktop
 * replay (ordinals are schema-safe where session ids are not).
 *
 * Fidelity by construction: verbs drive the same DOM controls the mouse
 * does — the drawer's pills, the rail's capsules, the gutter's givens — so
 * a sentence and a gesture can never drift apart.
 *
 * A DESKTOP is a saved layout described in this language: a script of
 * verbs, no concrete addresses (the AEGIS schema law), replayed through
 * this same dispatcher. Stored locally always; written through to CFS
 * (`~/.config/argus/desktops/`) when the daemon carries `config write`.
 *
 * @module
 */

/** What the language needs from its host (assembled in main.ts). */
export interface ArgusHost {
  /** The focused pane id, or null. */
  focused_get(): string | null;
  /** Focuses a pane by id; false when unknown. */
  focus_set(id: string): boolean;
  /** Every pane id currently on stage. */
  panes_shown(): string[];
  /** A shown pane's bounding rect (for spatial focus), or null. */
  paneRect_get(id: string): DOMRect | null;
  /** A pane's mount element (drawer, rail, chooser live inside), or null. */
  paneMount_get(id: string): HTMLElement | null;
  /** A pane's kind ('files' | 'dag' | 'view' | 'empty' | 'pacs'), or null. */
  paneKind_get(id: string): string | null;
  /** Whether the pane's link group is inherited (a linked child). */
  paneLinked_get(id: string): boolean;
  /** Enters a feed on the primary DAG pane (pin + fetch). */
  feed_enter(id: number): void;
  /** Dives into the node the pane currently regards; false when none. */
  node_immerse(paneId: string): boolean;
  /** Runs a session command silently, returning rendered output. */
  session_run(line: string): Promise<string>;
  /** The serialized desktop of the current composition. */
  desktop_serialize(): string;
}

/** One parsed line: subject, optional explicit target, remaining words. */
interface Sentence {
  subject: string;
  target: string | null;
  words: string[];
}

/** Subjects this language owns; all other lines belong to the session. */
const SUBJECTS: ReadonlySet<string> = new Set([
  'pane', 'view', 'runs', 'node', 'dag', 'file', 'header', 'console', 'back', 'desktop', 'argus',
]);

/** Desktop replay ordinals: %n → the n-th pane created during this load. */
let replayPanes: string[] | null = null;

/** localStorage keys for desktops. */
const DESKTOP_PREFIX: string = 'argus.desktop.';
/** The CFS home for desktops, when the daemon can write it. */
const DESKTOP_CFS_DIR: string = '~/.config/argus/desktops';

/**
 * Parses a line into a sentence when its subject is reserved.
 *
 * @param line - The raw console line.
 * @returns The sentence, or null when the session owns the line.
 */
export function sentence_parse(line: string): Sentence | null {
  const words: string[] = line.trim().split(/\s+/);
  const subject: string = (words[0] ?? '').toLowerCase();
  if (!SUBJECTS.has(subject)) return null;
  let target: string | null = null;
  let rest: string[] = words.slice(1);
  if (rest[0]?.startsWith('@') || rest[0]?.startsWith('%')) {
    target = rest[0];
    rest = rest.slice(1);
  }
  return { subject, target, words: rest };
}

/**
 * Resolves a sentence's target to a pane id: explicit @id, replay %ordinal,
 * or the focused pane.
 */
function target_resolve(host: ArgusHost, target: string | null): string | null {
  if (target === null) return host.focused_get();
  if (target.startsWith('@')) return target.slice(1);
  const ordinal: number = parseInt(target.slice(1), 10);
  if (replayPanes === null) return null;
  return replayPanes[ordinal - 1] ?? null;
}

/** Clicks the first matching control inside a pane's mount. */
function control_click(host: ArgusHost, paneId: string, selector: string): boolean {
  const mount: HTMLElement | null = host.paneMount_get(paneId);
  const control: HTMLElement | null = mount?.querySelector<HTMLElement>(selector) ?? null;
  if (control === null) return false;
  control.click();
  return true;
}

/** Clicks a drawer child verb by its label. */
function drawerChild_click(host: ArgusHost, paneId: string, label: string): boolean {
  const mount: HTMLElement | null = host.paneMount_get(paneId);
  if (mount === null) return false;
  for (const button of mount.querySelectorAll<HTMLButtonElement>('.drawer-child')) {
    if (button.textContent?.trim().toUpperCase() === label) {
      button.click();
      return true;
    }
  }
  return false;
}

/** Cycles a rail toggle pill until its label matches the wanted mode. */
function railPill_setTo(host: ArgusHost, paneId: string, selector: string, wanted: string): boolean {
  const mount: HTMLElement | null = host.paneMount_get(paneId);
  const pill: HTMLElement | null = mount?.querySelector<HTMLElement>(selector) ?? null;
  if (pill === null) return false;
  for (let step: number = 0; step < 4; step++) {
    if (pill.textContent?.trim().toUpperCase() === wanted) return true;
    pill.click();
  }
  return pill.textContent?.trim().toUpperCase() === wanted;
}

/** Spatial focus: the nearest shown pane in a screen direction. */
function focus_move(host: ArgusHost, direction: string): string | null {
  const fromId: string | null = host.focused_get();
  const from: DOMRect | null = fromId !== null ? host.paneRect_get(fromId) : null;
  if (from === null) return null;
  const fx: number = from.x + from.width / 2;
  const fy: number = from.y + from.height / 2;
  let best: { id: string; score: number } | null = null;
  for (const id of host.panes_shown()) {
    if (id === fromId) continue;
    const rect: DOMRect | null = host.paneRect_get(id);
    if (rect === null) continue;
    const dx: number = rect.x + rect.width / 2 - fx;
    const dy: number = rect.y + rect.height / 2 - fy;
    const along: number =
      direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy;
    if (along <= 1) continue;
    const across: number = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    const score: number = along + across * 2;
    if (best === null || score < best.score) best = { id, score };
  }
  if (best === null) return null;
  host.focus_set(best.id);
  return best.id;
}

const SPLIT_PLACES: Readonly<Record<string, { split: string; place: string }>> = {
  left: { split: 'col', place: 'before' },
  right: { split: 'col', place: 'after' },
  above: { split: 'row', place: 'before' },
  below: { split: 'row', place: 'after' },
};

const VERBS_HELP: string = [
  'pane [@id|%n] split left|right|above|below · zoom · close · bind unlinked|fs|viewer',
  'pane [@id|%n] claim files|runs|pacs · focus left|right|up|down|@id',
  'view files|runs|pacs        (the gutter givens, workspace scope)',
  'runs enter <feedId>         (enter a feed on the DAG pane)',
  'node enter · immerse · back (the indicated node)',
  'dag [@id] layout ranked|molecule · projection 2d|3d · scale time|size · pulse',
  'file [@id] home|back|download|delete',
  'header stats|dag|away|restore',
  'console open|close|toggle|height <px>',
  'back                        (contextual back — exactly Esc)',
  'desktop save|load|show|list|delete [name]',
  'argus verbs                 (this table)',
].join('\n');

/**
 * Runs one argus-language line.
 *
 * @param host - The surface bindings.
 * @param line - The raw line (already known to start with a reserved subject).
 * @returns The result text to print; null when the session owns the line.
 */
export async function argusLine_run(host: ArgusHost, line: string): Promise<string | null> {
  const sentence: Sentence | null = sentence_parse(line);
  if (sentence === null) return null;
  const { subject, words } = sentence;
  const verb: string = (words[0] ?? '').toLowerCase();
  const arg: string = (words[1] ?? '').toLowerCase();

  if (subject === 'argus') return VERBS_HELP;

  if (subject === 'back') {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return 'back';
  }

  if (subject === 'view') {
    const gutter: Record<string, string> = { files: 'gutter-files', runs: 'gutter-runs', pacs: 'gutter-tools' };
    const buttonId: string | undefined = gutter[verb];
    if (buttonId === undefined) return `view: unknown given '${verb}' (files|runs|pacs)`;
    document.getElementById(buttonId)?.click();
    // During a desktop replay the preset's primary pane is ordinal %1.
    if (replayPanes !== null) {
      replayPanes.length = 0;
      replayPanes.push(verb === 'runs' ? 'dag' : verb === 'pacs' ? 'pacs' : 'files');
    }
    return `view ${verb}`;
  }

  if (subject === 'header') {
    if (verb === 'restore') { document.getElementById('header-restore')?.click(); return 'header restored'; }
    if (verb === 'stats') { document.querySelector<HTMLElement>('.panel-1')?.click(); return 'header stats'; }
    if (verb === 'dag') { document.querySelector<HTMLElement>('.panel-2')?.click(); return 'header dag'; }
    if (verb === 'away') {
      const face: string | undefined = document.body.dataset['header'];
      const button: string = face === 'stats' ? '.panel-1' : '.panel-2';
      if (face !== 'away') {
        if (face === undefined) document.querySelector<HTMLElement>('.panel-2')?.click();
        document.querySelector<HTMLElement>(button)?.click();
      }
      return 'header away';
    }
    return `header: unknown face '${verb}' (stats|dag|away|restore)`;
  }

  if (subject === 'console') {
    const drawer: HTMLElement | null = document.getElementById('drawer');
    if (drawer === null) return 'console: no drawer';
    const closed: boolean = drawer.classList.contains('drawer-closed');
    if (verb === 'toggle' || (verb === 'open' && closed) || (verb === 'close' && !closed)) {
      document.getElementById(closed || verb === 'open' ? 'drawer-toggle' : 'drawer-close')?.click();
      return `console ${verb}`;
    }
    if (verb === 'height') {
      const px: number = parseInt(arg, 10);
      if (Number.isNaN(px)) return 'console height <px>';
      drawer.style.height = `${px}px`;
      return `console height ${px}`;
    }
    if (verb === 'open' || verb === 'close') return `console already ${verb === 'open' ? 'open' : 'closed'}`;
    return `console: unknown verb '${verb}' (open|close|toggle|height)`;
  }

  if (subject === 'runs') {
    if (verb === 'enter') {
      const feedId: number = parseInt(arg.replace(/^feed_/, ''), 10);
      if (Number.isNaN(feedId)) return 'runs enter <feedId>';
      host.feed_enter(feedId);
      return `entering feed_${feedId}`;
    }
    return `runs: unknown verb '${verb}' (enter)`;
  }

  if (subject === 'desktop') {
    return desktop_handle(host, verb, words[1]);
  }

  // Everything below acts on a pane.
  const paneId: string | null = target_resolve(host, sentence.target);
  if (paneId === null) return `${subject}: no target pane (nothing focused?)`;

  if (subject === 'pane') {
    if (verb === 'split') {
      const shape: { split: string; place: string } | undefined = SPLIT_PLACES[arg];
      if (shape === undefined) return 'pane split left|right|above|below';
      const beforeIds: Set<string> = new Set(host.panes_shown());
      if (!control_click(host, paneId, `[data-split="${shape.split}"][data-place="${shape.place}"]`)) {
        return `pane split: '${paneId}' has no drawer`;
      }
      const created: string | undefined = host.panes_shown().find((id: string): boolean => !beforeIds.has(id));
      if (created !== undefined && replayPanes !== null) replayPanes.push(created);
      return `split ${arg}: ${created ?? '(no pane created)'}`;
    }
    if (verb === 'zoom') return control_click(host, paneId, '.drawer-zoom') ? `zoomed ${paneId}` : 'pane zoom: no drawer';
    if (verb === 'close') return control_click(host, paneId, '.drawer-close') ? `closed ${paneId}` : 'pane close: no drawer';
    if (verb === 'bind') {
      if (!['unlinked', 'fs', 'viewer'].includes(arg)) return 'pane bind unlinked|fs|viewer';
      return control_click(host, paneId, `.drawer-bind[data-bind="${arg}"]`)
        ? `bind ${arg}` : 'pane bind: no drawer';
    }
    if (verb === 'claim') {
      const pill: Record<string, string> = { files: '.empty-go-files', runs: '.empty-go-dag', pacs: '.empty-go-pacs' };
      const selector: string | undefined = pill[arg];
      if (selector === undefined) return 'pane claim files|runs|pacs';
      return control_click(host, paneId, selector)
        ? `claiming ${paneId} as ${arg}` : `pane claim: '${paneId}' is not an unlinked pane`;
    }
    if (verb === 'focus') {
      if (arg.startsWith('@')) {
        return host.focus_set(arg.slice(1)) ? `focused ${arg.slice(1)}` : `no pane '${arg.slice(1)}'`;
      }
      const moved: string | null = focus_move(host, arg);
      return moved !== null ? `focused ${moved}` : `pane focus: nothing ${arg} of here`;
    }
    return `pane: unknown verb '${verb}'`;
  }

  if (subject === 'dag') {
    if (verb === 'layout') return railPill_setTo(host, paneId, '.dag-strategy', arg.toUpperCase()) ? `layout ${arg}` : 'dag layout ranked|molecule';
    if (verb === 'projection') return railPill_setTo(host, paneId, '.dag-projection', arg.toUpperCase()) ? `projection ${arg}` : 'dag projection 2d|3d';
    if (verb === 'scale') return railPill_setTo(host, paneId, '.dag-scale', arg.toUpperCase()) ? `scale ${arg}` : 'dag scale time|size';
    if (verb === 'pulse') return control_click(host, paneId, '.dag-pulse') ? 'pulse' : 'dag pulse: no rail';
    return `dag: unknown verb '${verb}' (layout|projection|scale|pulse)`;
  }

  if (subject === 'file') {
    const label: string = verb.toUpperCase();
    if (!['HOME', 'BACK', 'DOWNLOAD', 'DELETE'].includes(label)) return 'file home|back|download|delete';
    return drawerChild_click(host, paneId, label) ? `file ${verb}` : `file ${verb}: not offered by '${paneId}'`;
  }

  if (subject === 'node') {
    if (verb === 'enter') return drawerChild_click(host, paneId, 'ENTER NODE') ? 'entering node' : 'node enter: no DAG drawer';
    if (verb === 'back') return drawerChild_click(host, paneId, 'BACK') ? 'node back' : 'node back: no DAG drawer';
    if (verb === 'immerse') return host.node_immerse(paneId) ? 'immersing' : 'node immerse: nothing indicated';
    return `node: unknown verb '${verb}' (enter|immerse|back)`;
  }

  return null;
}

/**
 * The desktop verbs: save/load/show/list/delete over the dual store.
 */
async function desktop_handle(host: ArgusHost, verb: string, name: string | undefined): Promise<string> {
  if (verb === 'list') {
    const names: string[] = [];
    for (let index: number = 0; index < window.localStorage.length; index++) {
      const key: string | null = window.localStorage.key(index);
      if (key?.startsWith(DESKTOP_PREFIX)) names.push(key.slice(DESKTOP_PREFIX.length));
    }
    return names.length > 0 ? names.sort().join('\n') : '(no desktops saved)';
  }
  if (verb === 'show') {
    if (name === undefined) return host.desktop_serialize();
    const stored: string | null = window.localStorage.getItem(DESKTOP_PREFIX + name);
    return stored ?? `(no desktop '${name}')`;
  }
  if (name === undefined) return `desktop ${verb} <name>`;
  if (verb === 'save') {
    const script: string = host.desktop_serialize();
    try {
      window.localStorage.setItem(DESKTOP_PREFIX + name, script);
    } catch {
      return 'desktop save: local storage refused the write';
    }
    // Write-through to the durable layer, honestly reported either way.
    const encoded: string = window.btoa(unescape(encodeURIComponent(script)));
    const output: string = await host.session_run(
      `config write ${DESKTOP_CFS_DIR}/${name}.desk ${encoded}`,
    );
    const durable: boolean = output.includes('wrote');
    return `saved '${name}' (local${durable ? ' + CFS' : '; CFS unavailable: ' + output.trim().split('\n')[0]})`;
  }
  if (verb === 'delete') {
    window.localStorage.removeItem(DESKTOP_PREFIX + name);
    return `deleted '${name}' (local; a CFS copy, if any, is yours to rm)`;
  }
  if (verb === 'load') {
    let script: string | null = window.localStorage.getItem(DESKTOP_PREFIX + name);
    if (script === null) {
      const remote: string = await host.session_run(`cat ${DESKTOP_CFS_DIR}/${name}.desk`);
      if (remote.trim().length > 0 && !remote.includes('No such') && !remote.toLowerCase().includes('error')) {
        script = remote;
      }
    }
    if (script === null) return `(no desktop '${name}')`;
    replayPanes = [];
    const results: string[] = [];
    try {
      for (const rawLine of script.split('\n')) {
        const scriptLine: string = rawLine.trim();
        if (scriptLine === '' || scriptLine.startsWith('#')) continue;
        const result: string | null = await argusLine_run(host, scriptLine);
        results.push(`${scriptLine}  →  ${result ?? '(session line?)'}`);
        // Let the layout settle between structural verbs.
        await new Promise((resolve): void => { window.setTimeout(resolve, 60); });
      }
    } finally {
      replayPanes = null;
    }
    return `loaded '${name}'\n${results.join('\n')}`;
  }
  return 'desktop save|load|show|list|delete [name]';
}
