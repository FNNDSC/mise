/**
 * @file The plugin vocabulary: a registered plugin as a typed envelope payload.
 *
 * A plugin is the one-node case of the compute graph — everything a pipeline
 * node is, without the pipeline around it. Its substance reached surfaces as
 * a rendered manual for as long as `cat /bin/<plugin>` was the only way to
 * ask, which meant nothing downstream could do anything with it: not a card,
 * not a parameter list, not a form, not an export. This model is that same
 * substance as data; the manual becomes one projection of it.
 *
 * Parameters are the payload that matters. They arrive complete or the model
 * is wrong: a parameter list that quietly stops at a page boundary is worse
 * than the paragraph it replaces, because a paragraph does not look
 * authoritative.
 *
 * @module
 */
import { z } from 'zod';

/**
 * One declared parameter of a plugin.
 *
 * `default` is `unknown` because CUBE serves whatever the plugin declared —
 * a string, a number, a boolean, or null for "no default" — and a surface
 * renders it rather than computing on it.
 */
export const pluginParameterSchema = z.object({
  name: z.string(),
  type: z.string(),
  optional: z.boolean(),
  default: z.unknown().optional(),
  help: z.string().optional(),
  /** The flag as it is typed: `--name`, or the bare name for a positional. */
  flag: z.string(),
});

/**
 * The `plugin.info` model: one registered plugin, whole.
 *
 * Identity, the authoring facts, and every declared parameter. What a
 * surface draws from it — a one-node graph, a parameter table, an argument
 * form — is the surface's business; the model carries no layout and no
 * rendering.
 */
export const pluginInfoModelSchema = z.object({
  id: z.number().optional(),
  name: z.string(),
  version: z.string(),
  /** `ds`, `fs`, or `ts` — what the node consumes and produces. */
  type: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  authors: z.string().optional(),
  /** Where the plugin's source or docs live, when it declared them. */
  documentation: z.string().optional(),
  category: z.string().optional(),
  /**
   * Every declared parameter, in the order CUBE serves them.
   *
   * Complete, always: the builder drains the collection rather than asking
   * for a page and calling it the answer.
   */
  parameters: z.array(pluginParameterSchema),
  /** The `/bin` entry that runs it, so a surface can lower a click to a command. */
  command: z.string().optional(),
});

export type PluginParameter = z.infer<typeof pluginParameterSchema>;
export type PluginInfoModel = z.infer<typeof pluginInfoModelSchema>;

/** The model's envelope kind. */
export const PLUGIN_INFO_MODEL_KIND = 'plugin.info' as const;
