/**
 * @file Cache-only summaries for registered Pipeline executables in `/bin`.
 *
 * Reading an executable entry must not hydrate its registered invocation
 * manifest. This module uses the warm `/bin` listing when available and falls
 * back to the stable `_id<N>` suffix, without making a CUBE request.
 *
 * @module
 */
import { listCache_get } from '@fnndsc/cumin';
import type { VFSItem } from '@fnndsc/salsa';
import { dump as yamlDump } from 'js-yaml';

type CachedBinEntry = Pick<VFSItem, 'name' | 'type' | 'id' | 'title'>;

/** Shallow identity and discovery information for one Pipeline executable. */
export interface BinPipelineSummary {
  command: string;
  pipelineID: number;
  name?: string;
}

/**
 * Resolve a Pipeline executable from cached `/bin` identity only.
 *
 * @param commandName - Exact dynamic `/bin` entry basename.
 * @returns A shallow summary, or null when the name is known not to be a Pipeline.
 */
export function binPipelineSummary_try(commandName: string): BinPipelineSummary | null {
  const idMatch: RegExpMatchArray | null = commandName.match(/_id(\d+)$/);
  if (idMatch === null) return null;

  const cached = listCache_get().cache_get<CachedBinEntry[]>('/bin');
  const entry: CachedBinEntry | undefined = cached?.data.find(
    (candidate: CachedBinEntry): boolean =>
      candidate.type === 'pipeline' && candidate.name === commandName,
  );
  if (cached !== null && entry === undefined) return null;

  return {
    command: commandName,
    pipelineID: entry?.id ?? Number(idMatch[1]),
    name: entry?.title,
  };
}

/**
 * Serialize a shallow Pipeline executable summary.
 *
 * @param summary - Cache-only Pipeline identity and discovery information.
 * @returns Stable YAML directing callers to the explicit manifest command.
 */
export function binPipelineSummary_render(summary: BinPipelineSummary): string {
  return yamlDump({
    kind: 'pipeline',
    pipeline_id: summary.pipelineID,
    ...(summary.name === undefined ? {} : { name: summary.name }),
    command: summary.command,
    manifest: `pipeline manifest ${summary.command}`,
  }, { noRefs: true, lineWidth: -1 });
}
