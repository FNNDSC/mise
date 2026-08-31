/**
 * @file Test stand-in for `@fnndsc/brasa` inside chell's jest runs.
 *
 * Jest's CommonJS export scanner cannot digest the built brasa barrel (its
 * deep `export *` graph overflows the scanner), so suites that exercise real
 * brasa code cannot import the package. Suites that mock brasa wholesale
 * (`jest.unstable_mockModule`) are unaffected — the mock wins over this
 * mapping. What this stub re-exports is the brain renderer, from its source,
 * so the logo characterization tests run against the real art.
 */
export * from '../../../brasa/src/logo/brain.js';
