module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transform: {
    '^.+\.(ts|tsx)$': ['ts-jest', { useESM: true }],
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\.{1,2}/.*)\.js$': '$1', // Handle ESM imports in tests
  },
  // FROZEN exclude-list (coverage-grind Phase 0.4). Do NOT extend without
  // human sign-off. chell.ts is KEPT (parse/dispatch logic; Phase 5 splits it).
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!<rootDir>/src/index.ts',
    '!<rootDir>/src/**/*.d.ts',
    '!<rootDir>/src/builtins/index.ts', // barrel
    '!<rootDir>/src/core/repl.ts', // REPL loop
    '!<rootDir>/src/core/prompt/**', // prompt render (index/themes/utils)
    '!<rootDir>/src/lib/logo.ts', // terminal render
    '!<rootDir>/src/lib/spinner.ts', // terminal render
    '!<rootDir>/src/lib/bootsequence.ts', // boot shim
    '!<rootDir>/src/core/bootFlags.ts', // boot shim
    '!<rootDir>/src/core/cli.ts' // boot shim
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/dist/'
  ],
  coverageProvider: 'babel',
  // Ratchet floor (coverage-grind Phase 0.5). Baseline of the testable
  // remainder; bump upward at each wave checkpoint. Target: 70 (interactive shell).
  coverageThreshold: {
    global: { statements: 26, branches: 25, functions: 34, lines: 27 },
  },
};