/**
 * @file Unit tests for the plugin model and the manual projected from it.
 *
 * Two claims worth pinning. First, that a plugin's substance survives the
 * trip as data: the flags an operator types, whether each is required, and
 * every parameter — not the first hundred. Second, that the manual is a
 * projection of that model rather than a second scrape, so the text a
 * terminal prints cannot describe a different plugin from the one a
 * graphical surface draws.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const clientGet = jest.fn();
const stackPush = jest.fn();
const pluginFind = jest.fn();
const parametersDrain = jest.fn();

jest.unstable_mockModule('@fnndsc/cumin', () => ({
  Ok: (value: unknown) => ({ ok: true, value }),
  Err: () => ({ ok: false }),
  plugin_find: pluginFind,
  pluginParameters_drain: parametersDrain,
  errorStack: { stack_push: stackPush },
}));
jest.unstable_mockModule('../src/session/index.js', () => ({
  session: { connection: { client_get: clientGet } },
}));

const {
  pluginInfo_build,
  pluginInfoText_render,
  pluginSpecifier_parse,
} = await import('../src/builtins/res/plugin.info.js');

/** The plugin row CUBE serves for the fixture. */
const PLUGIN_ROW = {
  id: 7,
  name: 'pl-example',
  version: '1.0.0',
  type: 'fs',
  authors: 'Example Author',
  description: 'Synthetic plugin fixture.',
  documentation: 'https://example.invalid/plugin',
};

beforeEach((): void => {
  jest.clearAllMocks();
  clientGet.mockResolvedValue({});
  pluginFind.mockResolvedValue({ data: PLUGIN_ROW, handle: {} });
  parametersDrain.mockResolvedValue([]);
});

describe('pluginSpecifier_parse', () => {
  it('splits a /bin entry into the plugin it addresses', () => {
    expect(pluginSpecifier_parse('pl-dcm2niix-v1.0.0')).toEqual({
      name: 'pl-dcm2niix', version: '1.0.0', command: 'pl-dcm2niix-v1.0.0',
    });
  });

  it('accepts the full path as readily as the basename', () => {
    expect(pluginSpecifier_parse('/bin/pl-dcm2niix-v1.0.0')?.name).toBe('pl-dcm2niix');
  });

  // A plugin name may itself contain '-v'; the LAST one is the separator.
  it('splits on the last separator, not the first', () => {
    expect(pluginSpecifier_parse('pl-v-tool-v2.1')).toEqual({
      name: 'pl-v-tool', version: '2.1', command: 'pl-v-tool-v2.1',
    });
  });

  it('refuses an entry that names no version', () => {
    expect(pluginSpecifier_parse('pl-example')).toBeNull();
    expect(pluginSpecifier_parse('pl-example-v')).toBeNull();
  });
});

describe('pluginInfo_build', () => {
  it('carries the plugin whole: identity, authoring facts and parameters', async () => {
    parametersDrain.mockResolvedValue([
      { name: 'inputFile', type: 'path', optional: false, help: 'Input path' },
      { name: 'count', type: 'integer', optional: true, default: 2 },
    ]);
    const built = await pluginInfo_build({ name: 'pl-example', version: '1.0.0', command: 'pl-example-v1.0.0' });
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error('expected a model');
    expect(built.value.id).toBe(7);
    expect(built.value.type).toBe('fs');
    expect(built.value.documentation).toBe('https://example.invalid/plugin');
    expect(built.value.command).toBe('pl-example-v1.0.0');
    expect(built.value.parameters).toEqual([
      { name: 'inputFile', type: 'path', optional: false, flag: '--inputFile', help: 'Input path' },
      { name: 'count', type: 'integer', optional: true, flag: '--count', default: 2 },
    ]);
  });

  it('prefers the flag the plugin declared over one derived from the name', async () => {
    parametersDrain.mockResolvedValue([
      { name: 'inputFile', type: 'path', optional: false, flag: '-i' },
    ]);
    const built = await pluginInfo_build({ name: 'pl-example', version: '1.0.0', command: 'pl-example-v1.0.0' });
    if (!built.ok) throw new Error('expected a model');
    expect(built.value.parameters[0].flag).toBe('-i');
  });

  it('fills identity from the specifier when CUBE serves a sparse row', async () => {
    pluginFind.mockResolvedValue({ data: {}, handle: {} });
    const built = await pluginInfo_build({ name: 'pl-example', version: '1.0.0', command: 'pl-example-v1.0.0' });
    if (!built.ok) throw new Error('expected a model');
    expect(built.value.name).toBe('pl-example');
    expect(built.value.version).toBe('1.0.0');
    expect(built.value.type).toBe('ds');
    expect(built.value.description).toBeUndefined();
  });

  it('fails with a reason when there is no connection', async () => {
    clientGet.mockResolvedValue(null);
    expect(await pluginInfo_build({ name: 'pl-example', version: '1.0.0', command: 'pl-example-v1.0.0' })).toEqual({ ok: false });
    expect(stackPush).toHaveBeenCalledWith('error', 'No active ChRIS connection to read a plugin.');
  });

  it('fails with a reason when CUBE registers no such plugin', async () => {
    pluginFind.mockResolvedValue(null);
    expect(await pluginInfo_build({ name: 'pl-example', version: '9.9.9', command: 'pl-example-v9.9.9' })).toEqual({ ok: false });
    expect(stackPush).toHaveBeenCalledWith('error', 'Plugin not found on server: pl-example v9.9.9');
  });
});

describe('pluginInfoText_render', () => {
  /** The fixture model, with the given parameters. */
  function model_make(parameters: Array<Record<string, unknown>>): never {
    return {
      id: 7,
      name: 'pl-example',
      version: '1.0.0',
      type: 'fs',
      authors: 'Example Author',
      description: 'Synthetic plugin fixture.',
      documentation: 'https://example.invalid/plugin',
      command: 'pl-example-v1.0.0',
      parameters,
    } as never;
  }

  it('states the plugin and its parameters', () => {
    const text: string = pluginInfoText_render(model_make([
      { name: 'inputFile', type: 'path', optional: false, flag: '--inputFile', help: 'Input path' },
      { name: 'count', type: 'integer', optional: true, flag: '--count', default: 2 },
    ]));
    expect(text).toContain('PL-EXAMPLE (Version 1.0.0)');
    expect(text).toContain('Synthetic plugin fixture.');
    expect(text).toContain('https://example.invalid/plugin');
    expect(text).toContain('--inputFile');
    expect(text).toContain('Input path');
    // The usage line spends the required flags and one optional flag.
    expect(text).toContain('pl-example-v1.0.0 --inputFile "value"');
    expect(text).toContain('--count "value"');
  });

  // The rendering that came before drew whatever list it was handed; the
  // list itself was cut at a hundred. Nothing may re-introduce that cut.
  it('prints every parameter, past the hundredth', () => {
    const many = Array.from({ length: 150 }, (_unused: unknown, index: number) => ({
      name: `flag${index}`, type: 'string', optional: true, flag: `--flag${index}`,
    }));
    const text: string = pluginInfoText_render(model_make(many));
    expect(text).toContain('--flag0');
    expect(text).toContain('--flag149');
  });

  it('distinguishes no default from an empty one', () => {
    const text: string = pluginInfoText_render(model_make([
      { name: 'a', type: 'string', optional: true, flag: '--a' },
      { name: 'b', type: 'string', optional: true, flag: '--b', default: '' },
    ]));
    expect(text).toContain('None');
    expect(text).toContain('""');
  });

  it('renders a plugin declaring nothing without inventing a usage flag', () => {
    const text: string = pluginInfoText_render(model_make([]));
    expect(text).toContain('pl-example-v1.0.0    ');
    expect(text).not.toContain('"value"');
  });

  it('says so when the plugin declared no description or author', () => {
    const text: string = pluginInfoText_render({
      name: 'pl-bare', version: '2.0.0', type: 'ds', parameters: [],
    } as never);
    expect(text).toContain('No description provided.');
    expect(text).toContain('FNNDSC <dev@babymri.org>');
    // With no /bin command on the model, the usage line spells the entry.
    expect(text).toContain('pl-bare-v2.0.0');
  });
});
