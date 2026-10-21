/**
 * @file Oracle's public price list, read into prices per shape.
 *
 * Ported from `harbor-oci`'s `ocipricing.py`: the list is fetched once from
 * Oracle's public API, pay-as-you-go prices are indexed by part number, and
 * each flexible shape's family maps to its core and memory parts. OCI bills
 * an OCPU, which is two vCPU on x86 and the newer Ampere shapes and one on
 * the A1, so the vCPU price is the OCPU price over that ratio. List prices
 * only; a tenancy's commitment discount is not applied.
 *
 * @module
 */
import type { CloudPrice } from '../driver.js';

/** Where Oracle publishes its prices. */
export const PRICE_LIST_URL: string = 'https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/';
/** The price model read: paid, hourly. */
const PRICE_MODEL: string = 'PAY_AS_YOU_GO';
/** The currency read. */
const PRICE_CURRENCY: string = 'USD';

/** What the shape list does not say about a flexible shape. */
export interface ShapeTerms {
  /** A neutral family name. */
  readonly family: string;
  /** vCPU per OCPU. */
  readonly vcpuPerOcpu: number;
  /** The price-list part number for an OCPU-hour. */
  readonly ocpuPart: string;
  /** The price-list part number for a GB-hour of memory. */
  readonly memoryPart: string;
}

/** The flexible shapes and their terms, as `harbor-oci` tabled them. */
export const SHAPE_TERMS: Readonly<Record<string, ShapeTerms>> = {
  'VM.Standard.E3.Flex': { family: 'E3', vcpuPerOcpu: 2, ocpuPart: 'B92306', memoryPart: 'B92307' },
  'VM.Standard.E4.Flex': { family: 'E4', vcpuPerOcpu: 2, ocpuPart: 'B93113', memoryPart: 'B93114' },
  'VM.Standard.E5.Flex': { family: 'E5', vcpuPerOcpu: 2, ocpuPart: 'B97384', memoryPart: 'B97385' },
  'VM.Standard.E6.Flex': { family: 'E6', vcpuPerOcpu: 2, ocpuPart: 'B111129', memoryPart: 'B111130' },
  'VM.Standard.E6.Ax.Flex': { family: 'E6.Ax', vcpuPerOcpu: 2, ocpuPart: 'B112530', memoryPart: 'B112531' },
  'VM.Standard.A1.Flex': { family: 'A1', vcpuPerOcpu: 1, ocpuPart: 'B93297', memoryPart: 'B93298' },
  'VM.Standard.A2.Flex': { family: 'A2', vcpuPerOcpu: 2, ocpuPart: 'B109529', memoryPart: 'B109530' },
  'VM.Standard.A4.Flex': { family: 'A4', vcpuPerOcpu: 2, ocpuPart: 'B112145', memoryPart: 'B112146' },
  'VM.Standard.A4.Ax.Flex': { family: 'A4.Ax', vcpuPerOcpu: 2, ocpuPart: 'B112532', memoryPart: 'B112533' },
  'VM.Standard3.Flex': { family: 'Standard3', vcpuPerOcpu: 2, ocpuPart: 'B94176', memoryPart: 'B94177' },
  'VM.Standard4.Ax.Flex': { family: 'Standard4.Ax', vcpuPerOcpu: 2, ocpuPart: 'B112141', memoryPart: 'B112142' },
  'VM.Optimized3.Flex': { family: 'Optimized3', vcpuPerOcpu: 2, ocpuPart: 'B93311', memoryPart: 'B93312' },
  'VM.DenseIO.E4.Flex': { family: 'DenseIO.E4', vcpuPerOcpu: 2, ocpuPart: 'B93121', memoryPart: 'B93122' },
  'VM.DenseIO.E5.Flex': { family: 'DenseIO.E5', vcpuPerOcpu: 2, ocpuPart: 'B98202', memoryPart: 'B98203' },
  'VM.DenseIO.E6.Ax.Flex': { family: 'DenseIO.E6.Ax', vcpuPerOcpu: 2, ocpuPart: 'B112556', memoryPart: 'B112557' },
};

/**
 * A neutral family name for a shape the table does not know: the shape
 * without `VM.`, `Standard.` and `.Flex` (`VM.Standard.X9.Flex` is `X9`).
 */
export function familyName_derive(shape: string): string {
  let name: string = shape;
  if (name.startsWith('VM.')) name = name.slice(3);
  if (name.endsWith('.Flex')) name = name.slice(0, -5);
  if (name.startsWith('Standard.')) name = name.slice(9);
  return name;
}

/** The terms for a shape: the table's, or derived with two vCPU per OCPU and no parts. */
export function shapeTerms_get(shape: string): ShapeTerms {
  return SHAPE_TERMS[shape] ?? { family: familyName_derive(shape), vcpuPerOcpu: 2, ocpuPart: '', memoryPart: '' };
}

/** One product as the price list writes it; only what is read is typed. */
interface PriceListItem {
  readonly partNumber?: string;
  readonly currencyCodeLocalizations?: ReadonlyArray<{
    readonly currencyCode?: string;
    readonly prices?: ReadonlyArray<{ readonly model?: string; readonly value?: number | string }>;
  }>;
}

/**
 * The paid pay-as-you-go price per part number, in the currency read; the
 * highest tier for tiered parts, as `harbor-oci` reads it.
 *
 * @param items - The `items` of the price list reply.
 * @returns USD per the part's own metric.
 */
export function partPrices_index(items: ReadonlyArray<PriceListItem>): Map<string, number> {
  const index: Map<string, number> = new Map();
  for (const item of items) {
    if (item.partNumber === undefined) continue;
    for (const localization of item.currencyCodeLocalizations ?? []) {
      if (localization.currencyCode !== undefined && localization.currencyCode !== PRICE_CURRENCY) continue;
      const values: number[] = (localization.prices ?? [])
        .filter((price): boolean => price.model === PRICE_MODEL)
        .map((price): number => Number(price.value))
        .filter((value: number): boolean => Number.isFinite(value));
      if (values.length > 0) index.set(item.partNumber, Math.max(...values));
    }
  }
  return index;
}

/**
 * Prices per shape from part prices: the shapes whose parts the list holds.
 *
 * @param parts - Price per part number.
 * @returns A price per shape, sorted by shape name.
 */
export function shapePrices_map(parts: ReadonlyMap<string, number>): CloudPrice[] {
  const prices: CloudPrice[] = [];
  for (const [shape, terms] of Object.entries(SHAPE_TERMS)) {
    const ocpu: number | undefined = parts.get(terms.ocpuPart);
    const memory: number | undefined = parts.get(terms.memoryPart);
    if (ocpu === undefined || memory === undefined) continue;
    prices.push({ shape, vcpuHour: ocpu / terms.vcpuPerOcpu, gibHour: memory, currency: PRICE_CURRENCY });
  }
  return prices.sort((a: CloudPrice, b: CloudPrice): number => a.shape.localeCompare(b.shape));
}

/** Fetches a URL as JSON; injected so a test needs no network. */
export type JsonFetch = (url: string) => Promise<unknown>;

/** The default fetch: Node's, thirty seconds. */
export const jsonFetch_default: JsonFetch = async (url: string): Promise<unknown> => {
  const response: Response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`price list: ${response.status} ${response.statusText}`);
  return response.json();
};

/**
 * Oracle's list prices for the flexible shapes, per hour.
 *
 * @param fetchJson - How the list is fetched.
 * @returns A price per shape the list prices.
 */
export async function ociPrices_read(fetchJson: JsonFetch = jsonFetch_default): Promise<CloudPrice[]> {
  const reply: unknown = await fetchJson(PRICE_LIST_URL);
  const items: unknown = typeof reply === 'object' && reply !== null ? (reply as { items?: unknown }).items : undefined;
  if (!Array.isArray(items)) throw new Error('price list: no items in the reply');
  return shapePrices_map(partPrices_index(items as PriceListItem[]));
}
