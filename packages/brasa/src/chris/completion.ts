/**
 * @file What a ChRIS session adds to completion: its plugins as command
 * words, a pipeline's `--node.field` options, and the names completed at `/`.
 *
 * @module
 */
import { plugins_listAll, pipelineManifest_get, type PipelineManifest, type PipelineManifestNode } from '@fnndsc/salsa';
import { listCache_get } from '@fnndsc/cumin';
import type { ListingItem } from '@fnndsc/menu';
import type { BackendCompletion } from '../core/backend.js';

/**
 * Fetches available plugin names from /bin in the format: name-vVersion.
 * This matches the display format used in /bin listings.
 * Uses cache first for fast completion.
 * @returns Array of plugin names with version suffixes.
 */
async function plugins_getNames(): Promise<string[]> {
  try {
    // Check cache first for /bin
    const listCache = listCache_get();
    const cached = listCache.cache_get<ListingItem[]>('/bin');

    if (cached && cached.data) {
      // Return cached plugin names immediately
      return cached.data.map((item: ListingItem) => item.name);
    }

    // Cache miss - fetch from API (only on first tab completion)
    const plugins = await plugins_listAll({});
    if (plugins && plugins.tableData) {
      const pluginNames: string[] = plugins.tableData.map((p: Record<string, unknown>) => {
        const name: string = typeof p.name === 'string' ? p.name : String(p.name ?? '');
        const version: string = typeof p.version === 'string' ? p.version : String(p.version ?? '');
        // Format as name-vVersion to match /bin display format
        return version ? `${name}-v${version}` : name;
      });

      // Cache it for next time
      const lsItems: ListingItem[] = plugins.tableData.map((p: Record<string, unknown>) => {
        const name: string = typeof p.name === 'string' ? p.name : String(p.name ?? '');
        const version: string = typeof p.version === 'string' ? p.version : String(p.version ?? '');
        return {
          name: version ? `${name}-v${version}` : name,
          type: 'plugin' as const,
          size: 0,
          owner: 'system',
          date: p.creation_date ? String(p.creation_date) : '',
        };
      });
      listCache.cache_set('/bin', lsItems);

      return pluginNames;
    }
  } catch (e: unknown) {
    // Silently fail if plugins cannot be fetched
  }
  return [];
}


/** The fields every pipeline node takes for its execution. */
const EXECUTION_FIELDS: ReadonlyArray<string> = [
  'compute_resource_name', 'cpu_limit', 'memory_limit', 'gpu_limit', 'number_of_workers',
];

/**
 * The `--node.field` options of the pipeline a line runs (`pipeline run X`
 * or `X` itself), starting with the word typed.
 *
 * @param args - The line's words.
 * @param word - The option word typed so far.
 * @returns The options, none when the pipeline cannot be read, or null for
 *   a line naming no pipeline.
 */
async function pipelineOptions_get(args: string[], word: string): Promise<string[] | null> {
  const pipelineSpecifier: string | undefined = args[0] === 'pipeline' && args[1] === 'run'
    ? args[2]
    : args[0];
  if (pipelineSpecifier === undefined) return null;
  const result = await pipelineManifest_get(pipelineSpecifier);
  if (!result.ok) return [];
  const options: string[] = [];
  const manifest: PipelineManifest = result.value as PipelineManifest;
  for (const node of manifest.nodes) {
    const titleUsable: boolean = /^[A-Za-z0-9_-]+$/.test(node.title) &&
      manifest.nodes.filter(
        (candidate: PipelineManifestNode): boolean => candidate.title === node.title,
      ).length === 1;
    const selectors: string[] = titleUsable ? [node.title, `@${node.pipingID}`] : [`@${node.pipingID}`];
    const fields: string[] = [
      ...EXECUTION_FIELDS,
      ...(node.parameterDefinitions ?? [])
        .filter((parameter) => parameter.name !== 'plugininstances')
        .map((parameter) => parameter.name),
    ];
    for (const field of fields) {
      options.push(...selectors.map((selector: string): string => `--${selector}.${field}`));
    }
  }
  return options.filter((option: string): boolean => option.startsWith(word));
}

/** What the ChRIS session adds to completion. */
export const chrisCompletion: BackendCompletion = {
  commandWords: plugins_getNames,
  options: pipelineOptions_get,
  rootWords: ['bin', 'usr'],
};
