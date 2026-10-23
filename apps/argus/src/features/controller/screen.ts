/**
 * @file The TD controller: the screen `domain` takes over in a stratus
 * session, drawn from what the session says of its domains and answering it
 * only with lines (docs/stratus.adoc, D13 and D14).
 *
 * Trek's layout under ARGUS's theme: the upper gutter carries the backend's
 * block and a pill per domain with NEW; the header the domain's condition,
 * where it is, what it costs, where its build stands and what changed since
 * the last command; the lower gutter the views, OVERVIEW, SIZE, BUILD,
 * CLUSTER, CHRIS and TEARDOWN, and LEAVE. A view changes the body; a control
 * sends a session line, which the log shows as typed, and a prompt at the
 * foot takes any line. The engine's questions stand on a strip over the
 * log, answered by a pill or a typed word, never skipped. Orange means money
 * runs; red means destroying.
 *
 * Pure of the wire: the host hands in the session's answers and events and
 * runs the lines the screen sends.
 *
 * @module
 */
import type { DomainSizeModel, DomainSpecModel, DomainSummary, PromptKind } from '@fnndsc/menu';
import {
  askForm_of, CHRIS_STEPS, classBadge_of, conditionWhy_of, CONTROLLER_VIEWS, duration_text, HOURS_PER_MONTH, LINES, money_text, nameRefusal_of,
  newLine_of, planWords_of, since_of, sizeCost_of, spec_copy, sizeFit_of, stepLooks_of, stepsDone_of, summary_merge, verifyWords_of, zoneShort_of,
  type ControllerView, type SinceRow, type StepLook, type ZoneFitLook,
} from './model.js';

/** What the controller needs from its host. */
export interface ControllerHooks {
  /** Runs an operator's line (it may ask); its output arrives through `output_take`; resolves when it ends. */
  run: (line: string) => Promise<void>;
  /** Reads `domain size` quietly; null when it did not answer the model. */
  size_read: (family?: string) => Promise<DomainSizeModel | null>;
  /** Stops following the running line (the build goes on as its task). */
  stop: () => void;
  /** Gives the screen back. */
  leave: () => void;
  /** How the screen is heard. */
  voice: { pill: (label: string) => void; cue: (name: string) => void };
}

/** A question the engine put, standing on the strip. */
interface OpenAsk {
  message: string;
  kind: PromptKind;
  answer: (value: string | null) => void;
}

/** How many log lines are kept. */
const LOG_LIMIT: number = 400;

/** The NEW pill's key among the domains. */
const NEW_KEY: string = '';

/** The view names as the gutter says them. */
const VIEW_LABELS: Readonly<Record<ControllerView, string>> = { overview: 'OVERVIEW', size: 'SIZE', build: 'BUILD', cluster: 'CLUSTER', chris: 'CHRIS', teardown: 'TEARDOWN' };

/**
 * Makes an element with a class and optional text.
 *
 * @param tag - The tag.
 * @param className - Its classes.
 * @param text - Its text.
 * @returns The element.
 */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node: HTMLElementTagNameMap[K] = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Strips a terminal's colour codes from text the log shows.
 *
 * @param text - The text.
 * @returns It, plain.
 */
function plain_of(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
}

/** The TD controller over a stratus session. */
export class TdController {
  /** The screen's root, appended to the body by the host while the controller is up. */
  public readonly root: HTMLElement;
  private readonly domains: Map<string, DomainSummary> = new Map();
  private current: string = NEW_KEY;
  private view: ControllerView = 'overview';
  /** The domain as it stood when the last command was sent, for SINCE LAST COMMAND. */
  private before: DomainSummary | null = null;
  private since: SinceRow[] = [{ label: '', text: 'FIRST READ' }];
  private size: DomainSizeModel | null = null;
  private sizeAsked: boolean = false;
  private levers: DomainSpecModel | null = null;
  private newName: string = '';
  private busy: string | null = null;
  private ask: OpenAsk | null = null;
  private partial: string = '';
  /** The lines of the build or plan running, for BUILD's log. */
  private stepLog: string[] = [];
  private stepLogLine: string | null = null;
  private readonly parts: {
    pills: HTMLElement; header: HTMLElement; views: Map<ControllerView, HTMLButtonElement>; body: HTMLElement;
    strip: HTMLElement; log: HTMLElement; input: HTMLInputElement; promptLabel: HTMLElement;
  };
  private ticker: ReturnType<typeof setInterval> | null = null;

  /**
   * Builds the controller.
   *
   * @param hooks - The host's verbs.
   */
  constructor(private readonly hooks: ControllerHooks) {
    this.root = el('div', 'td-controller');
    this.root.id = 'td-controller';
    this.root.setAttribute('role', 'application');
    this.root.setAttribute('aria-label', 'TD controller');

    const top: HTMLElement = el('div', 'tdc-gutter-top');
    const block: HTMLElement = el('div', 'tdc-block');
    const mark: HTMLElement = el('span', 'tdc-mark');
    mark.setAttribute('aria-hidden', 'true');
    const words: HTMLElement = el('div', 'tdc-block-words');
    words.append(el('span', 'tdc-block-name', 'STRATUS'), el('span', 'tdc-block-sub', 'TD CONTROLLER · OCI'));
    block.append(mark, words);
    const pills: HTMLElement = el('div', 'tdc-domains');
    pills.setAttribute('aria-label', 'Domains');
    top.append(block, pills, el('div', 'tdc-gutter-fill'));

    const header: HTMLElement = el('header', 'tdc-header');
    const barTop: HTMLElement = el('div', 'tdc-bar tdc-bar-top');
    barTop.append(el('span', 'tdc-bar-a'), el('span', 'tdc-bar-b'), el('span', 'tdc-bar-c'), el('span', 'tdc-bar-d'));
    const barBody: HTMLElement = el('div', 'tdc-bar tdc-bar-body');
    barBody.append(el('span', 'tdc-bar-a'), el('span', 'tdc-bar-b'), el('span', 'tdc-bar-c'));

    const lower: HTMLElement = el('nav', 'tdc-gutter-body');
    lower.setAttribute('aria-label', 'Views');
    const views: Map<ControllerView, HTMLButtonElement> = new Map();
    lower.append(el('div', 'tdc-gutter-cap'));
    for (const view of CONTROLLER_VIEWS) {
      const button: HTMLButtonElement = el('button', `tdc-view tdc-view-${view}`, VIEW_LABELS[view]);
      button.type = 'button';
      button.addEventListener('click', (): void => { this.hooks.voice.pill(VIEW_LABELS[view]); this.view_show(view); });
      views.set(view, button);
      lower.append(button);
    }
    const leave: HTMLButtonElement = el('button', 'tdc-leave', 'LEAVE');
    leave.type = 'button';
    leave.addEventListener('click', (): void => { this.hooks.voice.pill('LEAVE'); this.hooks.leave(); });
    lower.append(el('div', 'tdc-gutter-fill'), leave);

    const body: HTMLElement = el('main', 'tdc-body');
    const strip: HTMLElement = el('section', 'tdc-strip');
    strip.setAttribute('aria-label', 'The engine asks');
    strip.hidden = true;

    const foot: HTMLElement = el('section', 'tdc-foot');
    foot.setAttribute('aria-label', 'Domain log');
    const footHead: HTMLElement = el('div', 'tdc-foot-head');
    footHead.append(el('span', 'tdc-foot-title', 'DOMAIN LOG'), el('span', 'tdc-foot-sub', 'THE SESSION\'S LINES · TYPE BELOW'));
    const log: HTMLElement = el('div', 'tdc-log');
    log.setAttribute('aria-live', 'polite');
    const line: HTMLElement = el('div', 'tdc-prompt');
    const promptLabel: HTMLElement = el('label', 'tdc-prompt-label', 'stratus ›');
    const input: HTMLInputElement = el('input', 'tdc-prompt-input');
    input.id = 'tdc-prompt-input';
    promptLabel.setAttribute('for', input.id);
    input.placeholder = 'any session line · domain plan · ls domains/ · spend';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.addEventListener('keydown', (event: KeyboardEvent): void => {
      if (event.key !== 'Enter') return;
      const typed: string = input.value.trim();
      if (typed === '') return;
      input.value = '';
      void this.line_send(typed);
    });
    line.append(promptLabel, input);
    const logColumn: HTMLElement = el('div', 'tdc-log-column');
    logColumn.append(log, line);
    foot.append(footHead, logColumn);

    this.root.append(top, header, barTop, barBody, lower, body, strip, foot);
    this.parts = { pills, header, views, body, strip, log, input, promptLabel };
    // The header's clock: time in the running step, and the cost so far, move between reads.
    this.ticker = setInterval((): void => { if (this.domain_get()?.running) this.header_draw(); }, 15_000);
    this.draw();
  }

  /** Stops the controller's clock; the host calls it on leaving. */
  public dispose(): void {
    if (this.ticker !== null) clearInterval(this.ticker);
    this.ticker = null;
    this.ask?.answer(null);
    this.ask = null;
  }

  /**
   * The domains as `domain status` read them: every domain replaced, the
   * chosen one kept (or the first when it is gone).
   *
   * @param domains - The domains.
   */
  public domains_take(domains: ReadonlyArray<DomainSummary>): void {
    const was: DomainSummary | null = this.domain_get();
    this.domains.clear();
    for (const domain of domains) this.domains.set(domain.name, domain);
    if (this.current !== NEW_KEY && !this.domains.has(this.current)) this.current = domains[0]?.name ?? NEW_KEY;
    this.cues_play(was, this.domain_get());
    this.draw();
  }

  /**
   * A domain a build showed: merged over what was read.
   *
   * @param shown - The event's summary.
   */
  public domain_take(shown: DomainSummary): void {
    const was: DomainSummary | undefined = this.domains.get(shown.name);
    this.domains.set(shown.name, summary_merge(was, shown));
    if (shown.name === this.current) this.cues_play(was ?? null, this.domain_get());
    this.draw();
  }

  /**
   * Opens on a domain: its name, or the first (NEW when there are none).
   *
   * @param name - The domain, or `''` for the first.
   */
  public domain_choose(name: string): void {
    this.current = name !== '' && this.domains.has(name) ? name : this.domains.keys().next().value ?? NEW_KEY;
    if (this.current === NEW_KEY) this.view = 'size';
    this.draw();
  }

  /** The domain on the screen, or null on NEW. */
  public domain_get(): DomainSummary | null {
    return this.domains.get(this.current) ?? null;
  }

  /** The view on the screen. */
  public view_get(): ControllerView {
    return this.view;
  }

  /** The names of the domains drawn. */
  public names_get(): string[] {
    return [...this.domains.keys()];
  }

  /**
   * Output from the running line: the log, and BUILD's log while a build or plan runs.
   *
   * @param chunk - The text.
   */
  public output_take(chunk: string): void {
    const text: string = this.partial + plain_of(chunk);
    const lines: string[] = text.split('\n');
    this.partial = lines.pop() ?? '';
    for (const one of lines) this.log_add(one, 'out');
  }

  /**
   * The engine asks: the strip stands until it is answered.
   *
   * @param message - The question.
   * @param kind - What answers it.
   * @returns The answer, or null when abandoned.
   */
  public ask_take(message: string, kind: PromptKind): Promise<string | null> {
    this.ask?.answer(null);
    this.hooks.voice.cue('hail');
    return new Promise((resolve: (value: string | null) => void): void => {
      this.ask = { message, kind, answer: (value: string | null): void => { this.ask = null; this.strip_draw(); resolve(value); } };
      this.log_add(message, 'ask');
      this.strip_draw();
    });
  }

  /** Whether a question stands on the strip. */
  public asking_is(): boolean {
    return this.ask !== null;
  }

  /**
   * Sends a line: shown in the log as typed, run by the host, and the
   * domain remembered as it stood, for SINCE LAST COMMAND.
   *
   * @param line - The line.
   */
  public async line_send(line: string): Promise<void> {
    if (this.busy !== null) {
      this.log_add(`the lane is held by: ${this.busy} (STOP FOLLOWING frees it; the build goes on)`, 'note');
      return;
    }
    this.before = this.domain_get();
    this.busy = line;
    this.log_add(`stratus> ${line}`, 'sent');
    if (/^domain (build|plan) /.test(line)) { this.stepLog = []; this.stepLogLine = line; }
    this.draw();
    try {
      await this.hooks.run(line);
    } finally {
      if (this.partial !== '') { this.log_add(this.partial, 'out'); this.partial = ''; }
      this.busy = null;
      const now: DomainSummary | null = this.domain_get();
      if (now !== null) this.since = since_of(this.before, now);
      this.draw();
    }
  }

  /**
   * After a line's read: SINCE LAST COMMAND against the domain as it stood when the line was sent.
   */
  public since_refresh(): void {
    const now: DomainSummary | null = this.domain_get();
    if (now !== null) this.since = since_of(this.before?.name === now.name ? this.before : null, now);
    this.header_draw();
  }

  /** The tab title while the controller is up: the condition and the domain (`ASKING · quay`). */
  public title_get(): string {
    const domain: DomainSummary | null = this.domain_get();
    return domain === null ? 'SIZING · NEW DOMAIN' : `${domain.condition ?? 'READING'} · ${domain.name}`;
  }

  /**
   * Shows a view.
   *
   * @param view - The view.
   */
  public view_show(view: ControllerView): void {
    this.view = view;
    if (view === 'size') void this.size_need();
    this.draw();
  }

  // ---------------------------------------------------------------- drawing

  private draw(): void {
    this.pills_draw();
    this.header_draw();
    for (const [view, button] of this.parts.views) {
      button.classList.toggle('tdc-view-on', view === this.view);
      button.setAttribute('aria-current', view === this.view ? 'page' : 'false');
    }
    this.body_draw();
    this.strip_draw();
    this.parts.promptLabel.textContent = this.current === NEW_KEY ? 'stratus ›' : `stratus ~/${this.current} ›`;
    this.parts.input.disabled = this.busy !== null;
    this.root.dataset['busy'] = this.busy === null ? 'no' : 'yes';
    document.title = this.title_get();
  }

  private pills_draw(): void {
    const pills: HTMLElement = this.parts.pills;
    pills.replaceChildren();
    for (const name of [...this.domains.keys(), NEW_KEY]) {
      const domain: DomainSummary | undefined = this.domains.get(name);
      const pill: HTMLButtonElement = el('button', 'tdc-domain', name === NEW_KEY ? '+ NEW' : name.toUpperCase());
      pill.type = 'button';
      pill.dataset['condition'] = domain?.condition ?? 'SIZING';
      if (domain?.billing === true) pill.classList.add('tdc-billing');
      pill.setAttribute('aria-current', name === this.current ? 'true' : 'false');
      pill.addEventListener('click', (): void => {
        this.hooks.voice.pill(pill.textContent ?? '');
        if (name === NEW_KEY) { this.current = NEW_KEY; this.view_show('size'); return; }
        // A domain's pill sends its line, as typing it would.
        this.current = name;
        if (this.view === 'size' && this.levers !== null) this.levers = null;
        void this.line_send(LINES.status(name));
      });
      pills.append(pill);
    }
  }

  private header_draw(): void {
    const header: HTMLElement = this.parts.header;
    header.replaceChildren();
    const domain: DomainSummary | null = this.domain_get();
    header.append(this.condition_make(domain));
    if (domain === null) {
      header.append(
        this.headSection_make('DOMAIN', [['NAME', this.newName === '' ? '[NAME IT ON SIZE]' : this.newName], ['REGION', this.size?.region ?? '…'], ['ADDRESS', this.size === null ? '…' : this.size.baseDomain === null ? 'NO ZONE SET · --base-domain' : `${this.newName || '<name>'}.${this.size.baseDomain}`]]),
        this.headSection_make('COST · AS SIZED', this.sizedCost_rows()),
        this.headSection_make('FIT', this.fit_rows()),
        this.headSection_make('SINCE LAST CHANGE', [['', 'NOTHING WRITTEN YET']]),
      );
      return;
    }
    const tenancy: string = domain.path.match(/^\/net\/[^/]+\/([^/]+)\//)?.[1] ?? '?';
    header.append(
      this.headSection_make('DOMAIN', [['TENANCY', tenancy], ['REGION', domain.region ?? '?'], ['ADDRESS', domain.cluster ?? '?']]),
      this.headSection_make('COST', this.cost_rows(domain), domain.billing === true ? 0 : -1),
      this.headSection_make('BUILD', this.build_rows(domain)),
      this.since_make(),
    );
  }

  private condition_make(domain: DomainSummary | null): HTMLElement {
    const section: HTMLElement = el('section', 'tdc-head-condition');
    section.setAttribute('aria-label', 'Condition');
    const pill: HTMLElement = el('div', 'tdc-condition');
    const condition: string = domain?.condition ?? 'SIZING';
    pill.dataset['condition'] = condition;
    pill.append(el('span', 'tdc-condition-label', 'CONDITION'), el('span', 'tdc-condition-name', condition));
    const why = domain === null ? { text: 'NOTHING BUILT · NOTHING BILLED', billing: false } : conditionWhy_of(domain);
    const whyLine: HTMLElement = el('div', `tdc-condition-why${why.billing ? ' tdc-bill' : ''}`, why.text);
    const chips: HTMLElement = el('div', 'tdc-chips');
    if (domain !== null) {
      const steps = stepsDone_of(domain);
      chips.append(el('span', 'tdc-chip', `${steps.done} OF ${steps.total} DONE`), el('span', 'tdc-chip tdc-chip-class', classBadge_of(domain)));
      chips.append(this.lock_make(domain));
    } else {
      chips.append(el('span', 'tdc-chip', 'NO SPEC YET'));
    }
    section.append(pill, whyLine, chips);
    return section;
  }

  private lock_make(domain: DomainSummary): HTMLElement {
    const on: boolean = domain.protected !== false;
    const chip: HTMLElement = el('span', `tdc-chip tdc-lock${on ? ' tdc-lock-on' : ' tdc-lock-off'}`);
    chip.append(this.lockIcon_make(on), document.createTextNode(on ? 'PROTECTED' : 'UNLOCKED'));
    chip.title = on ? `teardown refused until: domain protect ${domain.name} off` : 'teardown may run; it still asks for the name typed back';
    return chip;
  }

  private lockIcon_make(on: boolean): SVGElement {
    const ns: 'http://www.w3.org/2000/svg' = 'http://www.w3.org/2000/svg';
    const icon: SVGElement = document.createElementNS(ns, 'svg');
    icon.setAttribute('viewBox', '0 0 16 16');
    icon.setAttribute('width', '12');
    icon.setAttribute('height', '12');
    icon.setAttribute('aria-hidden', 'true');
    const shackle: SVGElement = document.createElementNS(ns, 'path');
    shackle.setAttribute('d', on ? 'M4.5 7V5a3.5 3.5 0 0 1 7 0v2' : 'M4.5 7V5a3.5 3.5 0 0 1 6.8-1.2');
    shackle.setAttribute('fill', 'none');
    shackle.setAttribute('stroke', 'currentColor');
    shackle.setAttribute('stroke-width', '1.8');
    const body: SVGElement = document.createElementNS(ns, 'rect');
    for (const [key, value] of [['x', '3'], ['y', '7'], ['width', '10'], ['height', '7'], ['rx', '1.5'], ['fill', 'currentColor']]) body.setAttribute(key as string, value as string);
    icon.append(shackle, body);
    return icon;
  }

  private headSection_make(title: string, rows: ReadonlyArray<[string, string]>, billingRow: number = -1): HTMLElement {
    const section: HTMLElement = el('section', 'tdc-head-section');
    section.setAttribute('aria-label', title);
    section.append(el('span', 'tdc-head-title', title));
    const grid: HTMLElement = el('div', 'tdc-head-grid');
    rows.forEach(([label, value]: [string, string], index: number): void => {
      grid.append(el('span', `tdc-head-label${index === billingRow ? ' tdc-head-label-bill' : ''}`, label), el('span', 'tdc-head-value', value));
    });
    section.append(grid);
    return section;
  }

  private since_make(): HTMLElement {
    const section: HTMLElement = el('section', 'tdc-head-section');
    section.setAttribute('aria-label', 'Since the last command');
    section.append(el('span', 'tdc-head-title', 'SINCE LAST COMMAND'));
    const grid: HTMLElement = el('div', 'tdc-since');
    for (const row of this.since) grid.append(el('span', 'tdc-since-label', row.label), el('span', 'tdc-since-value', row.text));
    section.append(grid);
    return section;
  }

  private cost_rows(domain: DomainSummary): Array<[string, string]> {
    if (domain.cost === null || domain.cost === undefined) return [['PER HOUR', domain.billing === true ? 'NOT PRICED' : '0'], ['SO FAR', '—'], ['A MONTH', '—']];
    const { hourly, soFar, currency } = domain.cost;
    return [['PER HOUR', `${money_text(hourly, currency)} · EST`], ['SO FAR', money_text(soFar, currency)], ['A MONTH', `${money_text(hourly * HOURS_PER_MONTH, currency, 0)} · AT THIS RATE`]];
  }

  private build_rows(domain: DomainSummary): Array<[string, string]> {
    const last: string = domain.lastDone === null ? 'nothing' : domain.lastDone.replace(/^\d+-/, '');
    const running: string = domain.running === null || domain.running === undefined ? 'nothing'
      : `${domain.running.step ?? 'between steps'}${domain.running.since !== null ? ` · ${duration_text(Date.now() - Date.parse(domain.running.since))}` : ''}`;
    const plan: string = domain.plan === null || domain.plan === undefined ? 'none kept' : planWords_of(domain.plan);
    return [['LAST DONE', last], ['RUNNING', running], ['LAST PLAN', plan]];
  }

  private sizedCost_rows(): Array<[string, string]> {
    if (this.size === null || this.levers === null) return [['PER HOUR', '…'], ['A MONTH', '…'], ['SO FAR', '0']];
    const cost = sizeCost_of(this.size, this.levers);
    return [['PER HOUR', cost.hourly === null ? 'NOT PRICED' : `${money_text(cost.hourly, cost.currency)} · EST`], ['A MONTH', cost.hourly === null ? '—' : `${money_text(cost.hourly * HOURS_PER_MONTH, cost.currency, 0)} · EST`], ['SO FAR', '0']];
  }

  private fit_rows(): Array<[string, string]> {
    if (this.size === null || this.levers === null) return [['ZONES', '…']];
    const fits: ZoneFitLook[] = sizeFit_of(this.size, this.levers, this.newName || 'new');
    const fitting: number = fits.filter((fit: ZoneFitLook): boolean => fit.fits === true).length;
    const tight: ZoneFitLook | undefined = fits.find((fit: ZoneFitLook): boolean => fit.tightest);
    return [['ZONES', `${fitting} OF ${fits.length} FIT`], ['TIGHTEST', tight === undefined ? '—' : zoneShort_of(tight.zone)], ['FAMILY', this.levers.family]];
  }

  private body_draw(): void {
    const body: HTMLElement = this.parts.body;
    body.replaceChildren();
    body.dataset['view'] = this.view;
    const domain: DomainSummary | null = this.domain_get();
    if (this.view === 'size') { body.append(...this.size_make(domain)); return; }
    if (domain === null) {
      body.append(this.empty_make('NO DOMAIN CHOSEN', 'Press + NEW and size one on SIZE, or a domain\'s pill above.'));
      return;
    }
    const views: Record<Exclude<ControllerView, 'size'>, () => HTMLElement[]> = {
      overview: (): HTMLElement[] => this.overview_make(domain),
      build: (): HTMLElement[] => this.build_make(domain),
      cluster: (): HTMLElement[] => this.cluster_make(domain),
      chris: (): HTMLElement[] => this.chris_make(domain),
      teardown: (): HTMLElement[] => this.teardown_make(domain),
    };
    body.append(...views[this.view as Exclude<ControllerView, 'size'>]());
    // A log drawn anew opens at its end, where the step is.
    const steplog: HTMLElement | null = body.querySelector('.tdc-steplog');
    if (steplog !== null) steplog.scrollTop = steplog.scrollHeight;
  }

  private empty_make(title: string, text: string): HTMLElement {
    const box: HTMLElement = el('section', 'tdc-empty');
    box.append(el('span', 'tdc-section-title', title), el('p', 'tdc-prose', text));
    return box;
  }

  private section_make(title: string, className: string = '', aside?: string): HTMLElement {
    const section: HTMLElement = el('section', `tdc-section ${className}`.trim());
    section.setAttribute('aria-label', title);
    const head: HTMLElement = el('div', 'tdc-section-head');
    head.append(el('span', 'tdc-section-title', title));
    if (aside !== undefined) head.append(el('span', 'tdc-section-aside', aside));
    section.append(head);
    return section;
  }

  private pairs_make(rows: ReadonlyArray<[string, string]>, className: string = ''): HTMLElement {
    const grid: HTMLElement = el('div', `tdc-pairs ${className}`.trim());
    for (const [label, value] of rows) grid.append(el('span', 'tdc-pair-label', label), el('span', 'tdc-pair-value', value));
    return grid;
  }

  /**
   * A pill that sends a line; refused (drawn, never pressed) with why when the verb is refused.
   *
   * @param label - Its word.
   * @param line - The line it sends.
   * @param tone - How it is drawn.
   * @param refused - Why it is refused, if it is.
   * @returns The pill, and the line it sends beneath.
   */
  private linePill_make(label: string, line: string, tone: 'plain' | 'bill' | 'destroy' | 'quiet' = 'plain', refused?: string): HTMLButtonElement {
    const pill: HTMLButtonElement = el('button', `tdc-pill tdc-pill-${tone}`, refused === undefined ? label : `${label} · REFUSED`);
    pill.type = 'button';
    pill.title = refused === undefined ? `sends: ${line}` : `refused: ${refused}`;
    pill.disabled = refused !== undefined || this.busy !== null;
    pill.addEventListener('click', (): void => { this.hooks.voice.pill(label); void this.line_send(line); });
    return pill;
  }

  private spec_make(spec: DomainSpecModel | null | undefined): HTMLElement[] {
    if (spec === null || spec === undefined) return [el('p', 'tdc-prose', 'No spec kept: a domain read from a checkout says its spec in its own files (cat spec.yaml).')];
    const pool = (one: DomainSpecModel['controlPlane']): string => `${one.count} × ${one.vcpu} vCPU · ${one.ramGib} GiB · ${one.bootGib} GiB ${one.bootTier.toUpperCase()}`;
    return [
      this.pairs_make([['FAMILY', spec.family], ['CONTROL PLANE', pool(spec.controlPlane)], ['WORKERS', spec.workers.count === 0 ? '0 · COMPACT, PLANE SCHEDULABLE' : pool(spec.workers)]]),
    ];
  }

  private chrisSpec_make(spec: DomainSpecModel | null | undefined): HTMLElement {
    if (spec === null || spec === undefined) return el('p', 'tdc-prose', '—');
    return this.pairs_make([['DATA', `${spec.chris.dataGib} GiB · GROWS, NEVER SHRINKS`], ['DATABASE · QUEUE', `${spec.chris.databaseGib} GiB · ${spec.chris.queueGib} GiB · FIXED`]]);
  }

  private classNote_make(domain: DomainSummary): HTMLElement {
    const note: HTMLElement = el('div', `tdc-note tdc-note-${domain.origin ?? 'built'}`);
    const badge: string = classBadge_of(domain);
    note.append(el('span', 'tdc-note-title', badge));
    if (domain.origin === 'adopted') {
      note.append(el('span', 'tdc-prose', 'Built by harbor-oci. Its installer ids and its Terraform state are kept by stratus; it is planned against, never built on.'));
      note.append(el('span', 'tdc-prose tdc-quiet', `build refused: ${domain.refused?.['build'] ?? 'adopted'}`));
    } else if (domain.origin === 'checkout') {
      note.append(el('span', 'tdc-prose', 'Read from a harbor-oci checkout. Adopting it keeps it here: domain adopt <name> --from <checkout>.'));
    } else if (domain.gone !== null && domain.gone !== undefined) {
      note.append(el('span', 'tdc-prose', `Torn down ${domain.gone.slice(0, 16).replace('T', ' ')}. Its spec and its record are kept.`));
    } else {
      note.append(el('span', 'tdc-prose', domain.protected !== false ? 'Built by this daemon, and protected: teardown is refused until the lock is lifted, as a line of its own.' : 'Built by this daemon. The lock is off: teardown may run, and still asks for the name typed back.'));
    }
    return note;
  }

  private overview_make(domain: DomainSummary): HTMLElement[] {
    const spec: HTMLElement = this.section_make('SPEC · THE CLUSTER', 'tdc-col-spec');
    spec.append(...this.spec_make(domain.spec), el('span', 'tdc-section-title tdc-gap', 'SPEC · CHRIS ON IT'), this.chrisSpec_make(domain.spec), this.classNote_make(domain));

    const steps: HTMLElement = this.section_make('STEPS · THE MACHINE, THEN CHRIS', 'tdc-col-steps', 'PRESS A STEP · BUILD OPENS ON IT');
    const grid: HTMLElement = el('div', 'tdc-step-grid');
    for (const look of stepLooks_of(domain)) {
      const cell: HTMLButtonElement = el('button', `tdc-step tdc-step-${look.tone}${look.billFrom ? ' tdc-step-billfrom' : ''}`);
      cell.type = 'button';
      cell.setAttribute('aria-label', `${look.name}, ${look.word}`);
      cell.title = look.note;
      cell.append(el('span', 'tdc-step-n', look.n), el('span', 'tdc-step-name', look.name), el('span', 'tdc-step-note', look.note), el('span', 'tdc-step-word', look.word));
      cell.addEventListener('click', (): void => { this.hooks.voice.pill(look.name); this.view_show('build'); });
      grid.append(cell);
    }
    steps.append(grid, el('div', 'tdc-billing-line', `BILLING STARTS AT ${(domain.billingStep ?? 'infra-apply').toUpperCase()} · EVERY STEP AFTER IT RUNS ON PAID MACHINES`));
    const commands: HTMLElement = el('div', 'tdc-commands');
    commands.append(el('span', 'tdc-commands-label', 'DOMAIN'),
      this.linePill_make('PLAN', LINES.plan(domain.name)),
      this.linePill_make('VERIFY', LINES.verify(domain.name)),
      this.linePill_make('SPEND', LINES.spend(domain.name)),
      el('span', 'tdc-flex'),
      this.linePill_make('BUILD', LINES.build(domain.name), 'bill', domain.refused?.['build']));
    steps.append(commands);

    const cluster: HTMLElement = this.section_make('THE CLUSTER AT A GLANCE', 'tdc-col-glance');
    const verify: string = domain.verify === null || domain.verify === undefined ? this.verifyUnkept_of(domain) : `${verifyWords_of(domain.verify.checks)} · ${(domain.verify.at ?? '').slice(0, 16).replace('T', ' ')}`;
    cluster.append(this.pairs_make([['ADDRESS', domain.cluster ?? '?'], ['VERIFY', verify], ['RUNNING', domain.running === null || domain.running === undefined ? 'nothing' : domain.running.step ?? 'between steps']]));
    cluster.append(el('span', 'tdc-section-title tdc-gap', 'IN ITS COMPARTMENT'));
    cluster.append(this.resources_make(domain));
    cluster.append(el('p', 'tdc-prose tdc-quiet', 'Nodes per zone and projects come with the cluster in the tree (cluster/).'));
    return [spec, steps, cluster];
  }

  /**
   * What verify says when no checks are kept: the step's own line, or that it has not run.
   *
   * @param domain - The domain.
   * @returns The words.
   */
  private verifyUnkept_of(domain: DomainSummary): string {
    const step = domain.steps.find((one): boolean => one.name === 'verify');
    return step !== undefined && step.state !== 'not done' ? `${(step.evidence ?? step.state).toUpperCase()} · CHECKS NOT KEPT` : 'NOT RUN';
  }

  private resources_make(domain: DomainSummary): HTMLElement {
    if (domain.resources === null) return el('p', 'tdc-prose tdc-quiet', 'not counted');
    const rows: Array<[string, string]> = Object.entries(domain.resources).filter(([, count]): boolean => count > 0).map(([kind, count]): [string, string] => [kind.toUpperCase(), String(count)]);
    return rows.length === 0 ? el('p', 'tdc-prose', 'nothing live') : this.pairs_make(rows, 'tdc-pairs-narrow');
  }

  private strip_make(domain: DomainSummary): HTMLElement {
    const strip: HTMLElement = this.section_make('STEPS', 'tdc-col-strip');
    for (const look of stepLooks_of(domain)) {
      if (look.billFrom) strip.append(el('div', 'tdc-billing-from', 'BILLING FROM HERE'));
      const row: HTMLElement = el('div', `tdc-strip-step tdc-step-${look.tone}`);
      row.setAttribute('aria-label', `${look.name}, ${look.word}`);
      row.title = look.note;
      row.append(el('span', 'tdc-strip-name', look.name), el('span', 'tdc-strip-word', look.word));
      strip.append(row);
    }
    return strip;
  }

  private build_make(domain: DomainSummary): HTMLElement[] {
    const middle: HTMLElement = el('div', 'tdc-col-middle');
    const running = domain.running;
    if (running !== null && running !== undefined) {
      const now: HTMLElement = this.section_make(`RUNNING · ${(running.step ?? 'between steps').toUpperCase()}`, 'tdc-running', `/proc/steps/${running.job}`);
      now.append(this.pairs_make([['SINCE', running.since === null ? '?' : `${running.since.slice(11, 16)} · ${duration_text(Date.now() - Date.parse(running.since))}`], ['THE TASK', 'goes on with every surface closed, and after a daemon restart']]));
      const controls: HTMLElement = el('div', 'tdc-commands');
      const following: boolean = this.busy !== null && this.busy.startsWith(`domain build ${domain.name}`);
      const kill: HTMLButtonElement = el('button', 'tdc-pill tdc-pill-destroy', 'KILL');
      kill.type = 'button';
      kill.title = `stops following, then sends: ${LINES.kill(running.job)}`;
      kill.addEventListener('click', (): void => { this.hooks.voice.pill('KILL'); void this.kill_send(running.job); });
      const follow: HTMLButtonElement = following ? el('button', 'tdc-pill tdc-pill-quiet', 'STOP FOLLOWING') : this.linePill_make('FOLLOW', LINES.follow(domain.name), 'quiet');
      if (following) {
        follow.type = 'button';
        follow.title = 'Ctrl-C: stops following; the build goes on';
        follow.addEventListener('click', (): void => { this.hooks.voice.pill('STOP FOLLOWING'); this.hooks.stop(); });
      }
      controls.append(kill, el('span', 'tdc-commands-label', 'ASKS THE STEP TO STOP · NEVER FORCES'), el('span', 'tdc-flex'), follow);
      now.append(controls);
      middle.append(now);
    }
    const plan: HTMLElement = this.section_make('THE PLAN', 'tdc-plan', domain.plan?.at ? `MADE ${domain.plan.at.slice(0, 16).replace('T', ' ')}` : undefined);
    if (domain.plan === null || domain.plan === undefined) {
      plan.append(el('p', 'tdc-prose', domain.origin === 'adopted' ? 'No plan kept here. PLAN, under the tasks tier, plans against the adopted state; an apply is refused.' : 'No plan yet. BUILD makes it at infra-plan, and nothing it makes bills.'));
    } else {
      const counts: HTMLElement = el('div', 'tdc-plan-counts');
      const count = (label: string, value: number, tone: string, note?: string): HTMLElement => {
        const box: HTMLElement = el('div', `tdc-plan-count tdc-plan-${tone}`);
        box.append(el('span', 'tdc-plan-count-label', label), el('span', 'tdc-plan-count-value', String(value)));
        if (note !== undefined) box.append(el('span', 'tdc-plan-count-note', note));
        return box;
      };
      counts.append(count('TO CREATE', domain.plan.create, 'create'), count('TO CHANGE', domain.plan.change + domain.plan.replace + domain.plan.drift, 'change', domain.plan.drift > 0 ? `${domain.plan.drift} ORACLE-TAGS DRIFT · ${domain.plan.change + domain.plan.replace} REAL` : undefined), count('TO DESTROY', domain.plan.destroy, 'destroy'));
      const rows: HTMLElement = el('div', 'tdc-plan-rows');
      const marks: Readonly<Record<string, string>> = { create: '+', change: '~', drift: '~', replace: '±', destroy: '−' };
      for (const group of domain.plan.groups.slice(0, 14)) {
        rows.append(el('span', `tdc-plan-mark tdc-plan-${group.action}`, marks[group.action] ?? '?'), el('span', 'tdc-plan-kind', `${group.kind}${group.action === 'drift' ? ' · tag drift' : group.action === 'replace' ? ' · replaced' : ''}`), el('span', 'tdc-plan-n', String(group.count)), el('span', 'tdc-plan-names', group.names.slice(0, 4).join(' · ') + (group.names.length > 4 ? ` … ${group.names.length - 4} more` : '')));
      }
      plan.append(counts, rows);
    }
    const commands: HTMLElement = el('div', 'tdc-commands');
    commands.append(this.linePill_make('PLAN', LINES.plan(domain.name)), el('span', 'tdc-flex'), this.linePill_make('BUILD · THROUGH RUN', LINES.build(domain.name), 'bill', domain.refused?.['build']));
    plan.append(commands);
    middle.append(plan);

    const logBox: HTMLElement = this.section_make('THE STEP\'S LOG', 'tdc-col-steplog', this.stepLogLine ?? (running ? `/proc/steps/${running.job}/log` : undefined));
    const lines: HTMLElement = el('div', 'tdc-steplog');
    const shown: string[] = this.stepLog.slice(-60);
    if (shown.length === 0) lines.append(el('span', 'tdc-quiet', running ? `following shows it here (FOLLOW, or: cat /proc/steps/${running.job}/log)` : 'nothing run from here yet'));
    for (const one of shown) lines.append(el('span', 'tdc-steplog-line', one));
    logBox.append(lines);
    return [this.strip_make(domain), middle, logBox];
  }

  private cluster_make(domain: DomainSummary): HTMLElement[] {
    const checks: HTMLElement = this.section_make('VERIFY · TEN CHECKS', 'tdc-col-wide', domain.verify?.at ? `LAST RUN ${domain.verify.at.slice(0, 16).replace('T', ' ')}` : 'NOT RUN HERE');
    if (domain.verify === null || domain.verify === undefined) {
      checks.append(el('p', 'tdc-prose', `${this.verifyUnkept_of(domain)}. VERIFY runs the checks through the cluster's kubeconfig, which stays on the host, and keeps them.`));
    } else {
      const grid: HTMLElement = el('div', 'tdc-checks');
      for (const check of domain.verify.checks) {
        const tone: string = check.ok === true ? 'pass' : check.ok === false ? 'fail' : 'skip';
        grid.append(el('span', `tdc-check-mark tdc-check-${tone}`, check.ok === true ? '✓' : check.ok === false ? '✗' : '–'), el('span', 'tdc-check-name', check.name), el('span', 'tdc-check-detail', check.detail), el('span', `tdc-check-how${check.how === 'writes' ? ' tdc-bill' : ''}`, check.how.toUpperCase()));
      }
      checks.append(grid);
    }
    const note: HTMLElement = el('div', 'tdc-note tdc-note-bill');
    note.append(el('span', 'tdc-note-title', 'ONE CHECK WRITES'), el('span', 'tdc-prose', 'The block-volume probe makes a claim and a pod, writes, reads back and removes both: it runs only under the tasks tier; without it verify says so and runs the other nine.'));
    const commands: HTMLElement = el('div', 'tdc-commands');
    commands.append(this.linePill_make('VERIFY', LINES.verify(domain.name)));
    checks.append(note, commands);
    const side: HTMLElement = this.section_make('IN ITS COMPARTMENT', 'tdc-col-side');
    side.append(this.resources_make(domain), el('span', 'tdc-section-title tdc-gap', 'ACCESS'), this.pairs_make([['KUBECONFIG', 'ON THE HOST · NEVER SHOWN HERE'], ['KUBEADMIN', 'ON THE HOST · NEVER SHOWN HERE']]), el('p', 'tdc-prose tdc-quiet', 'Nodes per zone and the cluster\'s projects come with the cluster in the tree (cluster/).'));
    return [checks, side];
  }

  private chris_make(domain: DomainSummary): HTMLElement[] {
    const storage: HTMLElement = this.section_make('STORAGE · THE SPEC\'S CHRIS HALF', 'tdc-col-spec');
    storage.append(this.chrisSpec_make(domain.spec), el('p', 'tdc-prose tdc-bill', 'DATA grows with a new spec and a plan; it never shrinks. DATABASE and QUEUE are fixed from the first deploy.'));
    const steps: HTMLElement = this.section_make('THE APPLICATION\'S STEPS', 'tdc-col-steps');
    const looks: StepLook[] = stepLooks_of(domain).filter((look: StepLook): boolean => CHRIS_STEPS.includes(look.name));
    for (const look of looks) {
      const row: HTMLElement = el('div', `tdc-chris-step tdc-step-${look.tone}`);
      const head: HTMLElement = el('div', 'tdc-chris-step-head');
      head.append(el('span', 'tdc-chris-step-name', look.name.toUpperCase()), el('span', 'tdc-chris-step-word', look.word));
      row.append(head, el('span', 'tdc-prose', look.note === '' ? '—' : look.note));
      steps.append(row);
    }
    const unwritten: boolean = domain.steps.some((step): boolean => step.name === 'smoke' && (step.evidence ?? '').includes('not a step this session has yet'));
    const commands: HTMLElement = el('div', 'tdc-commands');
    const smoke: HTMLButtonElement = el('button', 'tdc-pill tdc-pill-plain', unwritten ? 'SMOKE AGAIN · NOT A STEP YET' : 'SMOKE AGAIN');
    smoke.type = 'button';
    smoke.disabled = true;
    smoke.title = 'smoke is a step of the cluster in the tree; not written yet';
    commands.append(smoke);
    steps.append(commands);
    const cube: HTMLElement = this.section_make('THE CUBE', 'tdc-col-glance');
    const attach: HTMLButtonElement = el('button', 'tdc-pill tdc-pill-plain', 'ATTACH · LATER');
    attach.type = 'button';
    attach.disabled = true;
    attach.title = 'domain attach starts the domain session; it comes after the ChRIS steps';
    cube.append(this.pairs_make([['SIGN-IN', 'THE DOMAIN\'S OWN'], ['CUBE', domain.steps.some((step): boolean => step.name === 'chris-deploy' && step.state === 'done') ? `cube.apps.${domain.cluster ?? ''}` : 'NOT DEPLOYED']]),
      el('p', 'tdc-prose', 'ATTACH starts the domain session: a second daemon on the ChRIS backend, signed in through the domain\'s own sign-in. This session never holds the CUBE token; that one never holds a cloud key.'), attach);
    return [storage, steps, cube];
  }

  private teardown_make(domain: DomainSummary): HTMLElement[] {
    const goes: HTMLElement = this.section_make('WHAT GOES · IN THIS ORDER', 'tdc-col-wide', 'ONLY WHAT THIS DOMAIN MADE');
    const rows: Array<[string, string]> = [
      ['the stack\'s resources', 'a destroy job on the domain\'s Resource Manager stack'],
      ['the DNS records', 'api, api-int and *.apps in the zone'],
      ['the image and its link', 'the discovery ISO and its pre-authenticated request'],
      ['the cluster\'s volumes', 'the block volumes the CSI driver made for its claims, found through the cluster'],
      ['the installer\'s records', 'the cluster and the infra-env at Red Hat'],
    ];
    const list: HTMLElement = el('div', 'tdc-teardown-rows');
    for (const [what, how] of rows) list.append(el('span', 'tdc-destroy-mark', '−'), el('span', 'tdc-teardown-what', what), el('span', 'tdc-teardown-how', how));
    goes.append(list, el('p', 'tdc-prose tdc-quiet', 'Nothing else in the compartment is touched. The engine counts the stack and the volumes when the line runs, and asks for the domain\'s name typed back.'));

    const guard: HTMLElement = this.section_make('THE GUARD', 'tdc-col-side');
    const refused: string | undefined = domain.refused?.['teardown'];
    const protectedOnly: boolean = refused !== undefined && refused.startsWith('protected');
    if (refused !== undefined && !protectedOnly) {
      const box: HTMLElement = el('div', 'tdc-note tdc-note-refused');
      box.append(el('span', 'tdc-note-title', 'REFUSED BY NAME'), el('span', 'tdc-mono', `domain teardown: ${domain.name}: Operation not permitted: ${refused}`));
      guard.append(box);
      return [goes, guard];
    }
    const lock: HTMLElement = el('div', `tdc-note ${domain.protected !== false ? 'tdc-note-locked' : 'tdc-note-refused'}`);
    lock.append(el('span', 'tdc-note-title', domain.protected !== false ? 'PROTECTED' : 'UNLOCKED'), el('span', 'tdc-prose', domain.protected !== false
      ? 'A domain is born protected. Lifting the lock is a line of its own, so no single slip or replayed line removes a tenant.'
      : 'The lock is off. TEAR DOWN sends the line; the engine lists what goes and asks for the name typed back.'));
    const commands: HTMLElement = el('div', 'tdc-commands');
    if (domain.protected !== false) commands.append(this.linePill_make('LIFT THE LOCK', LINES.protect(domain.name, false), 'quiet'));
    else commands.append(this.linePill_make('LOCK AGAIN', LINES.protect(domain.name, true), 'quiet'), el('span', 'tdc-flex'), this.linePill_make('TEAR DOWN', LINES.teardown(domain.name), 'destroy'));
    lock.append(commands);
    guard.append(lock);
    return [goes, guard];
  }

  // ------------------------------------------------------------------ SIZE

  private async size_need(family?: string): Promise<void> {
    if (this.sizeAsked && family === undefined) return;
    this.sizeAsked = true;
    const read: DomainSizeModel | null = await this.hooks.size_read(family);
    if (read === null) return;
    this.size = read;
    const keep: DomainSpecModel | null = this.levers;
    this.levers = keep === null ? spec_copy(read.start) : { ...keep, family: read.family };
    this.draw();
  }

  private size_make(domain: DomainSummary | null): HTMLElement[] {
    const existing: boolean = domain !== null;
    if (existing && domain?.spec !== null && domain?.spec !== undefined && (this.levers === null || this.current !== NEW_KEY)) this.levers = spec_copy(domain.spec);
    const levers: HTMLElement = this.section_make(existing ? `THE SPEC OF ${domain?.name.toUpperCase()}` : 'A NEW DOMAIN', 'tdc-col-levers');
    if (this.size === null || this.levers === null) {
      levers.append(el('p', 'tdc-prose tdc-quiet', 'reading what a domain is sized against: domain size'));
      return [levers];
    }
    const spec: DomainSpecModel = this.levers;
    const size: DomainSizeModel = this.size;
    if (!existing) {
      const nameRow: HTMLElement = el('div', 'tdc-name-row');
      const label: HTMLElement = el('label', 'tdc-pair-label', 'NAME');
      const input: HTMLInputElement = el('input', 'tdc-name-input');
      input.id = 'tdc-new-name';
      label.setAttribute('for', input.id);
      input.value = this.newName;
      input.placeholder = 'a DNS label, as quay';
      input.spellcheck = false;
      input.addEventListener('input', (): void => { this.newName = input.value.trim(); this.sized_redraw(); });
      nameRow.append(label, input);
      levers.append(nameRow);
    } else {
      levers.append(el('p', 'tdc-prose tdc-quiet', 'A domain\'s spec is written once, by domain new. These are its sizes, against the region now; + NEW sizes another.'));
    }
    const families: HTMLElement = el('div', 'tdc-families');
    families.append(el('span', 'tdc-pair-label', 'FAMILY'));
    const offered: string[] = [...new Set([spec.family, 'E5', 'E4', 'E6', 'A1'].filter((family: string): boolean => size.families.includes(family)))];
    for (const family of offered) {
      const pill: HTMLButtonElement = el('button', `tdc-family${family === spec.family ? ' tdc-family-on' : ''}`, family);
      pill.type = 'button';
      pill.disabled = existing;
      pill.addEventListener('click', (): void => { this.hooks.voice.pill(family); if (this.levers !== null) this.levers.family = family; void this.size_need(family); });
      families.append(pill);
    }
    levers.append(families);
    const slider = (id: string, name: string, min: number, max: number, step: number, read: () => number, write: (value: number) => void, note?: string): HTMLElement => {
      const row: HTMLElement = el('div', 'tdc-slider');
      const label: HTMLElement = el('label', 'tdc-slider-label', name);
      const input: HTMLInputElement = el('input', 'tdc-slider-input');
      input.type = 'range';
      input.id = `tdc-${id}`;
      label.setAttribute('for', input.id);
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(read());
      input.disabled = existing || min === max;
      const shown: HTMLElement = el('span', 'tdc-slider-value', String(read()));
      input.addEventListener('input', (): void => { write(Number(input.value)); shown.textContent = input.value; this.sized_redraw(); });
      const track: HTMLElement = el('div', 'tdc-slider-track');
      const ends: HTMLElement = el('div', 'tdc-slider-ends');
      ends.append(el('span', '', String(min)), el('span', 'tdc-slider-note', note ?? ''), el('span', '', String(max)));
      track.append(input, ends);
      row.append(label, track, shown);
      return row;
    };
    const maxVcpu: number = size.cores === null ? 64 : Math.min(size.cores.max * size.vcpuPerCore, 128);
    const maxGib: number = size.memoryGib === null ? 512 : Math.min(size.memoryGib.max, 1024);
    const group = (title: string, rows: HTMLElement[]): HTMLElement => {
      const box: HTMLElement = el('div', 'tdc-lever-group');
      box.append(el('span', 'tdc-section-title', title), ...rows);
      return box;
    };
    levers.append(
      group('CONTROL PLANE', [
        slider('pc', 'NODES', 3, 3, 1, (): number => spec.controlPlane.count, (): void => {}, 'ONE PER ZONE · FIXED'),
        slider('pv', 'vCPU EACH', 4, maxVcpu, 2, (): number => spec.controlPlane.vcpu, (value: number): void => { spec.controlPlane.vcpu = value; }),
        slider('pr', 'GiB EACH', 16, maxGib, 4, (): number => spec.controlPlane.ramGib, (value: number): void => { spec.controlPlane.ramGib = value; }),
      ]),
      group('WORKERS', [
        slider('wc', 'NODES', 0, 12, 1, (): number => spec.workers.count, (value: number): void => { spec.workers.count = value; }, '0 · COMPACT'),
        slider('wv', 'vCPU EACH', 4, maxVcpu, 2, (): number => spec.workers.vcpu, (value: number): void => { spec.workers.vcpu = value; }),
        slider('wr', 'GiB EACH', 16, maxGib, 8, (): number => spec.workers.ramGib, (value: number): void => { spec.workers.ramGib = value; }),
      ]),
      group('CHRIS', [
        slider('cd', 'DATA GiB', 20, 2000, 10, (): number => spec.chris.dataGib, (value: number): void => { spec.chris.dataGib = value; }, 'GROWS LATER · NEVER SHRINKS'),
        slider('cb', 'DATABASE GiB', 5, 200, 5, (): number => spec.chris.databaseGib, (value: number): void => { spec.chris.databaseGib = value; }, 'FIXED AFTER THE FIRST DEPLOY'),
      ]),
    );
    const fit: HTMLElement = this.section_make(`FIT · ${spec.family} PER ZONE, AS SIZED`, 'tdc-col-fit', `FROM ${size.region} · READ ONCE`);
    const cost: HTMLElement = this.section_make('COST · PER HOUR, FROM THE PRICE LIST', 'tdc-col-cost');
    this.fit_fill(fit);
    this.cost_fill(cost, !existing);
    return [levers, fit, cost];
  }

  private sized_redraw(): void {
    const fit: HTMLElement | null = this.parts.body.querySelector('.tdc-col-fit');
    const cost: HTMLElement | null = this.parts.body.querySelector('.tdc-col-cost');
    if (fit !== null) this.fit_fill(fit);
    if (cost !== null) this.cost_fill(cost, this.current === NEW_KEY);
    this.header_draw();
  }

  private fit_fill(section: HTMLElement): void {
    section.querySelectorAll('.tdc-zone').forEach((node: Element): void => node.remove());
    if (this.size === null || this.levers === null) return;
    for (const zone of sizeFit_of(this.size, this.levers, this.newName || this.current || 'new')) {
      const box: HTMLElement = el('div', `tdc-zone${zone.fits === false ? ' tdc-zone-bad' : zone.tightest ? ' tdc-zone-tight' : ''}`);
      const head: HTMLElement = el('div', 'tdc-zone-head');
      head.append(el('span', 'tdc-zone-name', zoneShort_of(zone.zone)), el('span', 'tdc-zone-verdict', zone.fits === null ? 'NOT SAID' : zone.fits ? (zone.tightest ? 'FITS · TIGHTEST' : 'FITS') : 'DOES NOT FIT'));
      const bar = (needed: number, free: number | null, unit: string): HTMLElement => {
        const row: HTMLElement = el('div', 'tdc-zone-bar');
        const track: HTMLElement = el('div', 'tdc-zone-track');
        const take: HTMLElement = el('div', 'tdc-zone-take');
        take.style.width = free === null || free <= 0 ? '0%' : `${Math.min(100, (needed / free) * 100)}%`;
        track.append(take);
        row.append(el('span', 'tdc-zone-unit', unit), track, el('span', 'tdc-zone-text', `${needed} OF ${free ?? '?'}`));
        return row;
      };
      box.append(head, bar(zone.coresNeeded, zone.coresFree, 'CORES'), bar(zone.memoryNeeded, zone.memoryFree, 'GiB'), el('span', 'tdc-zone-nodes', zone.nodes.join(' · ') || 'nothing placed'));
      section.append(box);
    }
  }

  private cost_fill(section: HTMLElement, committing: boolean): void {
    section.querySelectorAll('.tdc-cost-rows, .tdc-commit').forEach((node: Element): void => node.remove());
    if (this.size === null || this.levers === null) return;
    const cost = sizeCost_of(this.size, this.levers);
    const rows: HTMLElement = el('div', 'tdc-cost-rows');
    for (const row of cost.rows) rows.append(el('span', 'tdc-pair-label', row.what), el('span', 'tdc-cost-rate', row.hourly === null ? 'NOT PRICED' : money_text(row.hourly, cost.currency, 3)));
    rows.append(el('span', 'tdc-pair-label tdc-bill', 'TOTAL · EST'), el('span', 'tdc-cost-rate tdc-bill', cost.hourly === null ? '—' : `${money_text(cost.hourly, cost.currency)} · ${money_text(cost.hourly * HOURS_PER_MONTH, cost.currency, 0)} A MONTH`));
    section.append(rows);
    if (committing) {
      const commit: HTMLElement = el('div', 'tdc-commit');
      section.append(commit);
      this.commit_fill(commit);
    }
  }

  private commit_fill(commit: HTMLElement): void {
    if (this.size === null || this.levers === null) return;
    commit.replaceChildren();
    const refusal: string | null = nameRefusal_of(this.newName, this.names_get());
    const line: string = newLine_of(this.newName || '<name>', this.levers, this.size.start);
    commit.append(el('span', 'tdc-section-title', 'THE LINE COMMIT SENDS'), el('div', 'tdc-mono tdc-commit-line', line),
      el('p', 'tdc-prose tdc-quiet', 'Writes the spec only. Nothing is made in the tenancy until BUILD, and BUILD asks before billing.'));
    const pills: HTMLElement = el('div', 'tdc-commands');
    const button: HTMLButtonElement = el('button', 'tdc-pill tdc-pill-plain', refusal === null ? 'COMMIT' : `COMMIT · ${refusal}`);
    button.type = 'button';
    button.disabled = refusal !== null || this.busy !== null;
    button.addEventListener('click', (): void => {
      this.hooks.voice.pill('COMMIT');
      const name: string = this.newName;
      void this.line_send(line).then((): void => { if (this.domains.has(name)) { this.current = name; this.newName = ''; this.view = 'overview'; this.draw(); } });
    });
    const reset: HTMLButtonElement = el('button', 'tdc-pill tdc-pill-quiet', 'RESET');
    reset.type = 'button';
    reset.addEventListener('click', (): void => { this.hooks.voice.pill('RESET'); if (this.size !== null) this.levers = spec_copy(this.size.start); this.draw(); });
    pills.append(button, el('span', 'tdc-flex'), reset);
    commit.append(pills);
  }

  // -------------------------------------------------------------- the strip

  private strip_draw(): void {
    const strip: HTMLElement = this.parts.strip;
    strip.replaceChildren();
    strip.hidden = this.ask === null;
    if (this.ask === null) return;
    const ask: OpenAsk = this.ask;
    const destroying: boolean = /destroy/i.test(ask.message);
    const billing: boolean = /billing starts/i.test(ask.message);
    strip.dataset['tone'] = destroying ? 'destroy' : billing ? 'bill' : 'plain';
    const words: HTMLElement = el('div', 'tdc-strip-words');
    words.append(el('span', 'tdc-strip-title', 'THE ENGINE ASKS'), el('span', 'tdc-strip-text', ask.message));
    strip.append(words);
    if (askForm_of(ask.message) === 'yes-no') {
      const yes: HTMLButtonElement = el('button', `tdc-pill ${billing ? 'tdc-pill-bill' : 'tdc-pill-plain'}`, billing ? 'YES · BILL' : 'YES');
      yes.type = 'button';
      yes.addEventListener('click', (): void => { this.hooks.voice.pill('YES'); this.log_add('y', 'answer'); ask.answer('y'); });
      const no: HTMLButtonElement = el('button', 'tdc-pill tdc-pill-quiet', 'NO');
      no.type = 'button';
      no.addEventListener('click', (): void => { this.hooks.voice.pill('NO'); this.log_add('n', 'answer'); ask.answer('n'); });
      strip.append(yes, no);
      return;
    }
    const input: HTMLInputElement = el('input', 'tdc-strip-input');
    input.id = 'tdc-strip-input';
    input.type = ask.kind === 'secret' ? 'password' : 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    const label: HTMLElement = el('label', 'tdc-pair-label', destroying ? 'NAME' : 'ANSWER');
    label.setAttribute('for', input.id);
    const send: HTMLButtonElement = el('button', `tdc-pill ${destroying ? 'tdc-pill-destroy' : 'tdc-pill-plain'}`, destroying ? 'DESTROY' : 'SEND');
    send.type = 'button';
    const name: string = this.current;
    if (destroying) {
      send.disabled = true;
      input.addEventListener('input', (): void => { send.disabled = input.value.trim() !== name; });
    }
    const answer = (): void => {
      if (send.disabled) return;
      this.hooks.voice.pill(send.textContent ?? '');
      this.log_add(ask.kind === 'secret' ? '(hidden)' : input.value, 'answer');
      ask.answer(input.value);
    };
    send.addEventListener('click', answer);
    input.addEventListener('keydown', (event: KeyboardEvent): void => { if (event.key === 'Enter') answer(); });
    const no: HTMLButtonElement = el('button', 'tdc-pill tdc-pill-quiet', 'NO');
    no.type = 'button';
    no.addEventListener('click', (): void => { this.hooks.voice.pill('NO'); this.log_add('(declined)', 'answer'); ask.answer(''); });
    strip.append(label, input, send, no);
    queueMicrotask((): void => input.focus());
  }

  // ---------------------------------------------------------------- the log

  private log_add(text: string, kind: 'sent' | 'out' | 'ask' | 'answer' | 'note'): void {
    const row: HTMLElement = el('span', `tdc-log-line tdc-log-${kind}`, text);
    this.parts.log.append(row);
    while (this.parts.log.childElementCount > LOG_LIMIT) this.parts.log.firstElementChild?.remove();
    this.parts.log.scrollTop = this.parts.log.scrollHeight;
    if (kind === 'out' && this.stepLogLine !== null && this.busy === this.stepLogLine) {
      this.stepLog.push(text);
      if (this.view === 'build') {
        const box: HTMLElement | null = this.parts.body.querySelector('.tdc-steplog');
        if (box !== null) {
          box.querySelector('.tdc-quiet')?.remove();
          box.append(el('span', 'tdc-steplog-line', text));
          while (box.childElementCount > 60) box.firstElementChild?.remove();
          box.scrollTop = box.scrollHeight;
        }
      }
    }
  }

  private async kill_send(job: string): Promise<void> {
    // The build's line holds the lane while it follows: stop following first, then ask the task to stop.
    if (this.busy !== null) {
      this.hooks.stop();
      for (let i: number = 0; i < 50 && this.busy !== null; i++) await new Promise((resolve): void => { setTimeout(resolve, 100); });
    }
    await this.line_send(LINES.kill(job));
  }

  private cues_play(was: DomainSummary | null, now: DomainSummary | null): void {
    if (was === null || now === null || was.name !== now.name) return;
    if (was.condition !== 'FAILED' && now.condition === 'FAILED') { this.hooks.voice.cue('redalert'); return; }
    const doneBefore: number = stepsDone_of(was).done;
    if (stepsDone_of(now).done > doneBefore) this.hooks.voice.cue('ack');
  }
}
