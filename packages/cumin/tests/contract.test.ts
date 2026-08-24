/**
 * @file Unit tests for the typed chrisapi wire contract (contract.ts).
 *
 * The contract is exercised against plain fake client/resource objects: the
 * adapter generics it builds on only require structural shapes, so no
 * chrisapi mocking is involved.
 */

import {
  feedsPage_get,
  publicFeedsPage_get,
  pluginInstancesPage_get,
  pluginInstance_get,
  downloadToken_create,
  ListPage,
  FeedData,
  PluginInstanceData,
  InstanceParameterData,
  DownloadToken,
  PluginInstanceHandle,
} from '../src/chrisapi/contract';
import type { Client } from '../src/chrisapi/adapter';

/** Builds a fake client exposing the given methods. */
function client_fake(methods: Record<string, unknown>): Client {
  return methods as unknown as Client;
}

describe('page reads', () => {
  test('feedsPage_get wraps data and totalCount', async () => {
    const client: Client = client_fake({
      getFeeds: async (params: Record<string, unknown>) => ({
        data: [{ id: 7, name: 'brainy' }],
        totalCount: 42,
        received: params,
      }),
    });
    const page: ListPage<FeedData> = await feedsPage_get(client, { limit: 10, offset: 0 });
    expect(page.data).toEqual([{ id: 7, name: 'brainy' }]);
    expect(page.totalCount).toBe(42);
  });

  test('feedsPage_get normalizes missing data and totalCount', async () => {
    const client: Client = client_fake({ getFeeds: async () => ({ data: null }) });
    const page: ListPage<FeedData> = await feedsPage_get(client, {});
    expect(page.data).toEqual([]);
    expect(page.totalCount).toBeNull();
  });

  test('publicFeedsPage_get returns null when the endpoint is absent', async () => {
    const client: Client = client_fake({ getFeeds: async () => ({ data: [] }) });
    expect(await publicFeedsPage_get(client, {})).toBeNull();
  });

  test('publicFeedsPage_get pages when the endpoint exists', async () => {
    const client: Client = client_fake({
      getPublicFeeds: async () => ({ data: [{ id: 1, name: 'pub' }], totalCount: 1 }),
    });
    const page: ListPage<FeedData> | null = await publicFeedsPage_get(client, {});
    expect(page?.data[0]?.name).toBe('pub');
  });

  test('pluginInstancesPage_get forwards search params', async () => {
    let seen: Record<string, unknown> | null = null;
    const client: Client = client_fake({
      getPluginInstances: async (params: Record<string, unknown>) => {
        seen = params;
        return { data: [{ id: 3, feed_id: 9, plugin_name: 'pl-dircopy' }], totalCount: 1 };
      },
    });
    const page: ListPage<PluginInstanceData> = await pluginInstancesPage_get(client, { feed_id: 9 });
    expect(seen).toEqual({ feed_id: 9 });
    expect(page.data[0]?.plugin_name).toBe('pl-dircopy');
  });
});

describe('pluginInstance_get', () => {
  /** Builds a fake instance resource with the given payload and methods. */
  function resource_fake(
    data: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return { data, ...extra };
  }

  test('returns null when the client yields no resource', async () => {
    const client: Client = client_fake({ getPluginInstance: async () => null });
    expect(await pluginInstance_get(client, 5)).toBeNull();
  });

  test('exposes the wire payload as data', async () => {
    const client: Client = client_fake({
      getPluginInstance: async () =>
        resource_fake({ id: 5, feed_id: 2, plugin_name: 'pl-x', status: 'started' }),
    });
    const handle: PluginInstanceHandle | null = await pluginInstance_get(client, 5);
    expect(handle?.data?.status).toBe('started');
    expect(handle?.data?.feed_id).toBe(2);
  });

  test('tolerates a resource without a payload (sub-resources still usable)', async () => {
    const client: Client = client_fake({
      getPluginInstance: async () => ({
        getParameters: async () => ({ data: [{ param_name: 'p', value: 1 }], totalCount: 1 }),
      }),
    });
    const handle: PluginInstanceHandle | null = await pluginInstance_get(client, 5);
    expect(handle).not.toBeNull();
    expect(handle?.data).toBeNull();
    const page: ListPage<InstanceParameterData> | undefined =
      await handle?.parametersPage_get({ limit: 10, offset: 0 });
    expect(page?.data).toEqual([{ param_name: 'p', value: 1 }]);
  });

  test('status_set PUTs the new status to the resource', async () => {
    const put = jest.fn(async () => ({}));
    const client: Client = client_fake({
      getPluginInstance: async () => resource_fake({ id: 5, feed_id: 2, plugin_name: 'pl-x' }, { put }),
    });
    const handle: PluginInstanceHandle | null = await pluginInstance_get(client, 5);
    await handle?.status_set('cancelled');
    expect(put).toHaveBeenCalledWith({ status: 'cancelled' });
  });

  test('delete forwards to the resource', async () => {
    const del = jest.fn(async () => undefined);
    const client: Client = client_fake({
      getPluginInstance: async () =>
        resource_fake({ id: 5, feed_id: 2, plugin_name: 'pl-x' }, { delete: del }),
    });
    const handle: PluginInstanceHandle | null = await pluginInstance_get(client, 5);
    await handle?.delete();
    expect(del).toHaveBeenCalled();
  });

  test('logs_get joins log rows and returns null without a logs endpoint', async () => {
    const withLogs: Client = client_fake({
      getPluginInstance: async () =>
        resource_fake({ id: 5, feed_id: 2, plugin_name: 'pl-x' }, {
          getLogs: async () => ({ data: [{ log: 'line one' }, { log: 'line two' }] }),
        }),
    });
    const handleWith: PluginInstanceHandle | null = await pluginInstance_get(withLogs, 5);
    expect(await handleWith?.logs_get()).toBe('line one\nline two');

    const withoutLogs: Client = client_fake({
      getPluginInstance: async () => resource_fake({ id: 5, feed_id: 2, plugin_name: 'pl-x' }),
    });
    const handleWithout: PluginInstanceHandle | null = await pluginInstance_get(withoutLogs, 5);
    expect(await handleWithout?.logs_get()).toBeNull();
  });

  test('parametersPage_get reads data-style pages', async () => {
    const client: Client = client_fake({
      getPluginInstance: async () =>
        resource_fake({ id: 5, feed_id: 2, plugin_name: 'pl-x' }, {
          getParameters: async () => ({
            data: [{ param_name: 'dir', value: '/in' }],
            totalCount: 1,
          }),
        }),
    });
    const handle: PluginInstanceHandle | null = await pluginInstance_get(client, 5);
    const page: ListPage<InstanceParameterData> | undefined =
      await handle?.parametersPage_get({ limit: 10, offset: 0 });
    expect(page?.data).toEqual([{ param_name: 'dir', value: '/in' }]);
    expect(page?.totalCount).toBe(1);
  });

  test('parametersPage_get falls back to getItems-style pages', async () => {
    const client: Client = client_fake({
      getPluginInstance: async () =>
        resource_fake({ id: 5, feed_id: 2, plugin_name: 'pl-x' }, {
          getParameters: async () => ({
            getItems: () => [{ data: { param_name: 'thresh', value: 3 } }],
            totalCount: 1,
          }),
        }),
    });
    const handle: PluginInstanceHandle | null = await pluginInstance_get(client, 5);
    const page: ListPage<InstanceParameterData> | undefined =
      await handle?.parametersPage_get({ limit: 10, offset: 0 });
    expect(page?.data).toEqual([{ param_name: 'thresh', value: 3 }]);
  });
});

describe('downloadToken_create', () => {
  test('extracts token and url from the resource', async () => {
    const client: Client = client_fake({
      createDownloadToken: async () => ({
        data: { token: 'tok-123' },
        url: 'https://cube/api/v1/downloadtokens/9/',
      }),
    });
    const token: DownloadToken = await downloadToken_create(client);
    expect(token).toEqual({ token: 'tok-123', url: 'https://cube/api/v1/downloadtokens/9/' });
  });

  test('degrades to empty strings on a malformed resource', async () => {
    const client: Client = client_fake({ createDownloadToken: async () => ({}) });
    const token: DownloadToken = await downloadToken_create(client);
    expect(token).toEqual({ token: '', url: '' });
  });
});
