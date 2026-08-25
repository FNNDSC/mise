/**
 * @file Typed ChRIS API contract — domain-typed access to the hot wire surfaces.
 *
 * The adapter (`adapter.ts`) is the unsafe seam: the only module that imports
 * `@fnndsc/chrisapi` and the only one allowed to cast against it. This module
 * is the typed floor above that seam. It declares the wire shapes for the two
 * surfaces that have produced live defects (the jobs surface: plugin
 * instances, feeds; the PACS surface: download tokens, PACS files) and exposes
 * domain-typed accessors built purely on the adapter's generics. Downstream
 * packages call these instead of casting the opaque client per call site,
 * which is what this module exists to end.
 *
 * Key components:
 *   - ListPage<T>: normalized page shape (data + totalCount) for CUBE lists
 *   - FeedData / PluginInstanceData / InstanceParameterData: wire row shapes
 *   - feedsPage_get / publicFeedsPage_get / pluginInstancesPage_get: paged reads
 *   - pluginInstance_get: detail handle (data, parameters, status, logs, delete)
 *   - downloadToken_create: PACS/LONK download token
 *
 * Dependencies: only `adapter.ts`. This file must contain no unchecked double
 * casts and no `@fnndsc/chrisapi` import; the cast ratchet and the seam lint
 * enforce that shape.
 *
 * @module
 */

import {
  Client,
  itemData_get,
  items_get,
  listData_get,
  method_exists,
  resource_call,
} from './adapter';
import type { PipelineRecord } from '../pipelines/chrisPipeline';

/**
 * One normalized page of a paginated CUBE list.
 *
 * @property data - The rows of this page, in server order.
 * @property totalCount - The collection's total row count when the server
 *   reported one, otherwise null. A null total means "unknown", not zero.
 * @property hasMore - Whether the server says further pages exist, when it
 *   says anything at all. Servers may serve fewer rows than the requested
 *   limit while more remain, so a walk must trust this over page fullness.
 */
export interface ListPage<T> {
  data: T[];
  totalCount: number | null;
  hasMore?: boolean;
}

/**
 * Options controlling one paginated walk over a CUBE list.
 *
 * @property pageSize - Rows requested per page. Defaults to 100.
 * @property startOffset - Offset at which the walk begins. Defaults to 0; a
 *   resumed walk passes the offset its previous attempt had reached.
 * @property startTotal - Server total already latched by a previous attempt,
 *   or null when unknown. Defaults to null.
 */
export interface PageWalkOptions {
  pageSize?: number;
  startOffset?: number;
  startTotal?: number | null;
}

/**
 * One yielded step of a paginated walk.
 *
 * @property items - The rows of this page, in server order. May be empty on
 *   the final step.
 * @property offset - Offset at which this page was fetched.
 * @property total - The latched server total, or null while the server has
 *   not reported one. A null total means "unknown", not zero.
 */
export interface PageWalkStep<T> {
  items: T[];
  offset: number;
  total: number | null;
}

/**
 * Walks every page of a paginated CUBE list, yielding one step per page.
 *
 * This is the one pagination loop: it owns offset advancement, total
 * latching, and termination, so callers only consume rows. The walk ends
 * when a page comes back empty, when the latched total has been reached, or
 * when a short page arrives while the total is still unknown. Fetch errors
 * propagate to the caller; a resumed walk continues from `startOffset`.
 *
 * @param page_fetch - Fetches one page at the given offset and limit.
 * @param options - Page size and resume position. See PageWalkOptions.
 * @returns Async generator yielding a PageWalkStep per fetched page.
 *
 * @example
 * ```
 * for await (const step of listPages_walk((offset, limit) =>
 *   feedsPage_get(client, { limit, offset }))) {
 *   for (const feed of step.items) index.set(feed.id, feed);
 * }
 * ```
 */
export async function* listPages_walk<T>(
  page_fetch: (offset: number, limit: number) => Promise<ListPage<T>>,
  options: PageWalkOptions = {},
): AsyncGenerator<PageWalkStep<T>, void, void> {
  const pageSize: number = options.pageSize ?? 100;
  let offset: number = options.startOffset ?? 0;
  let total: number | null = options.startTotal ?? null;

  while (true) {
    const page: ListPage<T> = await page_fetch(offset, pageSize);
    const items: T[] = page.data;
    if (total === null && page.totalCount !== null) {
      total = page.totalCount;
    }
    yield { items, offset, total };
    if (items.length === 0) return;
    if (page.hasMore === false) return;
    if (total !== null && offset + items.length >= total) return;
    // A short page ends the walk only when the server gave no better signal:
    // a page can be shorter than the requested limit (server-side caps)
    // while hasMore says further pages exist.
    if (total === null && page.hasMore !== true && items.length < pageSize) return;
    offset += items.length;
  }
}

/**
 * Drains every page of a paginated CUBE list into one array.
 *
 * Convenience over listPages_walk for callers that need the complete
 * collection and nothing per-page. The single-shot `{ limit: 1000 }` idiom
 * this replaces silently truncated collections past its guess; the drain
 * walks to the actual end.
 *
 * @param page_fetch - Fetches one page at the given offset and limit.
 * @param options - Page size and resume position. See PageWalkOptions.
 * @returns Every row of the collection, in server order.
 */
export async function listPages_drain<T>(
  page_fetch: (offset: number, limit: number) => Promise<ListPage<T>>,
  options: PageWalkOptions = {},
): Promise<T[]> {
  const rows: T[] = [];
  for await (const step of listPages_walk(page_fetch, options)) {
    rows.push(...step.items);
  }
  return rows;
}

/**
 * Wire shape of one CUBE feed row, as served by the feeds list endpoints.
 *
 * @property id - Feed id.
 * @property name - Feed title.
 * @property owner_username - Owning user, when serialized.
 * @property public - Public visibility flag.
 * @property creation_date - ISO creation timestamp.
 * @property finished_jobs - Count of jobs finished successfully.
 * @property errored_jobs - Count of jobs finished with error.
 * @property started_jobs - Count of running jobs.
 * @property scheduled_jobs - Count of scheduled jobs.
 * @property cancelled_jobs - Count of cancelled jobs.
 * @property created_jobs - Count of created (not yet scheduled) jobs.
 */
export interface FeedData {
  id: number;
  name: string;
  owner_username?: string;
  public?: boolean;
  creation_date?: string;
  finished_jobs?: number;
  errored_jobs?: number;
  started_jobs?: number;
  scheduled_jobs?: number;
  cancelled_jobs?: number;
  created_jobs?: number;
  [key: string]: unknown;
}

/**
 * Wire shape of one CUBE plugin-instance row.
 *
 * @property id - Instance id.
 * @property feed_id - Owning feed id.
 * @property previous_id - Parent instance id, or null for a feed root.
 * @property plugin_name - Name of the plugin this instance runs.
 * @property plugin_type - Plugin type (`fs`, `ds`, `ts`), when serialized.
 * @property status - Current job status string.
 * @property output_path - CFS output directory, once CUBE records one.
 * @property raw - Base64 zlib-compressed pfcon response, when present.
 */
export interface PluginInstanceData {
  id: number;
  feed_id: number;
  previous_id?: number | null;
  plugin_name: string;
  plugin_type?: string;
  status?: string;
  output_path?: string;
  raw?: string;
  [key: string]: unknown;
}

/**
 * One resolved parameter value recorded on a plugin instance.
 *
 * @property param_name - The parameter's flag name.
 * @property value - The recorded invocation value.
 */
export interface InstanceParameterData {
  param_name?: string;
  value?: unknown;
}

/**
 * A CUBE file-download token, used for authenticated downloads and the LONK
 * WebSocket.
 *
 * @property token - The token string.
 * @property url - REST URL of the token resource (its origin hosts the LONK
 *   WebSocket endpoint).
 */
export interface DownloadToken {
  token: string;
  url: string;
}

/**
 * Typed handle over one plugin-instance detail resource.
 *
 * Wraps the live chrisapi resource so callers can read its payload and drive
 * its lifecycle without touching the unsafe object.
 *
 * @property data - The instance's wire payload, or null when the resource
 *   carries none (the sub-resources and lifecycle methods still work).
 */
export interface PluginInstanceHandle {
  data: PluginInstanceData | null;
  /**
   * Reads one page of the instance's effective parameter values.
   *
   * @param params - Page window (limit, offset).
   * @returns The page of recorded parameter values.
   */
  parametersPage_get(params: { limit: number; offset: number }): Promise<ListPage<InstanceParameterData>>;
  /**
   * Writes a new status to the instance (e.g. `cancelled`).
   *
   * @param status - The status string to PUT.
   */
  status_set(status: string): Promise<void>;
  /** Deletes the instance record from CUBE. */
  delete(): Promise<void>;
  /**
   * Fetches the instance's log text via its logs sub-resource.
   *
   * @returns The joined log text, or null when this instance's resource does
   *   not expose logs.
   */
  logs_get(): Promise<string | null>;
}

/** Loose wire shape of a chrisapi list response (data + optional total). */
interface WirePage {
  data?: unknown;
  totalCount?: unknown;
  getItems?: unknown;
}

/**
 * Normalizes a raw chrisapi list response into a typed ListPage.
 *
 * @param page - The raw list resource (or null/undefined).
 * @returns The typed page; totalCount is null when the server sent none.
 */
function listPage_wrap<T>(page: WirePage | null | undefined): ListPage<T> {
  const total: unknown = page?.totalCount;
  return {
    data: listData_get<T>(page ?? undefined),
    totalCount: typeof total === 'number' && total >= 0 ? total : null,
  };
}

/**
 * Reads one page of the session user's feeds (owned and shared).
 *
 * @param client - Connected chrisapi client.
 * @param params - CUBE search/pagination params (limit, offset, id, ...).
 * @returns The typed feed page.
 * @throws {Error} Propagates chrisapi/network errors.
 */
export async function feedsPage_get(
  client: Client,
  params: Record<string, unknown>,
): Promise<ListPage<FeedData>> {
  return listPage_wrap<FeedData>(await resource_call<WirePage>(client, 'getFeeds', params));
}

/**
 * Reads one page of public feeds, when the connected CUBE offers them.
 *
 * @param client - Connected chrisapi client.
 * @param params - CUBE search/pagination params.
 * @returns The typed feed page, or null when the client has no public-feeds
 *   endpoint (older CUBE versions).
 * @throws {Error} Propagates chrisapi/network errors.
 */
export async function publicFeedsPage_get(
  client: Client,
  params: Record<string, unknown>,
): Promise<ListPage<FeedData> | null> {
  if (!method_exists(client, 'getPublicFeeds')) return null;
  return listPage_wrap<FeedData>(await resource_call<WirePage>(client, 'getPublicFeeds', params));
}

/**
 * Reads one page of plugin instances, optionally filtered.
 *
 * @param client - Connected chrisapi client.
 * @param params - CUBE search/pagination params (feed_id, id, plugin_name, ...).
 * @returns The typed instance page.
 * @throws {Error} Propagates chrisapi/network errors.
 */
export async function pluginInstancesPage_get(
  client: Client,
  params: Record<string, unknown>,
): Promise<ListPage<PluginInstanceData>> {
  return listPage_wrap<PluginInstanceData>(
    await resource_call<WirePage>(client, 'getPluginInstances', params),
  );
}

/**
 * Fetches one plugin instance's detail resource as a typed handle.
 *
 * @param client - Connected chrisapi client.
 * @param instanceID - The plugin instance id.
 * @returns The typed handle, or null when CUBE returns no such instance.
 * @throws {Error} Propagates chrisapi/network errors.
 */
export async function pluginInstance_get(
  client: Client,
  instanceID: number,
): Promise<PluginInstanceHandle | null> {
  const resource: { data?: unknown } | null = await resource_call<{ data?: unknown } | null>(
    client,
    'getPluginInstance',
    instanceID,
  );
  if (!resource) return null;
  const data: PluginInstanceData | null = itemData_get<PluginInstanceData>(resource);

  return {
    data,

    async parametersPage_get(
      params: { limit: number; offset: number },
    ): Promise<ListPage<InstanceParameterData>> {
      // Some chrisapi versions serve rows in `data`, others only via getItems().
      return listPageFlexible_wrap<InstanceParameterData>(
        await resource_call<WirePage>(resource, 'getParameters', params),
      );
    },

    async status_set(status: string): Promise<void> {
      await resource_call<unknown>(resource, 'put', { status });
    },

    async delete(): Promise<void> {
      await resource_call<unknown>(resource, 'delete');
    },

    async logs_get(): Promise<string | null> {
      if (!method_exists(resource, 'getLogs')) return null;
      const logs: { data?: unknown } = await resource_call<{ data?: unknown }>(resource, 'getLogs');
      const rows: Array<{ log?: unknown }> = listData_get<{ log?: unknown }>(logs);
      return rows.map((row: { log?: unknown }): string => (typeof row.log === 'string' ? row.log : '')).join('\n');
    },
  };
}

/**
 * Wire shape of one registered pipeline source file row.
 *
 * @property fname - CFS path of the uploaded pipeline source.
 * @property pipeline_name - Name of the pipeline it registered.
 * @property pipeline_id - Id of the pipeline it registered.
 */
export interface PipelineSourceFileData {
  fname: string;
  pipeline_name?: string;
  pipeline_id?: number;
  [key: string]: unknown;
}

/**
 * Wire shape of one plugin piping row in a registered pipeline.
 *
 * @property id - Piping id.
 * @property title - Piping title, when authored.
 * @property plugin_name - Name of the plugin this piping runs.
 * @property plugin_version - Version of that plugin.
 * @property previous_id - Parent piping id, or null for the root.
 */
export interface PluginPipingData {
  id: number;
  title?: string;
  plugin_name?: string;
  plugin_version?: string;
  previous_id?: number | null;
  [key: string]: unknown;
}

/**
 * Wire shape of one stored piping default-parameter row.
 *
 * @property plugin_piping_id - Piping the default belongs to.
 * @property param_name - The parameter's flag name.
 * @property value - The stored default value.
 */
export interface PipingDefaultParameterData {
  plugin_piping_id?: number;
  param_name?: string;
  value?: unknown;
  [key: string]: unknown;
}

/**
 * Wire shape of one plugin parameter definition row.
 *
 * @property name - The parameter's flag name.
 * @property type - Declared value type (e.g. "string").
 * @property optional - Whether the parameter may be omitted.
 * @property default - Declared default value.
 * @property help - Author-provided help text.
 */
export interface PluginParameterData {
  name: string;
  type?: string;
  optional?: boolean;
  default?: unknown;
  help?: string;
  [key: string]: unknown;
}

/**
 * Wire shape of one compute-resource row attached to a plugin.
 *
 * @property name - The compute environment's name.
 */
export interface ComputeResourceData {
  name?: string;
  [key: string]: unknown;
}

/**
 * Typed handle over one plugin detail resource (metadata surfaces only).
 */
export interface PluginHandle {
  /**
   * Reads one page of the plugin's declared parameters.
   *
   * @param params - Page window (limit, offset).
   * @returns The page of parameter definitions.
   */
  parametersPage_get(params: Record<string, unknown>): Promise<ListPage<PluginParameterData>>;
  /**
   * Reads one page of the plugin's registered compute resources.
   *
   * @param params - Page window (limit, offset).
   * @returns The page of compute-resource rows.
   */
  computeResourcesPage_get(params: Record<string, unknown>): Promise<ListPage<ComputeResourceData>>;
}

/**
 * One plugin piping of a registered pipeline, with its plugin reachable.
 *
 * @property data - The piping's wire payload.
 */
export interface PluginPipingItem {
  data: PluginPipingData;
  /**
   * Fetches the plugin this piping runs, when the item links one.
   *
   * @returns The plugin handle, or null when the item exposes no plugin link.
   */
  plugin_get(): Promise<PluginHandle | null>;
}

/**
 * Typed handle over one registered pipeline resource.
 *
 * @property data - The pipeline's wire payload, or null when absent.
 */
export interface PipelineHandle {
  data: PipelineRecord | null;
  /**
   * Reads the pipeline's plugin pipings as items (plugin link preserved).
   *
   * @param params - Page window (limit, offset).
   * @returns The piping items of that page.
   */
  pluginPipings_get(params: Record<string, unknown>): Promise<PluginPipingItem[]>;
  /**
   * Reads one page of the stored piping default parameters.
   *
   * @param params - Page window (limit, offset).
   * @returns The page of stored defaults.
   */
  defaultParametersPage_get(params: Record<string, unknown>): Promise<ListPage<PipingDefaultParameterData>>;
}

/**
 * Normalizes a chrisapi list response that may serve rows in `data` or only
 * via `getItems()` into a typed ListPage.
 *
 * @param page - The raw list resource.
 * @returns The typed page; totalCount is null when the server sent none.
 */
function listPageFlexible_wrap<T>(page: WirePage | null | undefined): ListPage<T> {
  if (Array.isArray(page?.data) || typeof page?.getItems !== 'function') {
    return listPage_wrap<T>(page);
  }
  const rows: T[] = items_get<{ data?: unknown }>(page as { getItems(): unknown })
    .map((item: { data?: unknown }): T | null => itemData_get<T>(item))
    .filter((row: T | null): row is T => row !== null);
  const total: unknown = page?.totalCount;
  return { data: rows, totalCount: typeof total === 'number' && total >= 0 ? total : null };
}

/**
 * Wraps a plugin detail resource as a typed metadata handle.
 *
 * @param resource - The chrisapi plugin resource.
 * @returns The typed handle.
 */
function pluginHandle_wrap(resource: object): PluginHandle {
  return {
    async parametersPage_get(params: Record<string, unknown>): Promise<ListPage<PluginParameterData>> {
      return listPageFlexible_wrap<PluginParameterData>(
        await resource_call<WirePage>(resource, 'getPluginParameters', params),
      );
    },
    async computeResourcesPage_get(params: Record<string, unknown>): Promise<ListPage<ComputeResourceData>> {
      return listPageFlexible_wrap<ComputeResourceData>(
        await resource_call<WirePage>(resource, 'getPluginComputeResources', params),
      );
    },
  };
}

/**
 * Fetches one registered pipeline's detail resource as a typed handle.
 *
 * @param client - Connected chrisapi client.
 * @param pipelineID - The pipeline id.
 * @returns The typed handle, or null when CUBE returns no such pipeline.
 * @throws {Error} Propagates chrisapi/network errors.
 */
export async function pipeline_get(
  client: Client,
  pipelineID: number,
): Promise<PipelineHandle | null> {
  const resource: { data?: unknown } | null = await resource_call<{ data?: unknown } | null>(
    client,
    'getPipeline',
    pipelineID,
  );
  if (!resource) return null;

  return {
    data: itemData_get<PipelineRecord>(resource),

    async pluginPipings_get(params: Record<string, unknown>): Promise<PluginPipingItem[]> {
      const page: WirePage = await resource_call<WirePage>(resource, 'getPluginPipings', params);
      const rawItems: Array<{ data?: unknown }> =
        typeof page?.getItems === 'function'
          ? items_get<{ data?: unknown }>(page as { getItems(): unknown })
          : listData_get<PluginPipingData>(page).map((row: PluginPipingData): { data?: unknown } => ({ data: row }));
      return rawItems
        .map((item: { data?: unknown }): PluginPipingItem | null => {
          const data: PluginPipingData | null = itemData_get<PluginPipingData>(item);
          if (!data) return null;
          return {
            data,
            async plugin_get(): Promise<PluginHandle | null> {
              if (!method_exists(item, 'getPlugin')) return null;
              const plugin: object | null = await resource_call<object | null>(item, 'getPlugin');
              return plugin ? pluginHandle_wrap(plugin) : null;
            },
          };
        })
        .filter((item: PluginPipingItem | null): item is PluginPipingItem => item !== null);
    },

    async defaultParametersPage_get(
      params: Record<string, unknown>,
    ): Promise<ListPage<PipingDefaultParameterData>> {
      return listPageFlexible_wrap<PipingDefaultParameterData>(
        await resource_call<WirePage>(resource, 'getDefaultParameters', params),
      );
    },
  };
}

/**
 * Reads one page of registered pipeline source files.
 *
 * @param client - Connected chrisapi client.
 * @param params - CUBE search/pagination params (pipeline_id, limit, ...).
 * @returns The typed source-file page.
 * @throws {Error} Propagates chrisapi/network errors.
 */
export async function pipelineSourceFilesPage_get(
  client: Client,
  params: Record<string, unknown>,
): Promise<ListPage<PipelineSourceFileData>> {
  return listPageFlexible_wrap<PipelineSourceFileData>(
    await resource_call<WirePage>(client, 'getPipelineSourceFiles', params),
  );
}

/**
 * Creates a CUBE download token for authenticated file access and LONK.
 *
 * @param client - Connected chrisapi client.
 * @returns The token string and the token resource's REST URL.
 * @throws {Error} Propagates chrisapi/network errors.
 */
export async function downloadToken_create(client: Client): Promise<DownloadToken> {
  const resource: { data?: unknown; url?: unknown } =
    await resource_call<{ data?: unknown; url?: unknown }>(client, 'createDownloadToken');
  const data: { token?: unknown } | null = itemData_get<{ token?: unknown }>(resource);
  return {
    token: String(data?.token ?? ''),
    url: String(resource?.url ?? ''),
  };
}
