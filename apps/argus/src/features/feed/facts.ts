/**
 * @file A feed node's facts, the one way (law a-feed-has-one-view): the
 * overlay the RUNS pane and the universe's descent show for the node the
 * operator picked — what it is, where it stands, what it cost, its line of
 * stages, and the two things to do about it.
 *
 * The two panes had each written their own, and they had drifted: the
 * universe's lacked the wall time, the size, the faults and the line, and
 * offered PROCESS on a `×N` group, which RUNS rightly refuses — an
 * aggregate has no single instance for a run to append to.
 *
 * @module
 */
import type { FeedDagNode } from '@fnndsc/menu';
import { duration_format, size_format } from '../dag/roster.js';

/** What a node's overlay can do about it. */
export interface FeedFactsVerbs {
  /** Fly into the node (its data, browsable inside). */
  enter?: () => void;
  /** A catalogue bound to the node's data; refused on a `×N` group. */
  process?: (node: { vfsPath: string; instanceId: number; label: string }) => void;
}

/**
 * The rows of a node's facts.
 *
 * @param payload - The kernel's node.
 * @returns Label and value, in reading order.
 */
export function feedFacts_rows(payload: FeedDagNode): Array<[string, string]> {
  const settled: boolean = payload.status === 'finishedSuccessfully' || payload.status === 'finishedWithError' || payload.status === 'cancelled';
  // Metrics ride the warmed process cache; a settled node without them has
  // simply not been backfilled yet.
  const pending: string = settled ? 'awaiting warmup' : 'in flight';
  const tally = payload.tally;
  return [
    ['PLUGIN', payload.pluginName],
    [tally ? 'REP. INSTANCE' : 'INSTANCE', String(payload.instanceId)],
    ['STATUS', payload.status],
    ...(tally ? ([['COUNT', `×${tally.count} — ${tally.done} done, ${tally.error} err, ${tally.running} live, ${tally.other} other`]] as Array<[string, string]>) : []),
    ...(tally?.anomalies !== undefined && tally.anomalies.length > 0
      ? ([['FAULTS', tally.anomalies.map((a): string => a.id).join(' ') + (tally.count > tally.done + tally.anomalies.length ? ' …' : '')]] as Array<[string, string]>)
      : []),
    ['WALL', payload.metrics?.computeSeconds !== undefined ? duration_format(payload.metrics.computeSeconds) : pending],
    ['SIZE', payload.metrics?.dataBytes !== undefined ? size_format(payload.metrics.dataBytes) : pending],
    ['DATA', payload.vfsPath],
  ];
}

/**
 * Puts a node's facts on an overlay: the rows, the line of stages, and the
 * verbs. A control lives where it acts: the facts describe this node, and
 * what to do about it acts on this node.
 *
 * @param into - The overlay.
 * @param payload - The kernel's node.
 * @param verbs - What the pane can do about it.
 */
export function feedFacts_render(into: HTMLElement, payload: FeedDagNode, verbs: FeedFactsVerbs): void {
  into.replaceChildren();
  for (const [label, value] of feedFacts_rows(payload)) {
    const row: HTMLDivElement = document.createElement('div');
    row.className = 'telemetry-row';
    const name: HTMLSpanElement = document.createElement('span');
    name.className = 'telemetry-label';
    name.textContent = label;
    const figure: HTMLSpanElement = document.createElement('span');
    figure.className = 'telemetry-value';
    figure.textContent = value;
    row.append(name, figure);
    into.appendChild(row);
  }
  into.appendChild(subway_build(payload.status));
  const row: HTMLDivElement = document.createElement('div');
  row.className = 'feed-node-verbs';
  if (verbs.enter !== undefined) {
    const enter: HTMLButtonElement = document.createElement('button');
    enter.className = 'pacs-capsule feed-node-enter';
    enter.textContent = 'ENTER NODE';
    enter.title = 'fly into the node: its data, browsable inside (Esc flies out)';
    enter.addEventListener('click', verbs.enter);
    row.appendChild(enter);
  }
  if (verbs.process !== undefined) {
    const process: (node: { vfsPath: string; instanceId: number; label: string }) => void = verbs.process;
    const pill: HTMLButtonElement = document.createElement('button');
    pill.className = 'pacs-capsule dag-process';
    pill.textContent = 'PROCESS';
    // A collapsed ×N group is withheld rather than guessed at: an aggregate
    // has no single instance for a run to append to.
    if (payload.tally !== undefined) {
      pill.disabled = true;
      pill.title = `${payload.tally.count} instances stand here: open one to process it`;
      pill.classList.add('pacs-capsule-off');
    } else {
      pill.title = `open /bin bound to ${payload.label} — a run appends to this node`;
      pill.addEventListener('click', (): void => process({ vfsPath: payload.vfsPath, instanceId: payload.instanceId, label: payload.label }));
    }
    row.appendChild(pill);
  }
  if (row.childElementCount > 0) into.appendChild(row);
}

/** The job lifecycle, in order — the subway line a node rides. */
const SUBWAY_STAGES: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'created', label: 'CREATED' },
  { key: 'waiting', label: 'WAITING' },
  { key: 'scheduled', label: 'SCHEDULED' },
  { key: 'started', label: 'STARTED' },
  { key: 'registeringFiles', label: 'REGISTERING' },
];

/**
 * Builds the subway strip: the node's lifecycle as stops on a line, filled
 * to where the job actually is — the classic ChRIS UI progression carried
 * over. A happy terminal fills the whole line; an error or cancellation
 * ends the line at a red terminal stop.
 *
 * Every stop is NAMED. As bare dots the strip could only be read by a hand
 * that already knew the lifecycle, and a tooltip is not a readout: the one
 * moment the strip earns its place is a node in flight, and that is exactly
 * when the operator wants to know which stage it is standing at without
 * hunting for it. The stop it stands at says so in words, and the strip
 * says how far along the line that is. Nothing here animates: a node moves
 * when the feed says it moved, and motion on this surface is asked for.
 *
 * @param status - The node's current CUBE status.
 * @returns The strip element.
 */
export function subway_build(status: string): HTMLElement {
  const strip: HTMLDivElement = document.createElement('div');
  strip.className = 'dag-subway';
  const doneAll: boolean = status === 'finishedSuccessfully';
  const failed: boolean = status === 'finishedWithError' || status === 'cancelled';
  const at: number = SUBWAY_STAGES.findIndex((stage): boolean => stage.key === status);
  const reached: number = doneAll || failed ? SUBWAY_STAGES.length : at;
  if (!doneAll && !failed) strip.classList.add('dag-subway-live');

  /**
   * One stop and the word under it.
   *
   * @param label - The stage's name.
   * @param classes - The stop's state classes.
   * @param here - Whether the node stands here.
   * @returns The step.
   */
  const step_build = (label: string, classes: string, here: boolean): HTMLElement => {
    const step: HTMLSpanElement = document.createElement('span');
    step.className = `subway-step${here ? ' subway-step-here' : ''}`;
    const stop: HTMLSpanElement = document.createElement('span');
    stop.className = classes;
    const name: HTMLSpanElement = document.createElement('span');
    name.className = 'subway-label';
    name.textContent = label;
    step.append(stop, name);
    return step;
  };

  SUBWAY_STAGES.forEach((stage, index): void => {
    if (index > 0) {
      const link: HTMLSpanElement = document.createElement('span');
      link.className = 'subway-link' + (index <= reached ? ' subway-passed' : '');
      strip.appendChild(link);
    }
    const here: boolean = index === at && !doneAll && !failed;
    strip.appendChild(step_build(
      stage.label,
      'subway-stop' + (index < reached ? ' subway-passed' : '') + (here ? ' subway-here' : ''),
      here,
    ));
  });
  const lastLink: HTMLSpanElement = document.createElement('span');
  lastLink.className = 'subway-link' + (doneAll || failed ? ' subway-passed' : '');
  strip.appendChild(lastLink);
  strip.appendChild(step_build(
    doneAll ? 'FINISHED' : failed ? (status === 'cancelled' ? 'CANCELLED' : 'ERROR') : 'FINISHED',
    'subway-stop subway-terminal' + (doneAll ? ' subway-done' : '') + (failed ? ' subway-failed' : ''),
    false,
  ));
  return strip;
}

