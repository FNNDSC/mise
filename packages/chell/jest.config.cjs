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
    '!<rootDir>/src/core/question.ts', // raw readline stdin prompts
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
  // Minimum coverage enforced by CI; raise as coverage improves. Rebaselined
  // when the engine was lifted into brasa, leaving chell the surface only.
  coverageThreshold: {
    global: { statements: 86, branches: 74, functions: 87, lines: 86 },
    // Per-file floor: no covered file may fall below 60% statements/lines.
    './src/**/*.ts': { statements: 60, lines: 60 },
  },
};