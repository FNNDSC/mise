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
 * does — the drawer's pills, the mode frame's capsules, the gutter's givens — so
 * a sentence and a gesture can never drift apart.
 *
 * A DESKTOP is a saved layout described in this language: a script of
 * verbs, no concrete addresses (the AEGIS schema law), replayed through
 * this same dispatcher. Stored locally always; written through to CFS
 * (`~/.config/argus/desktops/`) when the daemon carries `config write`.
 *
 * @module
 */
import { side_is, side_ofFocusWord, splitSelector_of, type Side } from '../app/sides.js';

/** What the language needs from its host (assembled in main.ts). */
export interface ArgusHost {
  /** The focused pane id, or null. */
  focused_get(): string | null;
  /** Focuses a pane by id; false when unknown. */
  focus_set(id: string): boolean;
  /** Every pane id currently on stage. */
  panes_shown(): string[];
  /** Moves a pane to a side; answers with what happened, or the refusal by name. */
  pane_move(paneId: string, side: Side): string;
  /** Flips the axis of the split the pane stands in. */
  pane_flip(paneId: string): string;
  /** Moves the boundary beside the pane a step; answers what happened. */
  pane_resize(paneId: string, side: Side, step: number): string;
  /** Focuses the pane focused before this one; answers it, or null when none. */
  focus_last(): string | null;
  /** Opens the HELP pane (the keys and the verbs) on the stage; answers what happened. */
  help_open(): string;
  /** Opens the NOTES pane (what the installed releases changed); answers what happened. */
  notes_open(): string;
  /** A shown pane's bounding rect (for spatial focus), or null. */
  paneRect_get(id: string): DOMRect | null;
  /** A pane's mount element (drawer, mode frame, chooser live inside), or null. */
  paneMount_get(id: string): HTMLElement | null;
  /** A pane's kind ('files' | 'dag' | 'view' | 'empty' | 'pacs'), or null. */
  paneKind_get(id: string): string | null;
  /** Whether the pane's link group is inherited (a linked child). */
  paneLinked_get(id: string): boolean;
  /** Downloads the file a browser regards; false when it regards none. */
  file_download(paneId: string): boolean;
  /** Removes the file a browser regards, visibly; false when none. */
  file_delete(paneId: string): boolean;
  /** Runs a session command silently, returning rendered output. */
  session_run(line: string): Promise<string>;
  /** Opens a path as an image beside the pane (or the focused one); returns the console line. */
  image_open(paneId: string | null, path: string, options?: { force?: boolean }): Promise<string>;
  /** Toggles the console's full-screen zoom (the bar carries no control). */
  consoleZoom_toggle(): void;
  /** Opens the launcher, the place a session begins when nothing is open. */
  launcher_enter(): void;
  /** Who this session belongs to, as the prompt names them; null before the first prompt. */
  identity_get(): string | null;
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
const SUBJECTS: Set<string> = new Set([
  'pane', 'view', 'file', 'header', 'console', 'back', 'desktop', 'dashboard', 'help', 'notes', 'launcher', 'attach', 'argus',
]);

/** The frame's own subjects, which no composition answers for. */
const FRAME_SUBJECTS: ReadonlySet<string> = new Set(SUBJECTS);

/**
 * Subjects the SESSION also owns, and the verbs argus claims from them.
 *
 * `pacs` is a kernel command (`pacs connect|list|query|pull|status`) and the
 * surface must not shadow it: a line whose verb is not claimed here falls
 * through to the session, which answers for its own vocabulary. Every other
 * subject is the surface's alone.
 */
const SHARED_SUBJECTS: Record<string, ReadonlySet<string>> = {
  // `help` is the kernel's: bare `help` and `help <command>` are the session's
  // answer; the surface claims only its own three words.
  help: new Set(['pane', 'keys', 'verbs']),
  // `notes` is the kernel's (what the installed releases changed); the surface
  // claims only the pane that lists it.
  notes: new Set(['pane']),
  // `file` is the kernel's too (what a file is, by its bytes — games shelf);
  // the surface claims only its files-pane verbs.
  file: new Set(['home', 'back', 'download', 'delete', 'follow', 'root', 'list', 'cards', 'preview', 'sort', 'filter']),
};

/**
 * What a composition adds to the language: subjects of its own (and the verbs
 * it claims from subjects the session also owns), the words it adds to the
 * frame's verbs (a view, a claim, a listing to sort and filter), its drawer
 * chords and verb lines, and the handler for its subjects.
 */
export interface LanguageExtension {
  /** Its subjects; for one the session owns too, the verbs it claims (anything else reaches the session). */
  subjects: Readonly<Record<string, ReadonlySet<string> | null>>;
  /** `view <word>`: the gutter button it presses, and the primary pane that is %1 in a desktop replay. */
  views: Readonly<Record<string, { button: string; primary: string }>>;
  /** `pane claim <word>`: the empty pane's capsule it presses. */
  claims: Readonly<Record<string, string>>;
  /** `<subject> sort|filter`: the listing it drives, and what the refusal names. */
  listings: Readonly<Record<string, { selector: string; named: string }>>;
  /** Its drawer chords, placed after the chord whose key is `after`. */
  chords: ReadonlyArray<DrawerChord & { after: string }>;
  /** Its verb lines, placed after the frame's line for subject `after`. */
  lines: ReadonlyArray<{ after: string; line: string }>;
  /** Runs one of its sentences; undefined when it does not handle the subject. */
  run(host: ArgusHost, sentence: { subject: string; target: string | null; words: string[] }, pane: () => string | null): Promise<string | null> | string | null | undefined;
}

/** The composition's extension, once installed. */
let extension: LanguageExtension | null = null;

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
  const claimed: ReadonlySet<string> | undefined = SHARED_SUBJECTS[subject];
  if (claimed !== undefined && !claimed.has((words[1] ?? '').toLowerCase())) return null;
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
export function target_resolve(host: ArgusHost, target: string | null): string | null {
  if (target === null) return host.focused_get();
  if (target.startsWith('@')) return target.slice(1);
  const ordinal: number = parseInt(target.slice(1), 10);
  if (replayPanes === null) return null;
  return replayPanes[ordinal - 1] ?? null;
}

/**
 * The pane a kind-named subject acts on: the targeted pane when it is of the
 * kind, else the first shown pane of the kind, else null.
 *
 * @param host - The surface.
 * @param paneId - The targeted pane (the focused one when none was named).
 * @param kinds - The kinds the subject acts on.
 * @returns A pane id, or null when no such pane is on stage.
 */
function kindPane_resolve(host: ArgusHost, paneId: string | null, kinds: ReadonlyArray<string>): string | null {
  if (paneId !== null && kinds.includes(host.paneKind_get(paneId) ?? '')) return paneId;
  return host.panes_shown().find((id: string): boolean => kinds.includes(host.paneKind_get(id) ?? '')) ?? null;
}

/** Clicks the first matching control inside a pane's mount. */
export function control_click(host: ArgusHost, paneId: string, selector: string): boolean {
  const mount: HTMLElement | null = host.paneMount_get(paneId);
  const control: HTMLElement | null = mount?.querySelector<HTMLElement>(selector) ?? null;
  if (control === null) return false;
  control.click();
  return true;
}

/** Clicks a drawer child verb by its label. */
export function drawerChild_click(host: ArgusHost, paneId: string, label: string): boolean {
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

/** Clicks a browser's cwd-binding capsule (FOLLOW CWD / ROOT HERE). */
function cwdBind_click(host: ArgusHost, paneId: string, follow: boolean): boolean {
  return control_click(host, paneId, `.drawer-cwdbind[data-follow="${follow ? 'on' : 'off'}"]`);
}

/** Cycles a mode-frame pill until its label matches the wanted mode. */
export function modePill_setTo(host: ArgusHost, paneId: string, selector: string, wanted: string): boolean {
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
export function focus_move(host: ArgusHost, direction: string): string | null {
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


/**
 * One drawer verb, one key: with a drawer open (the prefix pressed), a chord
 * fires one of its capsules — tmux's letters where tmux has one, vim's for
 * a direction, a capital to MOVE. A chord is a key on a capsule, never a
 * verb of its own (aegis.adoc: a-drawer-verb-has-a-chord); each capsule's
 * title names its key, and `argus keys` lists them.
 */
export interface DrawerChord {
  /** The key, as KeyboardEvent.key. */
  key: string;
  /** The group the key belongs to: pane, focus, binding, claim, stage, console. */
  topic: string;
  /** The capsule it presses, as a selector under the open drawer; null when the host acts (focus, help). */
  selector: string | null;
  /** What it does, for the table. */
  does: string;
  /** Whether the chord arms MOVE first. */
  move?: boolean;
}

/** The drawer chords: the frame's, and those a composition installs. */
export const DRAWER_CHORDS: DrawerChord[] = [
  { key: '%', topic: 'pane', selector: splitSelector_of('right'), does: 'split right (tmux)' },
  { key: '"', topic: 'pane', selector: splitSelector_of('below'), does: 'split below (tmux)' },
  { key: 'h', topic: 'pane', selector: splitSelector_of('left'), does: 'split left' },
  { key: 'j', topic: 'pane', selector: splitSelector_of('below'), does: 'split below' },
  { key: 'k', topic: 'pane', selector: splitSelector_of('above'), does: 'split above' },
  { key: 'l', topic: 'pane', selector: splitSelector_of('right'), does: 'split right' },
  { key: 'H', topic: 'pane', selector: splitSelector_of('left'), does: 'move this pane left', move: true },
  { key: 'J', topic: 'pane', selector: splitSelector_of('below'), does: 'move this pane below', move: true },
  { key: 'K', topic: 'pane', selector: splitSelector_of('above'), does: 'move this pane above', move: true },
  { key: 'L', topic: 'pane', selector: splitSelector_of('right'), does: 'move this pane right', move: true },
  { key: 'm', topic: 'pane', selector: '.drawer-mode[data-mode="move"]', does: 'arm MOVE (then a direction)' },
  { key: 'z', topic: 'pane', selector: '.drawer-zoom', does: 'zoom (tmux), or double-click the pane\'s header' },
  { key: 'x', topic: 'pane', selector: '.drawer-close', does: 'close (tmux)' },
  { key: 'u', topic: 'binding', selector: '.drawer-bind[data-bind="unlinked"]', does: 'the next split is unlinked' },
  { key: 'f', topic: 'binding', selector: '.drawer-bind[data-bind="fs"]', does: 'the next split is a linked filesystem' },
  { key: 'v', topic: 'binding', selector: '.drawer-bind[data-bind="viewer"]', does: 'the next split is a linked viewer' },
  { key: '1', topic: 'claim', selector: '.empty-go-files', does: 'claim an empty pane as FILES' },
  { key: 'o', topic: 'focus', selector: null, does: 'focus the next pane (tmux)' },
  { key: ';', topic: 'focus', selector: null, does: 'focus the last pane (tmux)' },
  { key: 'q', topic: 'focus', selector: null, does: 'show every pane\'s @id on its bar (tmux)' },
  { key: 'Space', topic: 'pane', selector: null, does: 'flip this pane\'s split: beside becomes above (tmux next layout)' },
  { key: '!', topic: 'pane', selector: null, does: 'break this pane out: alone on stage, the rest a PANES card (tmux)' },
  { key: 'Ctrl-←↑↓→', topic: 'pane', selector: null, does: 'move the boundary beside this pane a step (tmux)' },
  { key: 'w', topic: 'stage', selector: null, does: 'PANES, the desktops (tmux window chooser)' },
  { key: 'r', topic: 'focus', selector: null, does: 'the keys into this pane\'s frame: Tab or ↑↓ walk its verbs, Enter presses, ← or Esc leaves' },
  { key: '&', topic: 'pane', selector: null, does: 'close every pane on the stage (tmux kill-window)' },
  { key: '[', topic: 'console', selector: null, does: 'the console\'s scrollback takes the keys (tmux)' },
  { key: 'O', topic: 'focus', selector: null, does: 'focus the previous pane' },
  { key: '←↑↓→', topic: 'focus', selector: null, does: 'focus the pane in that direction (tmux)' },
  { key: ':', topic: 'console', selector: null, does: 'the command line (tmux)' },
  { key: '?', topic: 'console', selector: null, does: 'this table' },
];

/**
 * `pane close all`: tmux's kill-window — every pane on the stage closes,
 * the last one home.
 *
 * @param host - The surface.
 * @returns What closed.
 */
function paneCloseAll_run(host: ArgusHost): string {
  let closed: number = 0;
  for (const id of host.panes_shown()) if (control_click(host, id, '.drawer-close')) closed += 1;
  return `closed ${closed} pane${closed === 1 ? '' : 's'}`;
}

/**
 * The chord table, as the console prints it.
 *
 * @returns The table.
 */
function keysHelp_text(): string {
  return [
  'prefix chords — Ctrl-B opens the focused pane\'s drawer; one key then presses one capsule',
  ...DRAWER_CHORDS.map((chord: DrawerChord): string => `  ${chord.key.padEnd(6)} ${chord.does}`),
  '  Tab    walks the verbs; Enter fires; Esc closes the drawer',
  'in a pane holding a listing, no prefix needed:',
  '  ↑↓     move the row cursor (Home/End: first/last)',
  '  Enter  indicates the row (its verbs ride the frame); Enter again goes (opens, enters, folds open)',
  '  →      the keys into the frame, as Ctrl-B r',
  ].join('\n');
}

/** The verb table, one line per subject; `argus verbs` prints it, the HELP pane lists it. */
export const VERB_LINES: string[] = [];

/** The frame's verb lines, by subject, in order; claim and view name what is installed. */
const FRAME_LINES: ReadonlyArray<{ subject: string; line: () => string }> = [
  { subject: 'pane', line: (): string => 'pane [@id|%n] split left|right|above|below · zoom · close · close all · bind unlinked|fs|viewer' },
  { subject: 'pane claim', line: (): string => `pane [@id|%n] claim ${['files', ...Object.keys(extension?.claims ?? {})].join('|')} · focus left|right|up|down|@id|last · flip · resize left|right|up|down [percent]` },
  { subject: 'view', line: (): string => `${`view ${['files', ...Object.keys(extension?.views ?? {})].join('|')}`.padEnd(28)}(the gutter givens, workspace scope)` },
  { subject: 'file', line: (): string => 'file [@id] home|back|download|delete · follow · root · list|cards|preview · sort <col> [asc|desc] · filter <text>|off' },
  { subject: 'header', line: (): string => 'header stats|dag|away|restore' },
];

/** The frame's verb lines after the subjects a composition can add beside. */
const FRAME_TAIL_LINES: ReadonlyArray<string> = [
  'console open|close|toggle|zoom|height <px>',
  'back                        (contextual back — exactly Esc)',
  'desktop save|load|show|list|delete [name]',
  'attach [--reveal]           (how to reach THIS session from a terminal or another browser)',
  'argus verbs                 (this table; the long form is docs/argus-lang.adoc)',
  'argus keys                  (the prefix chords: one key, one drawer verb)',
  'help pane|keys|verbs        (the KEYS pane on the stage; keys and verbs print the tables here; bare help is the session\'s)',
  'notes pane                  (what the installed releases changed, as a pane; bare notes prints it here)',
];

/**
 * Lays the verb lines out: the frame's, a composition's each after the line it names.
 */
function verbLines_build(): void {
  const lines: string[] = [];
  for (const frame of FRAME_LINES) {
    lines.push(frame.line());
    for (const added of extension?.lines ?? []) if (added.after === frame.subject) lines.push(added.line);
  }
  lines.push(...FRAME_TAIL_LINES);
  VERB_LINES.splice(0, VERB_LINES.length, ...lines);
}

/**
 * Installs a composition's words into the language: its subjects, its
 * chords (each after the chord it names) and its verb lines.
 *
 * @param added - The composition's extension.
 */
export function language_extend(added: LanguageExtension): void {
  extension = added;
  for (const [subject, claimed] of Object.entries(added.subjects)) {
    SUBJECTS.add(subject);
    if (claimed !== null) SHARED_SUBJECTS[subject] = claimed;
  }
  for (const chord of added.chords) {
    const at: number = DRAWER_CHORDS.findIndex((one: DrawerChord): boolean => one.key === chord.after);
    const { after: _after, ...placed } = chord;
    DRAWER_CHORDS.splice(at === -1 ? DRAWER_CHORDS.length : at + 1 + added.chords.filter((other) => other.after === chord.after && added.chords.indexOf(other) < added.chords.indexOf(chord)).length, 0, placed);
  }
  verbLines_build();
}

verbLines_build();

/**
 * How to reach this session from somewhere else, as lines that can be run.
 *
 * The token is a bearer credential with no expiry and no revocation, so it
 * is masked until it is asked for: this surface is screenshotted, pasted
 * and projected, and a secret that only appears on purpose is one that
 * cannot leave by accident. `--reveal` prints it whole, the same bargain
 * the PACS form makes with what it stands in for.
 *
 * Loopback is stated rather than implied. A daemon bound to 127.0.0.1 is
 * unreachable from another machine whatever line is printed, and a screen
 * that offers an address nobody else can use is worse than one that says so.
 *
 * @param host - The surface bindings.
 * @param reveal - Whether to print the token rather than mask it.
 * @returns The block to print.
 */
function attachLines_compose(host: ArgusHost, reveal: boolean): string {
  const here: URL = new URL(window.location.href);
  const token: string = here.searchParams.get('token') ?? '';
  const shown: string = token === '' ? '' : reveal ? token : '\u2022'.repeat(8);
  const url: string = token === '' ? here.origin + here.pathname : `${here.origin}${here.pathname}?token=${shown}`;
  const identity: string | null = host.identity_get();
  const loopback: boolean = /^(127\.|\[?::1\]?$|localhost$)/.test(here.hostname);
  const lines: string[] = ['attach \u2014 this session, from anywhere that can reach it'];
  if (identity !== null && identity !== '') lines.push(`  identity          ${identity}`);
  lines.push('');
  lines.push('  this machine      chell --remote');
  lines.push(`  another machine   chell --remote --attach "${url}"`);
  lines.push(`  another browser   ${url}`);
  lines.push('');
  if (loopback) {
    lines.push('  bound to loopback \u2014 another machine cannot reach this session;');
    lines.push('  relaunch the daemon with CALYPSO_BIND=0.0.0.0 to change that');
  }
  if (token === '') {
    lines.push('  this page carries no token: it was opened without one, and a');
    lines.push('  second surface cannot attach with what is on screen');
  } else if (!reveal) {
    lines.push('  the token is masked \u2014 `attach --reveal` prints it. It is a bearer');
    lines.push('  credential with no expiry: treat the line like a password');
  } else {
    lines.push('  revealed \u2014 anyone who reads this line holds the session');
  }
  return lines.join('\n');
}

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

  if (subject === 'argus') return verb === 'keys' ? keysHelp_text() : VERB_LINES.join('\n');

  if (subject === 'back') {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return 'back';
  }

  if (subject === 'attach') {
    // The surface holds what a second surface needs: this page reached the
    // daemon by a URL that carries the attach token, so nothing is asked of
    // the session to answer this — and nothing could be, since the daemon
    // deliberately has no route that hands a token out.
    return attachLines_compose(host, verb === '--reveal' || arg === '--reveal');
  }

  if (subject === 'dashboard' || subject === 'launcher') {
    // DASHBOARD-04 on the gutter is the pointer's way in; this is the
    // keyboard's. `launcher` still answers, since that is what the thing
    // was called before it had a block of its own.
    host.launcher_enter();
    return 'dashboard';
  }

  if (subject === 'view') {
    const views: Record<string, { button: string; primary: string }> = { files: { button: 'gutter-files', primary: 'files' }, ...(extension?.views ?? {}) };
    const view: { button: string; primary: string } | undefined = views[verb];
    if (view === undefined) return `view: unknown given '${verb}' (${Object.keys(views).join('|')})`;
    document.getElementById(view.button)?.click();
    // During a desktop replay the preset's primary pane is ordinal %1.
    if (replayPanes !== null) {
      replayPanes.length = 0;
      replayPanes.push(view.primary);
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
      // The lid is the one mechanism (the bar law): it toggles both ways.
      document.getElementById('drawer-toggle')?.click();
      return `console ${verb}`;
    }
    if (verb === 'zoom') {
      host.consoleZoom_toggle();
      return 'console zoom';
    }
    if (verb === 'height') {
      const px: number = parseInt(arg, 10);
      if (Number.isNaN(px)) return 'console height <px>';
      drawer.style.height = `${px}px`;
      return `console height ${px}`;
    }
    if (verb === 'open' || verb === 'close') return `console already ${verb === 'open' ? 'open' : 'closed'}`;
    return `console: unknown verb '${verb}' (open|close|toggle|zoom|height)`;
  }

  const listings: Record<string, { selector: string; named: string }> = { file: { selector: '.pane-files', named: 'files' }, ...(extension?.listings ?? {}) };
  if (listings[subject] !== undefined) {
    if (verb === 'sort' || verb === 'filter') {
      const kind: string = (listings[subject] as { selector: string }).selector;
      const targeted: string | null = target_resolve(host, sentence.target);
      const mount: HTMLElement | null = targeted === null ? null : host.paneMount_get(targeted);
      // The subject names the kind: fall back to any such pane on stage.
      const pane: HTMLElement | null =
        mount?.querySelector<HTMLElement>(kind) ?? document.querySelector<HTMLElement>(kind);
      if (pane === null) {
        const named: string = (listings[subject] as { named: string }).named;
        return `${subject} ${verb}: no ${named} pane`;
      }
      if (verb === 'sort') {
        if (arg === '') return `${subject} sort <column> [asc|desc]`;
        const dir: 'asc' | 'desc' = (words[2] ?? 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
        pane.dispatchEvent(new CustomEvent('argus:roster', { detail: { op: 'sort', key: arg, dir } }));
        return `${subject} sorted by ${arg} ${dir}`;
      }
      const text: string = arg === 'off' ? '' : words.slice(1).join(' ');
      pane.dispatchEvent(new CustomEvent('argus:roster', { detail: { op: 'filter', text } }));
      return text === '' ? `${subject} filter off` : `${subject} filtered: ${text}`;
    }
  }

  // A composition's subject: its handler, given the pane once it is asked for.
  if (extension !== null && !FRAME_SUBJECTS.has(subject)) {
    const handled: Promise<string | null> | string | null | undefined = extension.run(host, sentence, (): string | null => target_resolve(host, sentence.target));
    if (handled !== undefined) return handled;
  }

  if (subject === 'help' || subject === 'notes') return pages_handle(host, subject, verb);
  if (subject === 'desktop') {
    return desktop_handle(host, verb, words[1]);
  }

  // Everything below acts on a pane.
  const paneId: string | null = target_resolve(host, sentence.target);
  if (paneId === null) return `${subject}: no target pane (nothing focused?)`;



  if (subject === 'pane') {
    if (verb === 'split') {
      if (!side_is(arg)) return 'pane split left|right|above|below';
      const beforeIds: Set<string> = new Set(host.panes_shown());
      if (!control_click(host, paneId, splitSelector_of(arg))) {
        return `pane split: '${paneId}' has no drawer`;
      }
      const created: string | undefined = host.panes_shown().find((id: string): boolean => !beforeIds.has(id));
      if (created !== undefined && replayPanes !== null) replayPanes.push(created);
      return `split ${arg}: ${created ?? '(no pane created)'}`;
    }
    if (verb === 'move') {
      // The drawer's MOVE: the pane walks to that side (aegis.adoc: a-pane-can-be-moved).
      if (!side_is(arg)) return 'pane move left|right|above|below';
      return host.pane_move(paneId, arg);
    }
    if (verb === 'zoom') return control_click(host, paneId, '.drawer-zoom') ? `zoomed ${paneId}` : 'pane zoom: no drawer';
    if (verb === 'close' && arg === 'all') return paneCloseAll_run(host);
    if (verb === 'close') return control_click(host, paneId, '.drawer-close') ? `closed ${paneId}` : 'pane close: no drawer';
    if (verb === 'bind') {
      if (!['unlinked', 'fs', 'viewer'].includes(arg)) return 'pane bind unlinked|fs|viewer';
      return control_click(host, paneId, `.drawer-bind[data-bind="${arg}"]`)
        ? `bind ${arg}` : 'pane bind: no drawer';
    }
    if (verb === 'claim') {
      const pill: Record<string, string> = { files: '.empty-go-files', ...(extension?.claims ?? {}) };
      const selector: string | undefined = pill[arg];
      if (selector === undefined) return `pane claim ${Object.keys(pill).join('|')}`;
      return control_click(host, paneId, selector)
        ? `claiming ${paneId} as ${arg}` : `pane claim: '${paneId}' is not an unlinked pane`;
    }
    if (verb === 'flip') return host.pane_flip(paneId);
    if (verb === 'resize') {
      const side: Side | null = side_ofFocusWord(arg);
      if (side === null) return 'pane resize left|right|up|down [percent]';
      const percent: number = words[2] !== undefined ? Number(words[2]) : 5;
      if (!Number.isFinite(percent) || percent <= 0 || percent > 70) return 'pane resize: the step is a percent, 1 to 70';
      return host.pane_resize(paneId, side, percent / 100);
    }
    if (verb === 'focus') {
      if (arg === 'last') return host.focus_last() ?? 'pane focus last: no pane was focused before this one';
      if (arg.startsWith('@')) {
        return host.focus_set(arg.slice(1)) ? `focused ${arg.slice(1)}` : `no pane '${arg.slice(1)}'`;
      }
      const moved: string | null = focus_move(host, arg);
      return moved !== null ? `focused ${moved}` : `pane focus: nothing ${arg} of here`;
    }
    return `pane: unknown verb '${verb}'`;
  }

  if (subject === 'file') {
    // The subject names the kind: a focused image or graph beside the browser is not where `file` acts.
    const filesId: string | null = kindPane_resolve(host, paneId, ['files', 'catalogue']);
    if (filesId === null) return `file ${verb}: no files pane on stage`;
    if (verb === 'list' || verb === 'cards' || verb === 'preview') {
      return modePill_setTo(host, filesId, '.files-view', verb.toUpperCase()) ? `file ${verb}` : `file ${verb}: no files mode frame`;
    }
    // Each verb is reached where it now lives: binding on the drawer's
    // binding group, field navigation on the frame, and the row verbs
    // through the host, which is what the row's own track presses too.
    if (verb === 'follow' || verb === 'root') {
      return cwdBind_click(host, filesId, verb === 'follow')
        ? `file ${verb}`
        : `file ${verb}: not offered by '${filesId}'`;
    }
    if (verb === 'home' || verb === 'back') {
      return control_click(host, filesId, verb === 'home' ? '.files-home' : '.files-back')
        ? `file ${verb}`
        : `file ${verb}: not offered by '${filesId}'`;
    }
    if (verb === 'download') {
      return host.file_download(filesId) ? 'file download' : 'file download: nothing indicated';
    }
    if (verb === 'delete') {
      return host.file_delete(filesId) ? 'file delete' : 'file delete: nothing indicated';
    }
    return 'file home|back|download|delete|sort|filter|follow|root|list|cards|preview';
  }

  return null;
}

/**
 * The two reference pages: `help` (typed, the tables answer here; `pane`
 * opens the KEYS pane) and `notes` (`pane` opens the NOTES pane; bare
 * `notes`, like bare `help`, is the kernel's).
 *
 * @param host - The surface.
 * @param subject - `help` or `notes`.
 * @param verb - The word after it.
 * @returns What happened, or the verbs the subject takes.
 */
function pages_handle(host: ArgusHost, subject: string, verb: string | undefined): string {
  if (subject === 'notes') return verb === 'pane' ? host.notes_open() : 'notes pane';
  if (verb === 'keys') return keysHelp_text();
  if (verb === 'verbs') return VERB_LINES.join('\n');
  if (verb === 'pane') return host.help_open();
  return 'help pane|keys|verbs';
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
