/**
 * @file Schema tests for the plugin vocabulary.
 *
 * A plugin model is what a surface builds a parameter list — and later a
 * form — from, so the shape that matters is the parameter: a flag as typed,
 * whether it is required, and a default that can be absent, empty, or false
 * without any of those collapsing into each other.
 */
import { describe, it, expect } from '@jest/globals';
import {
  pluginInfoModelSchema,
  pluginParameterSchema,
  PLUGIN_INFO_MODEL_KIND,
  type PluginInfoModel,
} from '../src/plugin.js';

/** A minimal well-formed model. */
function model_make(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'pl-example',
    version: '1.0.0',
    type: 'fs',
    parameters: [],
    ...extra,
  };
}

describe('pluginParameterSchema', () => {
  it('carries the flag as typed alongside the parameter name', () => {
    const parsed = pluginParameterSchema.safeParse({
      name: 'inputFile', type: 'path', optional: false, flag: '-i', help: 'Input path',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.flag).toBe('-i');
  });

  it('refuses a parameter that does not say whether it is required', () => {
    expect(pluginParameterSchema.safeParse({
      name: 'inputFile', type: 'path', flag: '--inputFile',
    }).success).toBe(false);
  });

  it('keeps a default of any declared shape, including false and the empty string', () => {
    for (const value of ['', false, 0, null, 'x']) {
      const parsed = pluginParameterSchema.safeParse({
        name: 'a', type: 'string', optional: true, flag: '--a', default: value,
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.default).toBe(value);
    }
  });

  // Absent and null are different answers: no default at all, versus a
  // default that IS null. A surface renders them differently.
  it('distinguishes no default from a null one', () => {
    const absent = pluginParameterSchema.parse({ name: 'a', type: 'string', optional: true, flag: '--a' });
    const explicit = pluginParameterSchema.parse({ name: 'a', type: 'string', optional: true, flag: '--a', default: null });
    expect('default' in absent).toBe(false);
    expect(explicit.default).toBeNull();
  });
});

describe('pluginInfoModelSchema', () => {
  it('accepts a plugin with only its identity and no parameters', () => {
    const parsed = pluginInfoModelSchema.safeParse(model_make());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const model: PluginInfoModel = parsed.data;
      expect(model.parameters).toEqual([]);
      expect(model.description).toBeUndefined();
    }
  });

  it('carries every parameter it is given, past any page boundary', () => {
    const many = Array.from({ length: 237 }, (_unused: unknown, index: number) => ({
      name: `flag${index}`, type: 'string', optional: true, flag: `--flag${index}`,
    }));
    const model: PluginInfoModel = pluginInfoModelSchema.parse(model_make({ parameters: many }));
    expect(model.parameters).toHaveLength(237);
    expect(model.parameters[236].name).toBe('flag236');
  });

  it('refuses a model missing the identity a surface addresses it by', () => {
    expect(pluginInfoModelSchema.safeParse({ name: 'pl-example', parameters: [] }).success).toBe(false);
    expect(pluginInfoModelSchema.safeParse({ version: '1.0.0', type: 'fs', parameters: [] }).success).toBe(false);
  });

  it('refuses a model whose parameter list is malformed rather than dropping it', () => {
    expect(pluginInfoModelSchema.safeParse(model_make({
      parameters: [{ name: 'a' }],
    })).success).toBe(false);
  });

  it('names its envelope kind', () => {
    expect(PLUGIN_INFO_MODEL_KIND).toBe('plugin.info');
  });
});
