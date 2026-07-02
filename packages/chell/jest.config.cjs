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
  // glue. The parse/dispatch logic lives in core/dispatch.ts and is covered.
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!<rootDir>/src/index.ts',
    '!<rootDir>/src/**/*.d.ts',
    '!<rootDir>/src/chell.ts', // re-export barrel
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
    global: { statements: 62, branches: 53, functions: 66, lines: 63 },
  },
};