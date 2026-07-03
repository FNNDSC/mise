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
  // Excluded from coverage: barrels (re-exports) and the CLI entry point.
  // screen.ts is kept — its table formatting is assertable.
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!<rootDir>/src/index.ts',
    '!<rootDir>/src/**/*.d.ts',
    '!<rootDir>/src/run.ts', // commander bootstrap entry
    '!<rootDir>/src/utils.ts', // barrel
    '!<rootDir>/src/models/listing.ts', // barrel
  ],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  coverageProvider: 'babel',
  // Minimum coverage enforced by CI; raise as coverage improves.
  coverageThreshold: {
    global: { statements: 85, branches: 72, functions: 84, lines: 86 },
    // Per-file floor: no covered file may fall below 60% statements/lines.
    './src/**/*.ts': { statements: 60, lines: 60 },
  },
};
