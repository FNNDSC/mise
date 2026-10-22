/**
 * @file What `expect` can claim about a domain: how a step stands, how its
 * last verify went, what it costs an hour, and which class it is. Registered
 * with the stratus backend (`Backend.expectSubjects`), so a tenant's manifest
 * asserts its domain as a ChRIS manifest asserts its runs:
 *
 *   expect domain ${NAME} step run eq done
 *   expect domain ${NAME} verify eq 10
 *   expect domain ${NAME} cost lt 1.00
 *
 * Every property reads what the domain's state holds or what the cloud
 * answers; none of them changes anything, so `--within` may ask as often as
 * it likes.
 *
 * @module
 */
import type { ExpectAsk, ExpectReading, ExpectSubject } from '@fnndsc/brasa/core';
import type { CloudDriver } from '../cloud/driver.js';
import type { DomainRecord, DomainStore } from './state.js';
import { spend_read, type Spend } from './spend.js';

/** What the domain subject reads. */
export interface DomainExpectDeps {
  readonly store: DomainStore;
  readonly driver: CloudDriver;
  readonly now: () => Date;
}

/** How a verify's summary note begins: `10 of 10 pass`. */
const VERIFY_PASSED: RegExp = /^(\d+) of \d+ pass/;

/**
 * Reads one property of one domain.
 *
 * @param deps - The store and the cloud.
 * @param ask - The claim.
 * @returns The value, or why it has none.
 */
async function domain_read(deps: DomainExpectDeps, ask: ExpectAsk): Promise<ExpectReading> {
  const name: string = ask.target ?? '';
  const record: DomainRecord | null = deps.store.record_read(name);
  if (record === null) {
    const kept: string = deps.store.names_list().join(', ') || 'none';
    return { got: null, refusal: `no domain "${name}" is kept in this session (kept: ${kept})` };
  }
  if (ask.property === 'step') {
    const step: string | undefined = ask.words[0];
    if (step === undefined) return { got: null, refusal: 'expect domain <name> step <step> <predicate> <value>' };
    return { got: record.steps[step]?.state ?? 'not done' };
  }
  if (ask.property === 'verify') {
    const note: string | undefined = record.steps['verify']?.note;
    const passed: RegExpMatchArray | null = note === undefined ? null : note.match(VERIFY_PASSED);
    if (passed === null) return { got: null, refusal: `${name} has not been verified here yet: domain verify ${name}` };
    return { got: passed[1] as string };
  }
  if (ask.property === 'class') {
    return { got: record.gone !== undefined ? 'torn down' : record.adopted !== undefined ? 'adopted' : 'built' };
  }
  if (record.compartmentId === undefined) return { got: null, refusal: `${name} has no compartment recorded yet, so nothing to price` };
  const spend: Spend = await spend_read(deps.driver, record.compartmentId, record.region, deps.now());
  return { got: spend.hourly.toFixed(4) };
}

/**
 * The domain subject, over a session's store and cloud.
 *
 * @param deps - The store and the cloud.
 * @returns The subject.
 */
export function domainExpectSubject_make(deps: DomainExpectDeps): ExpectSubject {
  return {
    name: 'domain',
    named: true,
    properties: { step: 1, verify: 0, class: 0, cost: 0 },
    read: async (ask: ExpectAsk): Promise<ExpectReading> => await domain_read(deps, ask),
  };
}
