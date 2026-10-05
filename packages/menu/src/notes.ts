/**
 * @file Release notes: what the installed releases changed, for the
 * operator (epic #897).
 *
 * `notes` is a kernel command, so a TTY and a browser read the same facts
 * from the same disk — the daemon's own installed packages — and the typed
 * model beneath the rendered text lets a surface lay them out as a listing.
 * Each change is one changeset: its first sentence the operator's headline,
 * the rest unfolding beneath; a change marked internal is ours alone and
 * hidden unless asked for.
 *
 * @module
 */
import { z } from 'zod';

/** The model kind a `notes` envelope carries. */
export const SESSION_NOTES_MODEL_KIND = 'session.notes' as const;

/** One changeset, as the operator reads it. */
export const notesChangeSchema = z.object({
  /** The package the change belongs to, short (`argus`, `brasa`). */
  package: z.string(),
  /** The first sentence of the changeset. */
  headline: z.string(),
  /** The rest of the changeset's prose; empty when the headline was all of it. */
  body: z.string(),
  /** Written "Internal: …": ours alone, hidden by default. */
  internal: z.boolean(),
});

/** One package's part in a release. */
export const notesEntrySchema = z.object({
  /** Short package name. */
  package: z.string(),
  version: z.string(),
  bump: z.enum(['major', 'minor', 'patch']),
  changes: z.array(notesChangeSchema),
});

/** One release: every package one Version Packages merge published. */
export const notesReleaseSchema = z.object({
  /** ISO date (YYYY-MM-DD), or null when the build had no history to date it. */
  date: z.string().nullable(),
  /** The merge commit that released it (short hash), or null without history. */
  merge: z.string().nullable(),
  entries: z.array(notesEntrySchema),
});

/** What `notes` answers. */
export const sessionNotesSchema = z.object({
  /** Where the notes were read: the daemon's disk. */
  source: z.literal('daemon'),
  /** The versions installed where the kernel runs, by short package name. */
  installed: z.record(z.string(), z.string()),
  /** The releases shown, newest first. */
  releases: z.array(notesReleaseSchema),
  /** How many releases there are in all, shown or not. */
  total: z.number(),
  /** Whether internal changes were included. */
  all: z.boolean(),
});

export type NotesChange = z.infer<typeof notesChangeSchema>;
export type NotesEntry = z.infer<typeof notesEntrySchema>;
export type NotesRelease = z.infer<typeof notesReleaseSchema>;
export type SessionNotes = z.infer<typeof sessionNotesSchema>;
