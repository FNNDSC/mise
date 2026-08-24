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
 * Dependencies: only `adapter.ts`. This file must contain no `as unknown as`
 * and no `@fnndsc/chrisapi` import; the cast ratchet and the seam lint enforce
 * that shape.
 *
 * @module
 */

import {
  Client,
  itemData_get,
  listData_get,
  method_exists,
  resource_call,
} from './adapter';

/**
 * One normalized page of a paginated CUBE list.
 *
 * @property data - The rows of this page, in server order.
 * @property totalCount - The collection's total row count when the server
 *   reported one, otherwise null. A null total means "unknown", not zero.
 */
export interface ListPage<T> {
  data: T[];
  totalCount: number | null;
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
      const page: WirePage = await resource_call<WirePage>(resource, 'getParameters', params);
      // Some chrisapi versions serve rows in `data`, others only via getItems().
      if (Array.isArray(page?.data) || typeof page?.getItems !== 'function') {
        return listPage_wrap<InstanceParameterData>(page);
      }
      const itemsSource: { getItems(): unknown } = page as { getItems(): unknown };
      const items: unknown = itemsSource.getItems();
      const rows: InstanceParameterData[] = Array.isArray(items)
        ? items.map((item: unknown): InstanceParameterData =>
            itemData_get<InstanceParameterData>(item as { data?: unknown }) ?? {})
        : [];
      const total: unknown = page?.totalCount;
      return { data: rows, totalCount: typeof total === 'number' && total >= 0 ? total : null };
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
