/**
 * @file Pipeline-first resolution for dynamic `/bin` entries.
 *
 * Pipeline names and plugin executable names share one namespace. This module
 * probes exact registered Pipeline identity first and removes only probe-local
 * errors before the caller falls through to versioned plugin resolution.
 *
 * @module
 */
import { errorStack, type Result } from '@fnndsc/cumin';
import {
  pipelineManifestBySlug_get,
  type PipelineManifest,
} from '@fnndsc/salsa';
import { sink_get } from '../../../core/sink.js';

const PIPELINE_PROGRESS_DELAY_MS: number = 300;
const PIPELINE_PROGRESS_LABEL: string = 'Reading registered pipeline…';

/**
 * Try to resolve one `/bin` basename as a registered Pipeline.
 *
 * @param commandName - Exact dynamic `/bin` entry basename.
 * @returns Registered manifest, or null after clearing failed-probe errors.
 */
export async function binPipelineManifest_try(commandName: string): Promise<PipelineManifest | null> {
  const checkpoint: number = errorStack.checkpoint_mark();
  let progressStarted: boolean = false;
  const progressTimer: NodeJS.Timeout = setTimeout((): void => {
    progressStarted = true;
    sink_get().progress_write({
      operation: 'pipeline',
      kind: 'inspection',
      phase: 'reading',
      label: PIPELINE_PROGRESS_LABEL,
      status: 'running',
    });
  }, PIPELINE_PROGRESS_DELAY_MS);
  let result: Result<PipelineManifest>;
  let progressFailed: boolean = false;
  try {
    result = await pipelineManifestBySlug_get(commandName);
  } catch (error: unknown) {
    progressFailed = true;
    throw error;
  } finally {
    clearTimeout(progressTimer);
    if (progressStarted) {
      sink_get().progress_write({
        operation: 'pipeline',
        kind: 'inspection',
        phase: progressFailed ? 'failed' : 'complete',
        label: PIPELINE_PROGRESS_LABEL,
        status: progressFailed ? 'error' : 'done',
      });
    }
  }
  if (result.ok) return result.value;
  errorStack.checkpoint_drain(checkpoint);
  return null;
}
