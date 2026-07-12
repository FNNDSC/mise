module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { useESM: true }],
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1', // Handle ESM imports in tests
  },
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!<rootDir>/src/index.ts', // barrel
    '!<rootDir>/src/**/*.d.ts',
    '!<rootDir>/src/builtins/index.ts', // barrel
    '!<rootDir>/src/core/question.ts', // raw readline stdin prompts
    '!<rootDir>/src/lib/spinner.ts', // terminal render
  ],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  coverageProvider: 'babel',
  // Minimum coverage enforced by CI; raise as coverage improves. Baseline set
  // when the engine was lifted out of chell into this package.
  coverageThreshold: {
    global: { statements: 89, branches: 77, functions: 91, lines: 90 },
    // Per-file floor: no covered file may fall below 60% statements/lines.
    './src/**/*.ts': { statements: 60, lines: 60 },
  },
};
