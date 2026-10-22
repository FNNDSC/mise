/**
 * @file A domain's own state, kept on the daemon's host (docs/stratus.adoc,
 * D4): `$XDG_STATE_HOME/stratus/domains/<name>/` holds `spec.yaml`,
 * `state.json` (the ids the build recorded and each step's history, written
 * whole, mode 600) and `auth/` (the secrets the build fetched, mode 600,
 * never served). The tree's `domains/<name>/` is a view of that folder.
 *
 * @module
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { specYaml_parse, specYaml_render, type DomainSpec } from './spec.js';

/** Where a step stands in a domain this session builds. */
export type BuiltStepState = 'not done' | 'running' | 'done' | 'failed';

/** One step's history. */
export interface StepRecord {
  state: BuiltStepState;
  started?: string;
  ended?: string;
  /** What it rests on, or why it failed, in a line. */
  note?: string;
}

/**
 * What `state.json` holds.
 *
 * @property name - The domain's name, its cluster's name and a DNS label.
 * @property created - When `domain new` wrote it.
 * @property region - The region it is built in.
 * @property baseDomain - The DNS zone its cluster's names live under.
 * @property steps - Each step's history, by name.
 * @property ids - What the build recorded for later steps (the installer's ids, the stack's, the ISO object).
 * @property billingAccepted - When the operator answered yes to the cost of the first billing step.
 * @property compartmentId - The compartment its resources live in, when known.
 * @property adopted - Where it was adopted from, and when: built elsewhere, never built on here.
 * @property gone - When its teardown removed what it built.
 */
export interface DomainRecord {
  name: string;
  created: string;
  region: string;
  baseDomain: string;
  steps: Record<string, StepRecord>;
  ids: Record<string, string>;
  billingAccepted?: string;
  compartmentId?: string;
  adopted?: { from: string; at: string };
  gone?: string;
}

/**
 * The folder a daemon keeps its domains in.
 *
 * @param env - The environment.
 * @returns `$XDG_STATE_HOME/stratus/domains`, or `~/.local/state/stratus/domains`.
 */
export function domainsRoot_of(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env['XDG_STATE_HOME'] || path.join(os.homedir(), '.local', 'state'), 'stratus', 'domains');
}

/** A domain name is a DNS label: lower-case letters, digits and hyphens, at most 54. */
export const DOMAIN_NAME: RegExp = /^[a-z]([a-z0-9-]{0,52}[a-z0-9])?$/;

/**
 * Writes a file whole or not at all, readable by its owner only.
 *
 * @param file - Where.
 * @param text - What.
 */
function file_writeAtomic(file: string, text: string): void {
  const temporary: string = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

/** The domains this daemon builds, on its host. */
export class DomainStore {
  /**
   * @param root - The folder the domains live in.
   */
  constructor(readonly root: string) {}

  /**
   * A domain's folder.
   *
   * @param name - The domain.
   * @returns Its folder.
   */
  folder_of(name: string): string {
    return path.join(this.root, name);
  }

  /** The names of the domains kept, sorted. */
  names_list(): string[] {
    if (!fs.existsSync(this.root)) return [];
    return fs.readdirSync(this.root).filter((name: string): boolean => fs.existsSync(path.join(this.root, name, 'state.json'))).sort();
  }

  /**
   * Makes a domain.
   *
   * @param record - Its first state.
   * @param spec - Its spec.
   * @throws Error - When one of that name is already kept.
   */
  create(record: DomainRecord, spec: DomainSpec): void {
    const folder: string = this.folder_of(record.name);
    if (fs.existsSync(path.join(folder, 'state.json'))) throw new Error(`${record.name}: a domain of that name is already kept (${folder})`);
    fs.mkdirSync(path.join(folder, 'auth'), { recursive: true, mode: 0o700 });
    file_writeAtomic(path.join(folder, 'spec.yaml'), specYaml_render(spec));
    this.record_write(record);
  }

  /**
   * A domain's state.
   *
   * @param name - The domain.
   * @returns Its record, or null when none is kept.
   */
  record_read(name: string): DomainRecord | null {
    const file: string = path.join(this.folder_of(name), 'state.json');
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as DomainRecord;
  }

  /**
   * Saves a domain's state.
   *
   * @param record - Its record.
   */
  record_write(record: DomainRecord): void {
    file_writeAtomic(path.join(this.folder_of(record.name), 'state.json'), `${JSON.stringify(record, null, 2)}\n`);
  }

  /**
   * Changes a domain's state and saves it.
   *
   * @param name - The domain.
   * @param change - What to change.
   * @returns The record as saved.
   * @throws Error - When none is kept.
   */
  record_update(name: string, change: (record: DomainRecord) => void): DomainRecord {
    const record: DomainRecord | null = this.record_read(name);
    if (record === null) throw new Error(`${name}: no such domain`);
    change(record);
    this.record_write(record);
    return record;
  }

  /**
   * A domain's spec, as written and as read.
   *
   * @param name - The domain.
   * @returns The text and the spec (or why it does not read), or null when there is no file.
   */
  spec_read(name: string): { text: string; spec: DomainSpec | null; error?: string } | null {
    const file: string = path.join(this.folder_of(name), 'spec.yaml');
    if (!fs.existsSync(file)) return null;
    const text: string = fs.readFileSync(file, 'utf-8');
    const parsed = specYaml_parse(text);
    return 'spec' in parsed ? { text, spec: parsed.spec } : { text, spec: null, error: parsed.error };
  }

  /**
   * Writes one of the domain's own files (`plan.json`), whole.
   *
   * @param name - The domain.
   * @param file - The file's name in the domain's folder.
   * @param text - Its content.
   */
  file_write(name: string, file: string, text: string): void {
    file_writeAtomic(path.join(this.folder_of(name), file), text);
  }

  /**
   * Reads one of the domain's own files.
   *
   * @param name - The domain.
   * @param file - The file's name in the domain's folder.
   * @returns Its content, or null when it is not there.
   */
  file_read(name: string, file: string): string | null {
    const where: string = path.join(this.folder_of(name), file);
    return fs.existsSync(where) ? fs.readFileSync(where, 'utf-8') : null;
  }

  /**
   * Keeps a secret the build fetched.
   *
   * @param name - The domain.
   * @param file - Its file name under `auth/`.
   * @param text - Its content.
   */
  secret_write(name: string, file: string, text: string): void {
    const folder: string = path.join(this.folder_of(name), 'auth');
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    file_writeAtomic(path.join(folder, file), text);
  }

  /**
   * Reads a secret the build kept, for the build's own next step; never served.
   *
   * @param name - The domain.
   * @param file - Its file name under `auth/`.
   * @returns Its content, or null.
   */
  secret_read(name: string, file: string): string | null {
    const where: string = path.join(this.folder_of(name), 'auth', file);
    return fs.existsSync(where) ? fs.readFileSync(where, 'utf-8') : null;
  }

  /**
   * The secrets kept, by name and host path; their content is never read here.
   *
   * @param name - The domain.
   * @returns The files.
   */
  secrets_list(name: string): Array<{ name: string; hostPath: string }> {
    const folder: string = path.join(this.folder_of(name), 'auth');
    if (!fs.existsSync(folder)) return [];
    return fs.readdirSync(folder).sort().map((file: string): { name: string; hostPath: string } => ({ name: file, hostPath: path.join(folder, file) }));
  }
}
