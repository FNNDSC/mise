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
  // Excluded from coverage: barrels, REPL loop, prompt rendering and boot
  // glue. chell.ts is kept — it holds real parse/dispatch logic.
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!<rootDir>/src/index.ts',
    '!<rootDir>/src/**/*.d.ts',
    '!<rootDir>/src/builtins/index.ts', // barrel
    '!<rootDir>/src/core/repl.ts', // REPL loop
    '!<rootDir>/src/core/boot.ts', // connection + REPL startup glue
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
  // Minimum coverage enforced by CI; raise as coverage improves.
  coverageThreshold: {
    global: { statements: 26, branches: 25, functions: 34, lines: 27 },
  },
};