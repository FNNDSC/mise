/**
 * @file One pipeline resolution per specifier per session: the memo that
 * pipeline_resolve fills and pipeline_get reads.
 *
 * The connection is mocked at the client boundary, as the pipeline tests
 * are; list responses are built on ListResource.prototype so the real
 * spine serves them, and each item carries its data and a getPluginPipings
 * so pipeline_get can be seen reaching the pipings off the kept item.
 */
jest.mock('../src/connect/chrisConnection', () => ({
  chrisConnection: { client_get: jest.fn() },
}));

import { ListResource } from '@fnndsc/chrisapi';
import { chrisConnection } from '../src/connect/chrisConnection';
import { pipeline_resolve, type PipelineRecord } from '../src/pipelines/chrisPipeline';
import { pipeline_get, type PipelineHandle } from '../src/chrisapi/contract';
import {
  pipelineMemo_count,
  pipelineRecord_recall,
  pipelineResource_recall,
  pipeline_forget,
} from '../src/pipelines/pipelineMemo';
import { errorStack } from '../src/error/errorStack';
import type { Client } from '../src/chrisapi/adapter';

const mockClientGet: jest.Mock = chrisConnection.client_get as unknown as jest.Mock;

/** A list response whose items carry their data and reach their pipings. */
function pipelineList_make(rows: Array<Record<string, unknown>>, pipings: jest.Mock): ListResource {
  const list: ListResource = Object.create(ListResource.prototype) as ListResource;
  const items: unknown[] = rows.map((row: Record<string, unknown>) => ({ data: row, getPluginPipings: pipings, getDefaultParameters: pipings }));
  Object.defineProperties(list, {
    collection: {
      value: {
        items: rows.map((row: Record<string, unknown>) => ({
          data: Object.entries(row).map(([name, value]: [string, unknown]) => ({ name, value })),
          href: `https://cube/api/v1/pipelines/${String(row.id)}/`,
          links: [],
        })),
      },
    },
    getItems: { value: (): unknown[] => items },
    totalCount: { value: rows.length },
    hasNext: { value: false },
  });
  return list;
}

/** A client whose searches and gets are counted. */
function client_make(rows: Array<Record<string, unknown>>): { client: Client; getPipelines: jest.Mock; getPipeline: jest.Mock; pipings: jest.Mock } {
  const pipings: jest.Mock = jest.fn(async () => ({ getItems: (): unknown[] => [], totalCount: 0 }));
  const getPipelines: jest.Mock = jest.fn(async (params: { name?: string; id?: number }) =>
    pipelineList_make(rows.filter((row: Record<string, unknown>) => (params.name !== undefined ? row.name === params.name : row.id === params.id)), pipings),
  );
  const getPipeline: jest.Mock = jest.fn(async (id: number) => {
    const list: ListResource = await getPipelines({ id });
    return (list.getItems() as unknown[])[0] ?? null;
  });
  const client: Client = { getPipelines, getPipeline } as unknown as Client;
  return { client, getPipelines, getPipeline, pipings };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(errorStack, 'stack_push').mockImplementation(() => undefined);
});

describe('pipeline_resolve memo', () => {
  it('searches once per name per session and answers the id and the name alike', async () => {
    const made = client_make([{ id: 7, name: 'Foo' }]);
    mockClientGet.mockResolvedValue(made.client);
    const first = await pipeline_resolve('Foo');
    const second = await pipeline_resolve('Foo');
    const byId = await pipeline_resolve('7');
    expect(first.ok && second.ok && byId.ok).toBe(true);
    expect(made.getPipelines).toHaveBeenCalledTimes(1);
    expect(made.getPipeline).not.toHaveBeenCalled();
    expect(pipelineMemo_count(made.client)).toBe(2);
    expect(pipelineRecord_recall(made.client, '7')?.name).toBe('Foo');
  });

  it('never keeps a miss', async () => {
    const made = client_make([]);
    (made.client as unknown as { getPipelineSourceFiles: jest.Mock }).getPipelineSourceFiles = jest.fn(async () => ({ getItems: (): unknown[] => [] }));
    mockClientGet.mockResolvedValue(made.client);
    expect((await pipeline_resolve('Nope')).ok).toBe(false);
    expect(pipelineMemo_count(made.client)).toBe(0);
    expect(pipelineRecord_recall(made.client, 'Nope')).toBeNull();
  });

  it('keeps memos apart by client', async () => {
    const one = client_make([{ id: 1, name: 'A' }]);
    const two = client_make([{ id: 1, name: 'A' }]);
    mockClientGet.mockResolvedValue(one.client);
    await pipeline_resolve('A');
    mockClientGet.mockResolvedValue(two.client);
    await pipeline_resolve('A');
    expect(one.getPipelines).toHaveBeenCalledTimes(1);
    expect(two.getPipelines).toHaveBeenCalledTimes(1);
  });
});

describe('pipeline_get off the kept item', () => {
  it('reaches the pipings without listing the pipeline again', async () => {
    const made = client_make([{ id: 9, name: 'Bar' }]);
    mockClientGet.mockResolvedValue(made.client);
    const resolved = await pipeline_resolve('Bar');
    expect(resolved.ok).toBe(true);
    expect(pipelineResource_recall(made.client, 9)).not.toBeNull();
    const handle: PipelineHandle | null = await pipeline_get(made.client, 9);
    expect(handle).not.toBeNull();
    await handle?.pluginPipings_get({ limit: 10 });
    expect(made.getPipeline).not.toHaveBeenCalled();
    expect(made.getPipelines).toHaveBeenCalledTimes(1);
    expect(made.pipings).toHaveBeenCalledTimes(1);
  });

  it('lists the pipeline once when nothing was kept, and keeps that', async () => {
    const made = client_make([{ id: 4, name: 'Baz' }]);
    const first: PipelineHandle | null = await pipeline_get(made.client, 4);
    const second: PipelineHandle | null = await pipeline_get(made.client, 4);
    expect(first?.data?.name).toBe('Baz');
    expect(second?.data?.name).toBe('Baz');
    expect(made.getPipeline).toHaveBeenCalledTimes(1);
  });

  it('forgets a pipeline whole: item and every specifier', async () => {
    const made = client_make([{ id: 5, name: 'Qux' }]);
    mockClientGet.mockResolvedValue(made.client);
    await pipeline_resolve('Qux');
    pipeline_forget(made.client, 5);
    expect(pipelineResource_recall(made.client, 5)).toBeNull();
    expect(pipelineRecord_recall(made.client, 'Qux')).toBeNull();
    expect(pipelineMemo_count(made.client)).toBe(0);
    const again: PipelineRecord | null = (await pipeline_resolve('Qux')).ok ? pipelineRecord_recall(made.client, '5') : null;
    expect(again?.id).toBe(5);
    expect(made.getPipelines).toHaveBeenCalledTimes(2);
  });
});
