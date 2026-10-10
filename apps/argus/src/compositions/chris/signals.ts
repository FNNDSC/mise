/**
 * @file What the ChRIS composition hears from the session beyond its models:
 * the prompt's context, the telemetry heartbeat and progress. The index
 * instrument (jobs and feeds, the lab's pulse, CUBE's pace) is its own; RUNS,
 * the universe and PACS take their share of each signal.
 *
 * @module
 */
import type { CubeTelemetry, JobsStateTelemetry, ProgressMessage, PromptContext } from '@fnndsc/menu';
import { IndexInstrument } from '../../app/indexInstrument.js';
import type { DagPanel } from '../../features/dag/panel.js';
import type { UniversePanel } from '../../features/universe/panel.js';
import type { PacsPanel } from '../../features/pacs/panel.js';

/** What the signals reach in the running surface. */
export interface ChrisSignalContext {
  /** The primary RUNS pane. */
  dag_primary(): DagPanel;
  /** The RUNS panes split in beside the primary. */
  dag_instances(): DagPanel[];
  universes(): UniversePanel[];
  pacs(): PacsPanel;
  /** Opens the roster, filtered. */
  runs_show(filter: string): void;
}

/** The ChRIS composition's share of the session's signals. */
export interface ChrisSignals {
  promptContext_take(context: PromptContext): void;
  telemetry_take(index: { jobs: number; feeds: number }, extra?: { cube?: CubeTelemetry; state?: JobsStateTelemetry }): void;
  progress_take(message: ProgressMessage): void;
}

/**
 * Builds the ChRIS signals: the index instrument in its header mount, and
 * the fan-out to RUNS, the universe and PACS.
 *
 * @param mount - The header's index instrument element.
 * @param ctx - What the signals reach.
 * @returns The signals.
 */
export function chrisSignals_make(mount: HTMLElement, ctx: ChrisSignalContext): ChrisSignals {
  const indexInstrument: IndexInstrument = new IndexInstrument(mount, (): number => Date.now(), {
    // The ERRORED figure is a control: it opens the runs roster filtered to
    // the feeds it counted. The pane it acts on is put on stage first.
    errored_open: (): void => ctx.runs_show('status:error'),
  });
  return {
    promptContext_take: (context: PromptContext): void => {
      indexInstrument.promptContext_show(context);
      ctx.dag_primary().promptContext_observe(context);
      for (const universe of ctx.universes()) universe.promptContext_observe(context);
    },
    telemetry_take: (index: { jobs: number; feeds: number }, extra?: { cube?: CubeTelemetry; state?: JobsStateTelemetry }): void => {
      indexInstrument.counts_show(index);
      if (extra?.state !== undefined) indexInstrument.state_show(extra.state);
      if (extra?.cube !== undefined) indexInstrument.pace_show(extra.cube.msPerPage);
    },
    progress_take: (message: ProgressMessage): void => {
      for (const dag of ctx.dag_instances()) dag.progress_observe(message);
      ctx.pacs().progress_observe(message);
    },
  };
}
