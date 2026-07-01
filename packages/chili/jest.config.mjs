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
  // human sign-off. screen.ts is KEPT (table formatting is assertable).
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
  // Ratchet floor (coverage-grind Phase 0.5). Baseline of the testable
  // remainder; bump upward at each wave checkpoint. Target: 80.
  coverageThreshold: {
    global: { statements: 50, branches: 41, functions: 47, lines: 51 },
  },
};
