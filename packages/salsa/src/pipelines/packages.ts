/**
 * @file The pipeline package store: durable pre-cache of registered pipelines.
 *
 * A registered pipeline is immutable, so what CUBE knows about it — identity
 * fields and the complete registered manifest — is fetched once, held in
 * memory, and checkpointed to a local file keyed by the CUBE URL. The sweep
 * runs as a warm-up tail after the topology index settles: it lists the
 * registry and fetches only pipelines the store has never seen, so the
 * steady-state cost is zero and a fresh daemon restores everything without
 * a wire call. The `/usr/share/packages/<pipeline>` VFS tree and the diagram
 * builder both read from here.
 *
 * @module
 */
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import {
  chrisConnection,
  pipelines_list,
  pipeline_get,
  type PipelineHandle,
  type PipelineRecord,
  type Result,
} from '@fnndsc/cumin';
import type { SingleContext } from '@fnndsc/cumin';
import { pipelineManifestForPipeline_get, type PipelineManifest } from './manifest.js';
import { context_getSingle } from '../context/index.js';

/** One durably cached registered pipeline: identity plus manifest. */
export interface PipelinePackage {
  id: number;
  name: string;
  slug?: string;
  authors?: string;
  category?: string;
  description?: string;
  locked?: boolean;
  manifest: PipelineManifest;
}

/** Bumped when the persisted shape changes; older files are ignored. */
const PACKAGES_SCHEMA: number = 1;

/** The in-memory store, keyed by pipeline id. */
const packages: Map<number, PipelinePackage> = new Map();

/** The CUBE key the store was restored for; a different CUBE resets it. */
let restoredKey: string | null = null;

/** Returns the default directory for persistent pipeline-package files. */
function packagesRoot_get(): string {
  const cacheHome: string = process.env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache');
  return join(cacheHome, 'chell', 'pipelines');
}

/**
 * Builds the CUBE-keyed store path without exposing the URL.
 *
 * @param cubeUrl - The CUBE API URL the registry belongs to.
 * @param root - Store directory override (tests).
 * @returns Versioned store file path.
 */
export function pipelinePackagesPath_get(cubeUrl: string, root: string = packagesRoot_get()): string {
  const key: string = createHash('sha256').update(cubeUrl).digest('hex').slice(0, 16);
  return join(root, `packages-${key}-v${PACKAGES_SCHEMA}.json`);
}

/** Resolves the current CUBE's store key, or null when disconnected. */
async function storeKey_get(): Promise<string | null> {
  try {
    const context: SingleContext = await context_getSingle();
    return context.URL ?? null;
  } catch {
    return null;
  }
}

/** Structurally validates one persisted package entry. */
function package_check(value: unknown): value is PipelinePackage {
  if (!value || typeof value !== 'object') return false;
  const entry: Partial<PipelinePackage> = value as Partial<PipelinePackage>;
  return typeof entry.id === 'number' &&
    typeof entry.name === 'string' &&
    typeof entry.manifest === 'object' && entry.manifest !== null &&
    Array.isArray((entry.manifest as PipelineManifest).nodes) &&
    Array.isArray((entry.manifest as PipelineManifest).rootIDs);
}

/**
 * Restores the store from its durable file for the current CUBE, once per
 * key. Missing or invalid files leave the store empty — the sweep refills.
 *
 * @param root - Store directory override (tests).
 */
export async function pipelinePackages_restore(root: string = packagesRoot_get()): Promise<void> {
  const key: string | null = await storeKey_get();
  if (key === null || key === restoredKey) return;
  restoredKey = key;
  packages.clear();
  try {
    const raw: string = await fs.readFile(pipelinePackagesPath_get(key, root), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const entries: unknown = (parsed as { packages?: unknown }).packages;
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (package_check(entry)) packages.set(entry.id, entry);
    }
  } catch {
    // No file yet, or an unreadable one: the sweep rebuilds it.
  }
}

/**
 * Writes the store durably, atomically, keyed by the current CUBE.
 *
 * @param key - The CUBE URL key.
 * @param root - Store directory override (tests).
 */
async function packages_save(key: string, root: string = packagesRoot_get()): Promise<void> {
  const path: string = pipelinePackagesPath_get(key, root);
  const temporaryPath: string = `${path}.${process.pid}.tmp`;
  const file: { schema: number; savedAt: string; packages: PipelinePackage[] } = {
    schema: PACKAGES_SCHEMA,
    savedAt: new Date().toISOString(),
    packages: Array.from(packages.values()),
  };
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await fs.writeFile(temporaryPath, `${JSON.stringify(file)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporaryPath, path);
}

/**
 * The warm-up tail: lists the registry and fetches manifests only for
 * pipelines the store has never seen, then saves. Sequential awaits are the
 * throttle; per-pipeline failures are skipped and retried next sweep.
 *
 * @param root - Store directory override (tests).
 */
export async function pipelinePackages_sweep(root: string = packagesRoot_get()): Promise<void> {
  const key: string | null = await storeKey_get();
  if (key === null) return;
  await pipelinePackages_restore(root);

  const listed: Result<PipelineRecord[]> = await pipelines_list();
  if (!listed.ok) return;
  const client = await chrisConnection.client_get();
  if (!client) return;

  let added: boolean = false;
  for (const record of listed.value) {
    if (packages.has(record.id)) continue;
    const handle: PipelineHandle | null = await pipeline_get(client, record.id);
    if (!handle) continue;
    const manifest: Result<PipelineManifest> = await pipelineManifestForPipeline_get(
      record, handle, { detail: 'registered' },
    );
    if (!manifest.ok) continue;
    packages.set(record.id, {
      id: record.id,
      name: record.name,
      ...(typeof record.slug === 'string' ? { slug: record.slug } : {}),
      ...(typeof record.authors === 'string' ? { authors: record.authors } : {}),
      ...(typeof record.category === 'string' ? { category: record.category } : {}),
      ...(typeof record.description === 'string' ? { description: record.description } : {}),
      ...(typeof record.locked === 'boolean' ? { locked: record.locked } : {}),
      manifest: manifest.value,
    });
    added = true;
  }
  if (added) await packages_save(key, root);
}

/** @returns Every cached package, sorted by name. */
export function pipelinePackages_all(): PipelinePackage[] {
  return Array.from(packages.values()).sort(
    (a: PipelinePackage, b: PipelinePackage) => a.name.localeCompare(b.name),
  );
}

/**
 * Finds one cached package by id, exact name, or slug.
 *
 * @param specifier - Pipeline id (digits), name, or slug.
 * @returns The package, or null when the store holds no match.
 */
export function pipelinePackage_find(specifier: string): PipelinePackage | null {
  const trimmed: string = specifier.trim();
  if (/^\d+$/.test(trimmed)) {
    return packages.get(parseInt(trimmed, 10)) ?? null;
  }
  for (const entry of packages.values()) {
    if (entry.name === trimmed || entry.slug === trimmed) return entry;
  }
  return null;
}
