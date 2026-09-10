/**
 * @file Which folders are offered IMAGE, and which are not.
 *
 * The verb used to be offered on a NAME alone — oxidicom writes a series
 * folder as `<number>-<description>-<7 hex>` and nothing else does. That is
 * a good signal and an incomplete one: a series stored under any other
 * naming was a series the browser would not open, and the operator hit
 * exactly that with a folder of their own.
 *
 * The rule now also reads the PLACE. Inside the PACS tree the depth says
 * what a folder is, which costs nothing to know — the row already holds its
 * path. What is deliberately NOT done is looking inside: a verb offered
 * only after listing every row's contents is one request per row before the
 * operator has pressed anything.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { seriesFolder_is } from '../../src/features/image/engine.js';

/** The PACS tree: server, patient, study, series. */
const SERVER: string = '/SERVICES/PACS/PACSDCM';
const PATIENT: string = `${SERVER}/1234567-DOE^JANE-19800101`;
const STUDY: string = `${PATIENT}/MR-Brain_w_o_Contrast-22119730-20110512`;

describe('a folder named as a series', () => {
  it('is one wherever it sits, since only oxidicom writes that name', () => {
    expect(seriesFolder_is('/home/me/upload/00002-AAHScout_MPR-678f278', '00002-AAHScout_MPR-678f278')).toBe(true);
    expect(seriesFolder_is(`${STUDY}/00002-AAHScout_MPR-678f278`, '00002-AAHScout_MPR-678f278')).toBe(true);
  });
});

describe('a folder in the PACS tree', () => {
  it('is a series at series depth, whatever it is called', () => {
    expect(seriesFolder_is(`${STUDY}/SAG-anon`, 'SAG-anon')).toBe(true);
    expect(seriesFolder_is(`${STUDY}/anything at all`, 'anything at all')).toBe(true);
  });

  it('is a series at series depth with a trailing slash, since a path may carry one', () => {
    expect(seriesFolder_is(`${STUDY}/SAG-anon/`, 'SAG-anon')).toBe(true);
  });

  it('is NOT a series above that: a study holds series, it is not one', () => {
    expect(seriesFolder_is(STUDY, 'MR-Brain_w_o_Contrast-22119730-20110512')).toBe(false);
    expect(seriesFolder_is(PATIENT, '1234567-DOE^JANE-19800101')).toBe(false);
    expect(seriesFolder_is(SERVER, 'PACSDCM')).toBe(false);
    expect(seriesFolder_is('/SERVICES/PACS', 'PACS')).toBe(false);
  });

  it('is NOT a series below it either, since a series holds files', () => {
    expect(seriesFolder_is(`${STUDY}/SAG-anon/deeper`, 'deeper')).toBe(false);
  });
});

describe('a folder outside the PACS tree', () => {
  it('is offered nothing on its place alone, so the verb stays rare', () => {
    // The operator's own words: a verb on every folder is a verb that is
    // meaningful in a handful of cases and noise in the rest.
    expect(seriesFolder_is('/home/me/upload/SAG-anon', 'SAG-anon')).toBe(false);
    expect(seriesFolder_is('/home/me/feeds/feed_4465', 'feed_4465')).toBe(false);
  });

  it('is not fooled by a path that merely mentions the tree', () => {
    expect(seriesFolder_is('/home/me/SERVICES/PACS/a/b/c/d', 'd')).toBe(false);
  });
});
