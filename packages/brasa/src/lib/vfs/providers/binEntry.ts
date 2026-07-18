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

/**
 * Try to resolve one `/bin` basename as a registered Pipeline.
 *
 * @param commandName - Exact dynamic `/bin` entry basename.
 * @returns Registered manifest, or null after clearing failed-probe errors.
 */
export async function binPipelineManifest_try(commandName: string): Promise<PipelineManifest | null> {
  const checkpoint: number = errorStack.checkpoint_mark();
  const result: Result<PipelineManifest> = await pipelineManifestBySlug_get(commandName);
  if (result.ok) return result.value;
  errorStack.checkpoint_drain(checkpoint);
  return null;
}
