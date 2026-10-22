/**
 * @file The substrate's models: what a stratus session's `domain status`
 * and `capacity` answer beneath their rendered text, so a surface lays
 * them out (docs/stratus.adoc, D11: the DOMAINS and CAPACITY tiles).
 *
 * @module
 */
import { z } from 'zod';

/** The model kind `domain status` carries. */
export const STRATUS_DOMAINS_MODEL_KIND = 'stratus.domains' as const;

/** One build step, where it stands. */
export const domainStepSchema = z.object({
  /** Its folder, numbered in build order (`05-infra-apply`). */
  folder: z.string(),
  /** `done`, `not done`, `expired`, or `unknown`. */
  state: z.string(),
});

/** One Trusted Domain. */
export const domainSummarySchema = z.object({
  name: z.string(),
  /** Its folder in the session (`/net/oci/fnndsc/domains/harbor`). */
  path: z.string(),
  /** The cluster's DNS name, or null when its settings do not say. */
  cluster: z.string().nullable(),
  /** The last step done, or null when none is. */
  lastDone: z.string().nullable(),
  steps: z.array(domainStepSchema),
  /** Its compartment's live resources by kind, or null when not counted. */
  resources: z.record(z.string(), z.number()).nullable(),
  /** What it costs at list price, an hour and so far, or null when not priced; absent from an older daemon. */
  cost: z.object({ hourly: z.number(), soFar: z.number(), currency: z.string() }).nullable().optional(),
});

/** What `domain status` answers. */
export const domainsModelSchema = z.object({
  domains: z.array(domainSummarySchema),
});

/** The model kind `capacity` carries. */
export const STRATUS_CAPACITY_MODEL_KIND = 'stratus.capacity' as const;

/** One limit a shape draws on, in one place. */
export const capacityRowSchema = z.object({
  /** The shape family (`E5`). */
  family: z.string(),
  /** The limit (`standard-e5-core-count`). */
  limit: z.string(),
  /** The zone it applies in, or null for a region-wide limit. */
  zone: z.string().nullable(),
  /** What the limit permits. */
  value: z.number(),
  /** How much is spent and left; null when the cloud does not say. */
  used: z.number().nullable(),
  available: z.number().nullable(),
});

/** What `capacity` answers. */
export const capacityModelSchema = z.object({
  region: z.string(),
  rows: z.array(capacityRowSchema),
});

export type DomainStep = z.infer<typeof domainStepSchema>;
export type DomainSummary = z.infer<typeof domainSummarySchema>;
export type DomainsModel = z.infer<typeof domainsModelSchema>;
export type CapacityRow = z.infer<typeof capacityRowSchema>;
export type CapacityModel = z.infer<typeof capacityModelSchema>;
