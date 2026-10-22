/**
 * @file The tenancy's `domains/`: the Trusted Domains built in it, the
 * session's home (docs/stratus.adoc, D4).
 *
 * A domain is a folder: `spec.yaml` as written, `settings` (the cluster's
 * name, base domain, region, compartment and pinned versions, never a
 * credential), `state.json` (the build's state document with its secrets
 * withheld), `steps/<nn-name>/` with each step's `state` and the `evidence`
 * it rests on, and `auth/`, which names the credential files and refuses to
 * read them, saying where they are on the host (D8). The domains are the
 * daemon's to know (`stratus --domain <name>=<checkout>`); each is read
 * from the host when it is asked for, so what is listed is what is there.
 *
 * @module
 */
import type { VFSItem } from '@fnndsc/fond';
import { harborDomain_read, lastDone_of, type DomainSecret, type DomainSource, type HarborDomain, type StepState } from '../domains/harborOci.js';
import type { ResourceNode } from './resources.js';
import type { DomainStore } from '../domain/state.js';
import { builtDomain_read } from '../domain/view.js';

/** What a domain folder holds, in listing order. */
export const DOMAIN_ENTRIES: ReadonlyArray<string> = ['spec.yaml', 'settings', 'state.json', 'steps', 'auth'];

/** How the domains tree is made. */
export interface DomainTreeOptions {
  /** The domains the daemon was given. */
  readonly sources: ReadonlyArray<DomainSource>;
  /** Who rows are shown as owned by. */
  readonly owner: () => string;
  /** The clock. */
  readonly now: () => Date;
  /** The domains this daemon builds, kept on its host. */
  readonly store?: DomainStore;
}

/** The domains a tenancy holds, as folders. */
export class DomainTree {
  private readonly options: DomainTreeOptions;

  constructor(options: DomainTreeOptions) {
    this.options = options;
  }

  /** Every domain, read now: those read from checkouts, then those kept here; one kept here (adopted) stands in for its checkout. */
  domains_read(): HarborDomain[] {
    const store: DomainStore | undefined = this.options.store;
    const kept: string[] = store?.names_list() ?? [];
    const read: HarborDomain[] = this.options.sources
      .filter((source: DomainSource): boolean => !kept.includes(source.name))
      .map((source: DomainSource): HarborDomain => harborDomain_read(source, this.options.now()));
    if (store === undefined) return read;
    const built: HarborDomain[] = kept
      .map((name: string): HarborDomain | null => builtDomain_read(store, name))
      .filter((domain: HarborDomain | null): domain is HarborDomain => domain !== null);
    return [...read, ...built];
  }

  /** One domain by name, read now: the one kept here, else the checkout's; null when there is none. */
  domain_read(name: string): HarborDomain | null {
    const kept: HarborDomain | null = this.options.store === undefined ? null : builtDomain_read(this.options.store, name);
    if (kept !== null) return kept;
    const source: DomainSource | undefined = this.options.sources.find((entry: DomainSource): boolean => entry.name === name);
    return source === undefined ? null : harborDomain_read(source, this.options.now());
  }

  /**
   * The node a path below `domains/` names.
   *
   * @param segments - The segments after `domains`.
   * @returns The node.
   */
  node_resolve(segments: ReadonlyArray<string>): ResourceNode {
    if (segments.length === 0) return { kind: 'listing', list: async (): Promise<VFSItem[]> => this.domains_read().map((domain: HarborDomain): VFSItem => this.domain_item(domain)) };
    const [name, entry, ...rest] = segments;
    const domain: HarborDomain | null = this.domain_read(name as string);
    if (domain === null) return { kind: 'missing' };
    if (entry === undefined) return { kind: 'listing', list: async (): Promise<VFSItem[]> => this.domainEntries_items(domain) };
    if (entry === 'steps') return this.stepNode_resolve(domain, rest);
    if (entry === 'auth') return this.authNode_resolve(domain, rest);
    if (rest.length > 0) return { kind: 'missing' };
    const text: string | null = domainFile_text(domain, entry);
    return text === null ? { kind: 'missing' } : { kind: 'file', text };
  }

  private stepNode_resolve(domain: HarborDomain, segments: ReadonlyArray<string>): ResourceNode {
    if (segments.length === 0) return { kind: 'listing', list: async (): Promise<VFSItem[]> => domain.steps.map((step: StepState): VFSItem => this.step_item(step)) };
    const step: StepState | undefined = domain.steps.find((entry: StepState): boolean => entry.folder === segments[0]);
    if (step === undefined) return { kind: 'missing' };
    const fields: Array<[string, string]> = [['state', `${step.state}\n`], ['evidence', `${step.evidence}\n`]];
    if (segments.length === 1) return { kind: 'listing', list: async (): Promise<VFSItem[]> => fields.map(([name, text]: [string, string]): VFSItem => this.file_item(name, text)) };
    if (segments.length > 2) return { kind: 'missing' };
    const field: [string, string] | undefined = fields.find(([name]: [string, string]): boolean => name === segments[1]);
    return field === undefined ? { kind: 'missing' } : { kind: 'file', text: field[1] };
  }

  private authNode_resolve(domain: HarborDomain, segments: ReadonlyArray<string>): ResourceNode {
    if (segments.length === 0) {
      return { kind: 'listing', list: async (): Promise<VFSItem[]> => domain.secrets.map((secret: DomainSecret): VFSItem => ({ name: secret.name, type: 'secret', size: 0, owner: this.options.owner(), date: this.options.now().toISOString() })) };
    }
    const secret: DomainSecret | undefined = domain.secrets.find((entry: DomainSecret): boolean => entry.name === segments[0]);
    if (secret === undefined || segments.length > 1) return { kind: 'missing' };
    return { kind: 'refused', errno: 'EACCES', reason: `a secret stays on the daemon's host: ${secret.hostPath}` };
  }

  // ---- rows ----

  private domain_item(domain: HarborDomain): VFSItem {
    const last: StepState | null = lastDone_of(domain);
    return {
      name: domain.name,
      type: 'domain',
      size: 0,
      owner: this.options.owner(),
      date: this.options.now().toISOString(),
      status: last !== null ? last.folder : 'empty',
      ...(domain.cluster !== null ? { title: domain.cluster } : {}),
    };
  }

  private domainEntries_items(domain: HarborDomain): VFSItem[] {
    const items: VFSItem[] = [];
    for (const entry of DOMAIN_ENTRIES) {
      if (entry === 'steps') items.push(this.folder_item('steps', domain.steps.length));
      else if (entry === 'auth') items.push(this.folder_item('auth', domain.secrets.length));
      else {
        const text: string | null = domainFile_text(domain, entry);
        if (text !== null) items.push(this.file_item(entry, text));
      }
    }
    return items;
  }

  private step_item(step: StepState): VFSItem {
    return { name: step.folder, type: 'step', size: 0, owner: this.options.owner(), date: this.options.now().toISOString(), status: step.state, title: step.evidence };
  }

  private folder_item(name: string, count: number): VFSItem {
    return { name, type: 'kind', size: count, owner: 'cloud', date: this.options.now().toISOString() };
  }

  private file_item(name: string, text: string): VFSItem {
    return { name, type: 'file', size: Buffer.byteLength(text), owner: this.options.owner(), date: this.options.now().toISOString() };
  }
}

/** The text of a domain's own files; null when the domain has none of that name. */
function domainFile_text(domain: HarborDomain, entry: string): string | null {
  if (entry === 'spec.yaml') return domain.spec;
  if (entry === 'state.json') return domain.state === null ? null : `${JSON.stringify(domain.state, null, 2)}\n`;
  if (entry === 'settings') return Object.entries(domain.settings).map(([key, value]: [string, string]): string => `${key}=${value}\n`).join('');
  return null;
}
