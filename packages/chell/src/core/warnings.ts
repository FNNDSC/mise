/**
 * @file Node deprecation-warning suppression shared by chell's entry points.
 *
 * @module
 */

/**
 * Suppresses the DEP0169 `url.parse()` deprecation warning emitted through the
 * axios -> proxy-from-env dependency chain.
 *
 * proxy-from-env 1.1.0 (pulled via axios) still uses `url.parse()`, which
 * triggers the warning in Node. Safe to remove once that dependency migrates to
 * the WHATWG URL API or axios drops it.
 */
export function warnings_suppress(): void {
  const originalEmitWarning: typeof process.emitWarning = process.emitWarning;
  process.emitWarning = function (warning: string | Error, ...args: unknown[]): void {
    if (
      typeof warning === 'string' &&
      (warning.includes('DEP0169') || warning.includes('url.parse()'))
    ) {
      return;
    }
    // eslint-disable-next-line prefer-spread
    return (originalEmitWarning as (...a: unknown[]) => void).apply(process, [warning, ...args]);
  };
}
