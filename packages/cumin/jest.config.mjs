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
  // Excluded from coverage: barrels (re-exports), the CLI entry point, and
  // raw device IO — no unit-testable logic. Everything else is counted.
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
  // Minimum coverage enforced by CI; raise as coverage improves.
  coverageThreshold: {
    global: { statements: 49, branches: 36, functions: 61, lines: 49 },
  },
};
