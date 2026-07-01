export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: { module: 'CommonJS' } }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^chalk$': '<rootDir>/__mocks__/chalk.js',
  },
  // FROZEN exclude-list (coverage-grind Phase 0.4). Do NOT extend without
  // human sign-off — these are barrels / entry shims / device IO with no
  // unit-testable logic. Everything else counts toward the 80% bar.
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!<rootDir>/src/index.ts',
    '!<rootDir>/src/**/*.d.ts',
    '!<rootDir>/src/cli.ts', // CLI entry/bootstrap
    '!<rootDir>/src/cache/index.ts', // barrel
    '!<rootDir>/src/jobs/index.ts', // barrel
    '!<rootDir>/src/io/io.ts', // IStorageProvider interface + re-export
    '!<rootDir>/src/io/node_io.ts', // raw device IO
    '!<rootDir>/src/io/browser_io.ts', // raw device IO
  ],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  coverageProvider: 'babel',
  // Ratchet floor. Bumped at each wave checkpoint. Target: 80.
  // Wave 1 (pure-logic) checkpoint: chrisPath, procCache, config, jobMonitor,
  // resource-group subclasses, chrisContext. Remaining low files are all
  // chrisapi-coupled -> Wave 3 (post-adapter).
  coverageThreshold: {
    global: { statements: 38, branches: 25, functions: 52, lines: 38 },
  },
};
