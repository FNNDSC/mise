/**
 * @file C's printf formatting, as trek uses it.
 *
 * trek prints through printf with widths, precisions and flags
 * (`%5.1f`, `%14.14s`, `%-3d`); a faithful port prints exactly what the C
 * printed, so this formats as C does: conversions d i u c s f e g x o and
 * %%, flags - + space 0 #, width and precision (either may be `*`).
 * Written for the port (no BSD source here).
 *
 * @module
 */

/** One value printf may be handed. */
export type PrintfArg = number | string;

/**
 * Formats as C's sprintf.
 *
 * @param format - The format string.
 * @param args - The values, in order.
 * @returns The text.
 */
export function sprintf(format: string, ...args: PrintfArg[]): string {
  let out: string = '';
  let next: number = 0;
  const take = (): PrintfArg => args[next++] ?? 0;
  const spec: RegExp = /%([-+ 0#]*)(\*|\d+)?(?:\.(\*|\d*))?(?:hh|h|ll|l|L|z|j|t)?([diucsfFeEgGxXo%])/g;
  let last: number = 0;
  let match: RegExpExecArray | null;
  while ((match = spec.exec(format)) !== null) {
    out += format.slice(last, match.index);
    last = spec.lastIndex;
    const [, flags = '', widthSpec, precSpec, conversion = ''] = match;
    if (conversion === '%') { out += '%'; continue; }
    let width: number = widthSpec === undefined ? 0 : widthSpec === '*' ? Number(take()) : Number(widthSpec);
    let left: boolean = flags.includes('-');
    if (width < 0) { left = true; width = -width; }
    const precision: number | null = precSpec === undefined ? null : precSpec === '*' ? Number(take()) : Number(precSpec || '0');
    const value: PrintfArg = take();
    let body: string;
    let sign: string = '';
    let numeric: boolean = true;
    switch (conversion) {
      case 'd': case 'i': case 'u': {
        const n: number = Math.trunc(Number(value));
        sign = n < 0 ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
        body = String(Math.abs(n));
        if (precision !== null) body = precision === 0 && n === 0 ? '' : body.padStart(precision, '0');
        break;
      }
      case 'x': case 'X': case 'o': {
        const n: number = Math.trunc(Number(value)) >>> 0;
        body = n.toString(conversion === 'o' ? 8 : 16);
        if (conversion === 'X') body = body.toUpperCase();
        if (precision !== null) body = body.padStart(precision, '0');
        if (flags.includes('#') && n !== 0) body = (conversion === 'o' ? '0' : conversion === 'x' ? '0x' : '0X') + body;
        break;
      }
      case 'c':
        numeric = false;
        body = typeof value === 'number' ? String.fromCharCode(value) : String(value).charAt(0);
        break;
      case 's':
        numeric = false;
        body = String(value);
        if (precision !== null) body = body.slice(0, precision);
        break;
      default: {
        const n: number = Number(value);
        sign = n < 0 || Object.is(n, -0) ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
        body = float_format(Math.abs(n), conversion, precision ?? 6, flags.includes('#'));
      }
    }
    let text: string = sign + body;
    if (text.length < width) {
      if (left) text = text.padEnd(width);
      else if (numeric && flags.includes('0') && !(precision !== null && 'diuxXo'.includes(conversion))) text = sign + body.padStart(width - sign.length, '0');
      else text = text.padStart(width);
    }
    out += text;
  }
  return out + format.slice(last);
}

/** A non-negative double in %f, %e or %g. */
function float_format(n: number, conversion: string, precision: number, alternate: boolean): string {
  if (!Number.isFinite(n)) return Number.isNaN(n) ? 'nan' : 'inf';
  const lower: string = conversion.toLowerCase();
  if (lower === 'f') return fixed_exact(n, precision);
  if (lower === 'e') return exp_format(n, precision, conversion === 'E');
  // %g: precision 0 is 1; %e when the exponent is < -4 or >= precision.
  const p: number = precision === 0 ? 1 : precision;
  const exponent: number = n === 0 ? 0 : Math.floor(Math.log10(Number(n.toExponential(p - 1))));
  let text: string = exponent < -4 || exponent >= p ? exp_format(n, p - 1, conversion === 'G') : n.toFixed(Math.max(0, p - 1 - exponent));
  if (!alternate) {
    text = text.replace(/(\.\d*?)0+(e|E|$)/, '$1$2').replace(/\.(e|E|$)/, '$1');
  }
  return text;
}

/** %e: d.ddde+XX, at least two exponent digits. */
function exp_format(n: number, precision: number, upper: boolean): string {
  const [mantissa, exp = '0'] = n.toExponential(precision).split('e');
  const e: number = Number(exp);
  const text: string = `${mantissa}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
  return upper ? text.toUpperCase() : text;
}

/**
 * %f as glibc prints it: the double's exact binary value rounded to the
 * precision, an exact tie to even. (JavaScript's toFixed rounds a tie up:
 * `%.0f` of 2.5 is 2 in C and 3 in toFixed.)
 *
 * @param n - A non-negative finite double.
 * @param precision - Digits after the point.
 * @returns The digits.
 */
export function fixed_exact(n: number, precision: number): string {
  const view: DataView = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, n);
  const bits: bigint = view.getBigUint64(0);
  const biased: number = Number((bits >> 52n) & 0x7ffn);
  const fraction: bigint = bits & ((1n << 52n) - 1n);
  // n = mantissa * 2^exponent, exactly.
  const mantissa: bigint = biased === 0 ? fraction : fraction | (1n << 52n);
  const exponent: number = (biased === 0 ? 1 : biased) - 1075;
  const scale: bigint = 10n ** BigInt(precision);
  let digits: bigint;
  if (exponent >= 0) {
    digits = (mantissa << BigInt(exponent)) * scale;
  } else {
    const numerator: bigint = mantissa * scale;
    const denominator: bigint = 1n << BigInt(-exponent);
    digits = numerator / denominator;
    const twice: bigint = (numerator % denominator) * 2n;
    if (twice > denominator || (twice === denominator && digits % 2n === 1n)) digits += 1n;
  }
  const text: string = digits.toString().padStart(precision + 1, '0');
  return precision === 0 ? text : `${text.slice(0, text.length - precision)}.${text.slice(text.length - precision)}`;
}
