/**
 * @file Number toys from the shelf: `factor`, `primes`, `roll`, `calc`, `units`.
 *
 * `calc` is a small arithmetic reader of its own — no `eval` — with the
 * usual operators, parentheses, a few functions and `pi` and `e`. `units`
 * converts within a modest table: length, mass, time, data and temperature.
 *
 * @module
 */
import { text_input } from './stdin.js';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/menu';

/** The most primes `primes` lists in one call. */
export const PRIMES_MAX: number = 10_000;

/** The prime factors of n, smallest first, with repeats. */
export function factors_of(n: number): number[] {
  const out: number[] = [];
  let rest: number = n;
  for (let p: number = 2; p * p <= rest; p++) {
    while (rest % p === 0) { out.push(p); rest /= p; }
  }
  if (rest > 1) out.push(rest);
  return out;
}

/** The primes in [from, to], at most PRIMES_MAX of them. */
export function primes_between(from: number, to: number): number[] {
  const out: number[] = [];
  const isPrime = (n: number): boolean => {
    if (n < 2) return false;
    for (let p: number = 2; p * p <= n; p++) if (n % p === 0) return false;
    return true;
  };
  for (let n: number = Math.max(2, from); n <= to && out.length < PRIMES_MAX; n++) if (isPrime(n)) out.push(n);
  return out;
}

/**
 * Rolls dice written as `NdS[+M]`, e.g. `2d6+1`, `d20`.
 *
 * @returns Each die's face and the total, or a refusal.
 */
export function dice_roll(spec: string, random: () => number = Math.random): { rolls: number[]; modifier: number; total: number } | { refusal: string } {
  const m: RegExpMatchArray | null = /^(\d*)d(\d+)([+-]\d+)?$/i.exec(spec.trim());
  if (m === null) return { refusal: `roll: '${spec}' is not dice (try 2d6, d20, 3d8+2)` };
  const count: number = m[1] === '' || m[1] === undefined ? 1 : Number(m[1]);
  const sides: number = Number(m[2]);
  const modifier: number = m[3] === undefined ? 0 : Number(m[3]);
  if (count < 1 || count > 100 || sides < 2 || sides > 1000) return { refusal: 'roll: 1 to 100 dice of 2 to 1000 sides' };
  const rolls: number[] = Array.from({ length: count }, (): number => 1 + Math.floor(random() * sides));
  return { rolls, modifier, total: rolls.reduce((a: number, b: number): number => a + b, 0) + modifier };
}

/* ------------------------------------------------------------- calc */

const CALC_FUNCTIONS: Readonly<Record<string, (x: number) => number>> = {
  sqrt: Math.sqrt, abs: Math.abs, ln: Math.log, log: Math.log10, log2: Math.log2, exp: Math.exp,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  floor: Math.floor, ceil: Math.ceil, round: Math.round,
};
const CALC_CONSTANTS: Readonly<Record<string, number>> = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };

/**
 * Evaluates an arithmetic expression: + - * / % ^, parentheses, unary minus,
 * the functions above, pi and e. Throws with a reason on a malformed one.
 */
export function calc_evaluate(expression: string): number {
  const src: string = expression.replace(/\s+/g, '');
  let at: number = 0;
  const peek = (): string => src[at] ?? '';
  const fail = (why: string): never => { throw new Error(`calc: ${why} at position ${at + 1}`); };
  const number = (): number => {
    const m: RegExpMatchArray | null = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(at));
    if (m === null) return fail('expected a number');
    at += m[0].length;
    return Number(m[0]);
  };
  const atom = (): number => {
    if (peek() === '(') {
      at++;
      const v: number = expr();
      if (peek() !== ')') return fail("expected ')'");
      at++;
      return v;
    }
    if (peek() === '-') { at++; return -atom(); }
    if (peek() === '+') { at++; return atom(); }
    const word: RegExpMatchArray | null = /^[a-z][a-z0-9]*/i.exec(src.slice(at));
    if (word !== null) {
      const name: string = word[0].toLowerCase();
      at += name.length;
      if (name in CALC_CONSTANTS) return CALC_CONSTANTS[name] as number;
      const fn: ((x: number) => number) | undefined = CALC_FUNCTIONS[name];
      if (fn === undefined) return fail(`unknown name '${name}'`);
      if (peek() !== '(') return fail(`'${name}' wants parentheses`);
      at++;
      const v: number = expr();
      if (peek() !== ')') return fail("expected ')'");
      at++;
      return fn(v);
    }
    return number();
  };
  const power = (): number => {
    const base: number = atom();
    if (peek() === '^') { at++; return Math.pow(base, power()); }
    return base;
  };
  const term = (): number => {
    let v: number = power();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op: string = peek(); at++;
      const r: number = power();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  };
  const expr = (): number => {
    let v: number = term();
    while (peek() === '+' || peek() === '-') {
      const op: string = peek(); at++;
      const r: number = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  if (src === '') fail('nothing to compute');
  const value: number = expr();
  if (at < src.length) fail(`unexpected '${peek()}'`);
  return value;
}

/* ------------------------------------------------------------ units */

/** A unit: its kind and its size in the kind's base unit. */
interface Unit { kind: string; factor: number }

const UNITS: Readonly<Record<string, Unit>> = {
  m: { kind: 'length', factor: 1 }, meter: { kind: 'length', factor: 1 }, metre: { kind: 'length', factor: 1 },
  km: { kind: 'length', factor: 1000 }, cm: { kind: 'length', factor: 0.01 }, mm: { kind: 'length', factor: 0.001 }, um: { kind: 'length', factor: 1e-6 },
  in: { kind: 'length', factor: 0.0254 }, inch: { kind: 'length', factor: 0.0254 }, ft: { kind: 'length', factor: 0.3048 }, foot: { kind: 'length', factor: 0.3048 }, feet: { kind: 'length', factor: 0.3048 },
  yd: { kind: 'length', factor: 0.9144 }, mi: { kind: 'length', factor: 1609.344 }, mile: { kind: 'length', factor: 1609.344 }, nmi: { kind: 'length', factor: 1852 },
  kg: { kind: 'mass', factor: 1 }, g: { kind: 'mass', factor: 0.001 }, mg: { kind: 'mass', factor: 1e-6 }, lb: { kind: 'mass', factor: 0.45359237 }, oz: { kind: 'mass', factor: 0.028349523125 }, st: { kind: 'mass', factor: 6.35029318 },
  s: { kind: 'time', factor: 1 }, sec: { kind: 'time', factor: 1 }, ms: { kind: 'time', factor: 0.001 }, us: { kind: 'time', factor: 1e-6 }, min: { kind: 'time', factor: 60 }, h: { kind: 'time', factor: 3600 }, hr: { kind: 'time', factor: 3600 },
  d: { kind: 'time', factor: 86400 }, day: { kind: 'time', factor: 86400 }, wk: { kind: 'time', factor: 604800 }, week: { kind: 'time', factor: 604800 }, yr: { kind: 'time', factor: 31557600 }, year: { kind: 'time', factor: 31557600 },
  B: { kind: 'data', factor: 1 }, byte: { kind: 'data', factor: 1 }, kB: { kind: 'data', factor: 1e3 }, MB: { kind: 'data', factor: 1e6 }, GB: { kind: 'data', factor: 1e9 }, TB: { kind: 'data', factor: 1e12 },
  KiB: { kind: 'data', factor: 1024 }, MiB: { kind: 'data', factor: 1024 ** 2 }, GiB: { kind: 'data', factor: 1024 ** 3 }, TiB: { kind: 'data', factor: 1024 ** 4 }, bit: { kind: 'data', factor: 0.125 },
  C: { kind: 'temperature', factor: 1 }, F: { kind: 'temperature', factor: 1 }, K: { kind: 'temperature', factor: 1 },
};

/** Temperature is affine, not a factor: converted by hand. */
function temperature_convert(value: number, from: string, to: string): number {
  const celsius: number = from === 'C' ? value : from === 'F' ? (value - 32) * 5 / 9 : value - 273.15;
  return to === 'C' ? celsius : to === 'F' ? celsius * 9 / 5 + 32 : celsius + 273.15;
}

/**
 * Converts a quantity between two units of one kind.
 *
 * @returns The converted value, or a refusal naming what went wrong.
 */
export function units_convert(value: number, from: string, to: string): { value: number } | { refusal: string } {
  const a: Unit | undefined = UNITS[from] ?? UNITS[from.toLowerCase()];
  const b: Unit | undefined = UNITS[to] ?? UNITS[to.toLowerCase()];
  if (a === undefined) return { refusal: `units: unknown unit '${from}'` };
  if (b === undefined) return { refusal: `units: unknown unit '${to}'` };
  if (a.kind !== b.kind) return { refusal: `units: cannot convert ${a.kind} to ${b.kind}` };
  if (a.kind === 'temperature') return { value: temperature_convert(value, from.toUpperCase(), to.toUpperCase()) };
  return { value: value * a.factor / b.factor };
}

/** The unit names `units` knows, for its help and its refusals. */
export function units_known(): string[] {
  return Object.keys(UNITS);
}

/* --------------------------------------------------------- builtins */

/** `factor N...` */
export async function builtin_factor(args: string[]): Promise<CommandEnvelope> {
  const words: string[] = text_input(args)?.trim().split(/\s+/) ?? [];
  if (words.length === 0) return envelope_error('', undefined, 'factor: usage: factor N [N...]\n');
  const lines: string[] = [];
  const data: Array<{ n: number; factors: number[] }> = [];
  for (const word of words) {
    const n: number = Number(word);
    if (!Number.isInteger(n) || n < 1 || n > Number.MAX_SAFE_INTEGER) return envelope_error('', undefined, `factor: '${word}' is not a positive whole number\n`);
    const factors: number[] = n === 1 ? [] : factors_of(n);
    data.push({ n, factors });
    lines.push(`${n}: ${factors.join(' ')}`.trimEnd());
  }
  return envelope_ok(`${lines.join('\n')}\n`, { kind: 'games.factor', data: { numbers: data } });
}

/** `primes [FROM] TO` */
export async function builtin_primes(args: string[]): Promise<CommandEnvelope> {
  const nums: number[] = args.map(Number);
  if (nums.length === 0 || nums.length > 2 || nums.some((n: number): boolean => !Number.isInteger(n))) {
    return envelope_error('', undefined, 'primes: usage: primes [FROM] TO\n');
  }
  const [from, to]: [number, number] = nums.length === 1 ? [2, nums[0] as number] : [nums[0] as number, nums[1] as number];
  const primes: number[] = primes_between(from, to);
  const note: string = primes.length >= PRIMES_MAX ? `primes: stopped at ${PRIMES_MAX}\n` : '';
  return envelope_ok(`${primes.join(' ')}\n${note}`, { kind: 'games.primes', data: { from, to, primes } });
}

/** `roll [NdS[+M]]...` — 1d6 when bare. */
export async function builtin_roll(args: string[]): Promise<CommandEnvelope> {
  const specs: string[] = args.length === 0 ? ['1d6'] : args;
  const lines: string[] = [];
  const data: Array<{ dice: string; rolls: number[]; total: number }> = [];
  for (const spec of specs) {
    const r = dice_roll(spec);
    if ('refusal' in r) return envelope_error('', undefined, `${r.refusal}\n`);
    const mod: string = r.modifier === 0 ? '' : ` ${r.modifier > 0 ? '+' : '-'} ${Math.abs(r.modifier)}`;
    lines.push(r.rolls.length === 1 && r.modifier === 0 ? `${spec}: ${r.total}` : `${spec}: ${r.rolls.join(' + ')}${mod} = ${r.total}`);
    data.push({ dice: spec, rolls: r.rolls, total: r.total });
  }
  return envelope_ok(`${lines.join('\n')}\n`, { kind: 'games.roll', data: { rolls: data } });
}

/** `calc EXPRESSION` */
export async function builtin_calc(args: string[]): Promise<CommandEnvelope> {
  const expression: string | null = text_input(args);
  if (expression === null) return envelope_error('', undefined, 'calc: usage: calc <expression>   (e.g. calc 2^10, calc sqrt(2)*pi)\n');
  try {
    const value: number = calc_evaluate(expression.trim());
    const shown: string = Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12)));
    return envelope_ok(`${shown}\n`, { kind: 'games.calc', data: { expression: expression.trim(), value } });
  } catch (error: unknown) {
    return envelope_error('', undefined, `${error instanceof Error ? error.message : String(error)}\n`);
  }
}

/** `units VALUE FROM [to] TO` */
export async function builtin_units(args: string[]): Promise<CommandEnvelope> {
  // `units 10 mm to in`, `units 10 mm in in`: the joining word is dropped.
  const words: string[] = args.length === 4 && /^(to|in|as)$/i.test(args[2] as string) ? [args[0] as string, args[1] as string, args[3] as string] : [...args];
  if (words.length === 1 && (words[0] === 'list' || words[0] === '--list')) {
    return envelope_ok(`${units_known().join(' ')}\n`, { kind: 'games.units', data: { known: units_known() } });
  }
  if (words.length !== 3 || !Number.isFinite(Number(words[0]))) {
    return envelope_error('', undefined, 'units: usage: units VALUE FROM [to] TO   (units list names the units)\n');
  }
  const value: number = Number(words[0]);
  const r = units_convert(value, words[1] as string, words[2] as string);
  if ('refusal' in r) return envelope_error('', undefined, `${r.refusal}\n`);
  const shown: string = String(Number(r.value.toPrecision(10)));
  return envelope_ok(`${value} ${words[1]} = ${shown} ${words[2]}\n`, { kind: 'games.units', data: { value, from: words[1], to: words[2], result: r.value } });
}
