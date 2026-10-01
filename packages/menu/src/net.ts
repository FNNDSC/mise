/**
 * @file The wire's own readout: what the kernel has asked of CUBE.
 *
 * `netstat` answers with this model beside its table, so a surface or a
 * test reads the count rather than the rendering.
 */
import { z } from 'zod';

/** One request the kernel made. */
export const netRequestSchema = z.object({
  /** Milliseconds since the count began. */
  at: z.number(),
  method: z.string(),
  /** The endpoint family: `filebrowser/search`, `filebrowser/:id/children`, `plugins`, … */
  family: z.string(),
  path: z.string(),
  /** The response status; 0 for a request that failed before one. */
  status: z.number(),
  ms: z.number(),
});

/** A family's tally. */
export const netFamilySchema = z.object({ family: z.string(), count: z.number(), ms: z.number() });

export const netStatsModelSchema = z.object({
  /** When the count began (ISO 8601): the session, or the last reset. */
  since: z.string(),
  total: z.number(),
  ms: z.number(),
  families: z.array(netFamilySchema),
  last: z.array(netRequestSchema),
});
export type NetStatsModel = z.infer<typeof netStatsModelSchema>;
export const NET_STATS_MODEL_KIND = 'net.stats' as const;
