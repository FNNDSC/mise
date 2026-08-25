/**
 * @file Typed envelope models: the kind map behind the typed chell API.
 *
 * The envelope's model slot has always been discriminated but untyped
 * (`{ kind: string, data: unknown }`); this module is where the kinds gain
 * compile-time payload types. `FsModelMap` maps each `kind` a filesystem
 * command emits to the payload its core actually builds, and
 * `TypedEnvelope<K>` narrows a `CommandEnvelope` accordingly, so typed-API
 * callers read `envelope.model.data` without a cast.
 *
 * The map grows with the facade: commands join it as their cores join the
 * typed API (see docs/typed-chell-api.adoc). When models later cross the
 * wire, calypso validates exactly the kinds in this map at its boundary.
 *
 * @module
 */
import type { CommandEnvelope } from '@fnndsc/cumin';
import type { MkdirOutcome } from '../builtins/fs/mkdir.js';
import type { TouchOutcome } from '../builtins/fs/touch.js';
import type { RmOutcome } from '../builtins/fs/rm.js';

/**
 * The payload the `fs.cwd` kind carries.
 *
 * @property path - The current working directory.
 * @property shown - The display form (titles substituted), when produced.
 */
export interface CwdModel {
  path: string;
  shown?: string;
}

/**
 * Model kinds emitted by the filesystem commands, mapped to their payloads.
 */
export interface FsModelMap {
  'fs.cwd': CwdModel;
  'fs.mkdir': MkdirOutcome[];
  'fs.touch': TouchOutcome[];
  'fs.rm': RmOutcome[];
}

/** Every kind the typed API currently maps. */
export type ModelKind = keyof FsModelMap;

/**
 * A command envelope whose model slot is narrowed to one known kind.
 *
 * Structurally a plain `CommandEnvelope` (the wire and the REPL see no
 * difference); the narrowing is purely compile-time.
 */
export interface TypedEnvelope<K extends ModelKind> extends CommandEnvelope {
  model?: { kind: K; data: FsModelMap[K] };
}

/**
 * Narrows a core's envelope to its declared kind.
 *
 * The single trusted assertion of the typed API: each command core is the
 * sole producer of its kind, so the envelope it returns carries that kind's
 * payload by construction. Centralized here so the facade methods stay
 * cast-free.
 *
 * @param envelope - The envelope a command core returned.
 * @returns The same envelope, typed by its kind.
 */
export function envelope_typed<K extends ModelKind>(envelope: CommandEnvelope): TypedEnvelope<K> {
  return envelope as TypedEnvelope<K>;
}
