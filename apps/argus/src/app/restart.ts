/**
 * @file The calypso daemon restarted from ARGUS, behind a door.
 *
 * A restart is the door's act, as LOG OUT is: ARGUS asks porter
 * (`POST …/restart`), porter ends this session's daemon and boots a fresh one
 * on the login it saved, and the browser follows the boot on the greeter and
 * comes back in — no password asked again. Two controls ask for it: the
 * standing RESTART pill beside LOG OUT, and the cure in the out-of-date
 * notice. Both raise the same question, in the notice's spot at the top of
 * the stage (a-question-is-answered-where-the-hand-is), naming what a
 * restart would cut off right now: a command holding the lane, an unsaved
 * edit, the other surfaces attached. YES / NO; Enter and Esc.
 *
 * When the daemon goes, it says why (`closing`). This ARGUS, having asked,
 * is already on its way to the greeter; another ARGUS on the same session
 * says the daemon was restarted from elsewhere and follows to the greeter
 * itself. A page with no door says so and offers nothing it cannot do.
 *
 * Law honest-wait: the question says the truth about this moment.
 *
 * @module
 */
import type { ClosingCause } from '@fnndsc/menu';
import { door_isPresent, doorUrl_build } from '../calypso/routes.js';

/** Another surface on the same daemon, as the heartbeat names it. */
export interface SurfaceSeen {
  id: string;
  kind: 'chell' | 'browser';
}

/** What a restart would cut off, at the moment it is asked. */
export interface RestartFacts {
  /** The line holding the lane, when one does. */
  running: string | null;
  /** The files with unsaved edits. */
  unsaved: string[];
  /** The other surfaces attached (this one left out). */
  others: SurfaceSeen[];
}

/** The question's words. */
export const RESTART_QUESTION: string = 'Restart the calypso daemon? You\'ll stay logged in; the page reloads when the new daemon is up.';

/**
 * What the question lists under its sentence: only what applies now.
 *
 * @param facts - What is live.
 * @returns One line per thing a restart cuts off; none when nothing is live.
 */
export function restartCuts_of(facts: RestartFacts): string[] {
  const cuts: string[] = [];
  if (facts.running !== null) cuts.push(`the running command: ${facts.running}`);
  for (const file of facts.unsaved) cuts.push(`an unsaved edit in ${file}`);
  const browsers: number = facts.others.filter((other: SurfaceSeen): boolean => other.kind === 'browser').length;
  const chells: number = facts.others.length - browsers;
  const named: string[] = [];
  if (browsers > 0) named.push(browsers === 1 ? '1 other browser' : `${browsers} other browsers`);
  if (chells > 0) named.push(chells === 1 ? '1 chell' : `${chells} chells`);
  if (named.length > 0) cuts.push(`${named.join(' and ')}, which will be disconnected`);
  return cuts;
}

/** What another ARGUS says when the daemon goes, by why. */
export function closingWords_of(cause: ClosingCause): string {
  if (cause === 'restart') return 'The calypso daemon is restarting (asked from another browser or surface). Following it…';
  if (cause === 'end') return 'The calypso daemon was ended by an administrator.';
  return 'The calypso daemon stopped.';
}

/** What the host hands the restart controls. */
export interface RestartHooks {
  /** The files with unsaved edits now. */
  unsaved: () => string[];
}

/** The restart controls a wired host has. */
export interface RestartControl {
  /** Raises the question (the RESTART pill and the notice's cure both call this). */
  ask: () => void;
  /** The attach ack: this surface's own id. */
  attach_take: (attach: { surface?: string }) => void;
  /** The heartbeat: who holds the lane, who else is here. */
  telemetry_take: (extra?: { lane?: { running: { line: string } | null }; surfaces?: SurfaceSeen[] }) => void;
  /** The daemon says it is going, and why. */
  closing_take: (cause: ClosingCause) => void;
}

/**
 * Builds the notice-shaped question, answered with YES / NO or Enter / Esc.
 *
 * @param cuts - What the restart cuts off.
 * @param answer - Told true for yes, false for no.
 * @returns The question's element (not yet placed).
 */
export function restartQuestion_build(cuts: readonly string[], answer: (yes: boolean) => void): HTMLDivElement {
  const notice: HTMLDivElement = document.createElement('div');
  notice.className = 'stale-page restart-question';
  notice.setAttribute('role', 'alertdialog');
  const words: HTMLDivElement = document.createElement('div');
  words.className = 'stale-page-words';
  const sentence: HTMLDivElement = document.createElement('div');
  sentence.textContent = RESTART_QUESTION;
  words.append(sentence);
  if (cuts.length > 0) {
    const list: HTMLUListElement = document.createElement('ul');
    list.className = 'restart-cuts';
    const lead: HTMLLIElement = document.createElement('li');
    lead.className = 'restart-cuts-lead';
    lead.textContent = 'This will cut off:';
    list.append(lead);
    for (const cut of cuts) {
      const item: HTMLLIElement = document.createElement('li');
      item.textContent = cut;
      list.append(item);
    }
    words.append(list);
  }
  const yes: HTMLButtonElement = document.createElement('button');
  yes.type = 'button';
  yes.className = 'restart-yes';
  yes.textContent = 'YES';
  const no: HTMLButtonElement = document.createElement('button');
  no.type = 'button';
  no.className = 'restart-no';
  no.textContent = 'NO';
  let settled: boolean = false;
  const settle = (value: boolean): void => {
    if (settled) return;
    settled = true;
    notice.remove();
    answer(value);
  };
  yes.addEventListener('click', (): void => settle(true));
  no.addEventListener('click', (): void => settle(false));
  // The question holds the keys while it stands: Enter answers yes, Esc no,
  // and neither reaches the stage's own handlers.
  notice.addEventListener('keydown', (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    settle(event.key === 'Enter');
  });
  const answers: HTMLDivElement = document.createElement('div');
  answers.className = 'restart-answers';
  answers.append(yes, no);
  notice.append(words, answers);
  return notice;
}

/**
 * Wires the restart controls: the RESTART pill (only behind a door), the
 * question, the request to the door, and what a closing daemon says.
 *
 * @param hooks - The unsaved edits.
 * @param host - Where the question and the notices stand.
 * @returns The controls.
 */
export function restart_wire(hooks: RestartHooks, host: HTMLElement = document.body): RestartControl {
  const throughDoor: boolean = door_isPresent(window.location.search);
  let self: string | null = null;
  let running: string | null = null;
  let surfaces: SurfaceSeen[] = [];
  let asked: boolean = false;

  const notice_say = (text: string): void => {
    host.querySelector('.restart-said')?.remove();
    const notice: HTMLDivElement = document.createElement('div');
    notice.className = 'stale-page restart-said';
    notice.setAttribute('role', 'alert');
    notice.textContent = text;
    host.appendChild(notice);
  };

  const greeter_follow = (key: string): void => {
    window.location.assign(`${doorUrl_build(window.location.pathname, 'greet')}/${encodeURIComponent(key)}`);
  };

  const restart_send = async (): Promise<void> => {
    asked = true;
    notice_say('Restarting the calypso daemon…');
    try {
      const response: Response = await fetch(doorUrl_build(window.location.pathname, 'restart'), { method: 'POST', headers: { accept: 'application/json' } });
      const body: { key?: string; error?: string } = await response.json() as { key?: string; error?: string };
      if (!response.ok || body.key === undefined) throw new Error(body.error ?? `the door answered ${response.status}`);
      greeter_follow(body.key);
    } catch (error: unknown) {
      asked = false;
      notice_say(`The calypso daemon could not be restarted: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const ask = (): void => {
    if (!throughDoor || host.querySelector('.restart-question') !== null) return;
    const facts: RestartFacts = {
      running,
      unsaved: hooks.unsaved(),
      others: surfaces.filter((surface: SurfaceSeen): boolean => surface.id !== self),
    };
    const question: HTMLDivElement = restartQuestion_build(restartCuts_of(facts), (yes: boolean): void => { if (yes) void restart_send(); });
    host.querySelector('.build-mismatch')?.remove();
    host.appendChild(question);
    question.querySelector<HTMLButtonElement>('.restart-yes')?.focus();
  };

  const pill: HTMLElement | null = document.getElementById('restart-pill');
  if (pill !== null && throughDoor) {
    pill.hidden = false;
    pill.addEventListener('click', ask);
  }

  return {
    ask,
    attach_take: (attach): void => { self = attach.surface ?? null; },
    telemetry_take: (extra): void => {
      if (extra?.lane !== undefined) running = extra.lane.running?.line ?? null;
      if (extra?.surfaces !== undefined) surfaces = extra.surfaces;
    },
    closing_take: (cause: ClosingCause): void => {
      // This ARGUS asked: it is already on its way to the greeter.
      if (asked) return;
      notice_say(closingWords_of(cause));
      if (cause !== 'restart' || !throughDoor) return;
      // Another surface asked: follow to the greeter, which waits for the fresh daemon.
      const key: string | undefined = window.location.pathname.split('/').filter((part: string): boolean => part.length > 0).at(-1);
      if (key !== undefined) setTimeout((): void => greeter_follow(key), 1200);
    },
  };
}
