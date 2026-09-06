/**
 * Unit tests for the parts of argus that are dependency-free.
 *
 * Most of this app cannot be tested this way: the panels need a DOM and the
 * scene needs three.js, neither of which loads under jest, which is why the
 * smoke suite drives a real browser against a live daemon instead. What can
 * be tested here is the logic deliberately kept free of both — the ranked
 * layout being the first, extracted so a preview card and the stage draw the
 * same graph.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/unit'],
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { useESM: true }],
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
