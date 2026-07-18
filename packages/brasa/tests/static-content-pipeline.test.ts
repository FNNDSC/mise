/**
 * @file Contract tests for shallow cached Pipeline executable content in `/bin`.
 *
 * @module
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const cacheGet = jest.fn();
const clientGet = jest.fn();
const stackPush = jest.fn();
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  Ok: (value: unknown) => ({ ok: true, value }),
  Err: () => ({ ok: false }),
  errorStack: {
    stack_push: stackPush,
    checkpoint_mark: jest.fn(() => 1),
    checkpoint_drain: jest.fn(),
  },
  listCache_get: () => ({ cache_get: cacheGet }),
}));
jest.unstable_mockModule('../src/session/index.js', () => ({
  session: { connection: { client_get: clientGet } },
}));

const { staticVfs_read, staticVfs_readBinary } = await import(
  '../src/lib/vfs/providers/static_content.js'
);

beforeEach((): void => {
  jest.clearAllMocks();
  cacheGet.mockReturnValue(null);
  clientGet.mockResolvedValue(null);
});

describe('staticVfs_read Pipeline executable', () => {
  it('returns a shallow cached summary without hydrating the registered manifest', async () => {
    cacheGet.mockReturnValue({
      data: [{
        name: 'example_pipeline_id42',
        type: 'pipeline',
        size: 0,
        owner: 'system',
        date: '',
        id: 42,
        title: 'Example Pipeline',
      }],
    });
    await expect(staticVfs_read('/bin/example_pipeline_id42', '/bin')).resolves.toEqual({
      ok: true,
      value:
        'kind: pipeline\n' +
        'pipeline_id: 42\n' +
        'name: Example Pipeline\n' +
        'command: example_pipeline_id42\n' +
        'manifest: pipeline manifest example_pipeline_id42\n',
    });
    expect(clientGet).not.toHaveBeenCalled();
  });

  it('falls back to the stable Pipeline ID without fetching when /bin is not warm', async () => {
    cacheGet.mockReturnValue(null);
    await expect(staticVfs_read('/bin/example_pipeline_id42', '/bin')).resolves.toEqual({
      ok: true,
      value:
        'kind: pipeline\n' +
        'pipeline_id: 42\n' +
        'command: example_pipeline_id42\n' +
        'manifest: pipeline manifest example_pipeline_id42\n',
    });
    expect(clientGet).not.toHaveBeenCalled();
  });

  it('does not mistake a cached plugin-shaped ID suffix for a Pipeline', async () => {
    cacheGet.mockReturnValue({ data: [] });

    await expect(staticVfs_read('/bin/example_id42', '/bin')).resolves.toEqual({ ok: false });
    expect(stackPush).toHaveBeenCalledWith('error', 'Unknown /bin entry: example_id42');
  });
});

describe('staticVfs_read other entries', () => {
  it('serves builtin help and reports missing builtin help', async () => {
    await expect(staticVfs_read('/usr/bin/pipeline/', '/usr/bin')).resolves.toMatchObject({
      ok: true,
    });
    await expect(staticVfs_read('/usr/bin/not-a-builtin', '/usr/bin')).resolves.toEqual({
      ok: false,
    });
    expect(stackPush).toHaveBeenCalledWith(
      'error',
      'No help available for command: not-a-builtin',
    );
  });

  it('requires a connection before inspecting a plugin entry', async () => {
    await expect(staticVfs_read('/bin/example-v1.0.0', '/bin')).resolves.toEqual({ ok: false });
    expect(stackPush).toHaveBeenCalledWith(
      'error',
      'No active ChRIS connection to fetch plugin parameter specs',
    );
  });

  it('reports a missing registered plugin', async () => {
    const getPlugins = jest.fn(async () => ({ getItems: () => [] }));
    clientGet.mockResolvedValue({ getPlugins });

    await expect(staticVfs_read('/bin/example-v1.0.0', '/bin')).resolves.toEqual({ ok: false });
    expect(getPlugins).toHaveBeenCalledWith({ name_exact: 'example', version: '1.0.0', limit: 1 });
    expect(stackPush).toHaveBeenCalledWith('error', 'Plugin not found on server: example v1.0.0');
  });

  it('renders registered plugin details and parameters', async () => {
    const getPluginParameters = jest.fn(async () => ({
      getItems: () => [
        { data: { name: 'input', type: 'string', optional: false, help: 'Input path' } },
        { data: { name: 'count', type: 'integer', optional: true, default: 2 } },
      ],
    }));
    const plugin = {
      data: {
        id: 7,
        name: 'example',
        version: '1.0.0',
        type: 'fs',
        authors: 'Example Author',
        description: 'Synthetic plugin fixture.',
        documentation: 'https://example.invalid/plugin',
      },
      getPluginParameters,
    };
    clientGet.mockResolvedValue({
      getPlugins: jest.fn(async () => ({ getItems: () => [plugin] })),
    });

    const result = await staticVfs_read('bin/example-v1.0.0/', '/bin');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected plugin details');
    expect(result.value).toContain('EXAMPLE (Version 1.0.0)');
    expect(result.value).toContain('--input');
    expect(result.value).toContain('--count');
    expect(result.value).toContain('https://example.invalid/plugin');
    expect(getPluginParameters).toHaveBeenCalledWith({ limit: 100 });
  });

  it('reports unsupported prefixes and converts thrown errors', async () => {
    await expect(staticVfs_read('/elsewhere/file', '/elsewhere')).resolves.toEqual({ ok: false });
    expect(stackPush).toHaveBeenCalledWith('error', 'File not found: /elsewhere/file');

    clientGet.mockRejectedValue(new Error('synthetic connection failure'));
    await expect(staticVfs_read('/bin/example-v1.0.0', '/bin')).resolves.toEqual({ ok: false });
    expect(stackPush).toHaveBeenCalledWith(
      'error',
      'Static VFS read failed for prefix /bin: synthetic connection failure',
    );
  });

  it('provides matching binary success and failure results', async () => {
    const success = await staticVfs_readBinary('/usr/bin/pipeline', '/usr/bin');
    expect(success.ok).toBe(true);
    if (!success.ok) throw new Error('expected builtin help bytes');
    expect(success.value).toBeInstanceOf(Buffer);
    expect(success.value.toString('utf8')).toContain('pipeline');

    await expect(staticVfs_readBinary('/elsewhere/file', '/elsewhere')).resolves.toEqual({
      ok: false,
    });
  });
});
