/**
 * @file Oracle's price list, read into prices per shape.
 */
import { describe, it, expect } from '@jest/globals';
import { familyName_derive, shapeTerms_get, partPrices_index, shapePrices_map, ociPrices_read, SHAPE_TERMS, PRICE_LIST_URL } from '../src/cloud/oci/prices.js';

describe('shape terms', () => {
  it('derives a family name for a shape the table does not know', () => {
    expect(familyName_derive('VM.Standard.X9.Flex')).toBe('X9');
    expect(familyName_derive('BM.GPU.A10.4')).toBe('BM.GPU.A10.4');
    expect(familyName_derive('VM.Optimized3.Flex')).toBe('Optimized3');
    expect(shapeTerms_get('VM.Standard.A1.Flex')).toEqual(SHAPE_TERMS['VM.Standard.A1.Flex']);
    expect(shapeTerms_get('VM.Standard.X9.Flex')).toEqual({ family: 'X9', vcpuPerOcpu: 2, ocpuPart: '', memoryPart: '' });
  });
});

describe('partPrices_index', () => {
  it('keeps the highest pay-as-you-go USD price per part, skipping other models, currencies and bad values', () => {
    const index = partPrices_index([
      { partNumber: 'A', currencyCodeLocalizations: [{ currencyCode: 'USD', prices: [{ model: 'PAY_AS_YOU_GO', value: '1.5' }, { model: 'PAY_AS_YOU_GO', value: 2 }, { model: 'MONTHLY', value: 99 }] }] },
      { partNumber: 'B', currencyCodeLocalizations: [{ currencyCode: 'EUR', prices: [{ model: 'PAY_AS_YOU_GO', value: 3 }] }] },
      { partNumber: 'C', currencyCodeLocalizations: [{ prices: [{ model: 'PAY_AS_YOU_GO', value: 'nope' }] }] },
      { currencyCodeLocalizations: [{ currencyCode: 'USD', prices: [{ model: 'PAY_AS_YOU_GO', value: 7 }] }] },
      { partNumber: 'D' },
    ]);
    expect([...index.entries()]).toEqual([['A', 2]]);
  });
});

describe('shapePrices_map', () => {
  it('prices a shape only when both its parts are known, sorted by shape', () => {
    const parts = new Map<string, number>([['B93297', 0.01], ['B93298', 0.0015], ['B97384', 0.03]]);
    expect(shapePrices_map(parts)).toEqual([{ shape: 'VM.Standard.A1.Flex', vcpuHour: 0.01, gibHour: 0.0015, currency: 'USD' }]);
  });
});

describe('ociPrices_read', () => {
  it('fetches the public list and refuses a reply without items', async () => {
    const asked: string[] = [];
    const prices = await ociPrices_read(async (url: string) => { asked.push(url); return { items: [{ partNumber: 'B97384', currencyCodeLocalizations: [{ currencyCode: 'USD', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.03 }] }] }, { partNumber: 'B97385', currencyCodeLocalizations: [{ currencyCode: 'USD', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.002 }] }] }] }; });
    expect(asked).toEqual([PRICE_LIST_URL]);
    expect(prices).toEqual([{ shape: 'VM.Standard.E5.Flex', vcpuHour: 0.015, gibHour: 0.002, currency: 'USD' }]);
    await expect(ociPrices_read(async () => ({}))).rejects.toThrow('no items');
    await expect(ociPrices_read(async () => null)).rejects.toThrow('no items');
  });
});
