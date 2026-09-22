/**
 * @file The message of the day: what a session says to the operator who
 * has just arrived at it.
 *
 * `motd` is a kernel command, so a TTY and a browser greet with the same
 * facts; the typed model beneath the rendered text lets a surface draw
 * them its own way. The numbers are the session's own index and cost no
 * call: what it holds so far, said so while it is still warming.
 *
 * @module
 */
import { z } from 'zod';

/** The model kind an `motd` envelope carries. */
export const SESSION_MOTD_MODEL_KIND = 'session.motd' as const;

/** How far the session's index has come. */
export const motdIndexSchema = z.object({
  /** `warming` while the cold sweep runs, `current` once it has finished, `cold` before it starts. */
  state: z.enum(['cold', 'warming', 'current']),
  /** Jobs indexed so far. */
  loaded: z.number(),
  /** Jobs the server says there are; zero until reported. */
  total: z.number(),
});

/** The greeting's facts. */
export const sessionMotdSchema = z.object({
  /** Who arrived. */
  user: z.string(),
  /** Where the surface said it was, e.g. `ARGUS`; empty when it said nothing. */
  surface: z.string(),
  /** Feeds the session can see, and how they are held. */
  feeds: z.object({ total: z.number(), own: z.number(), shared: z.number(), public: z.number() }),
  /** Jobs across every visible feed, by state. */
  jobs: z.object({
    total: z.number(),
    finished: z.number(),
    errored: z.number(),
    cancelled: z.number(),
    running: z.number(),
    scheduled: z.number(),
  }),
  /** Errored over finished-plus-errored, 0..1; null when nothing has finished. */
  failureRate: z.number().nullable(),
  index: motdIndexSchema,
  /** A short fortune, the same the TTY boot shows. */
  fortune: z.string(),
});

export type MotdIndex = z.infer<typeof motdIndexSchema>;
export type SessionMotd = z.infer<typeof sessionMotdSchema>;
