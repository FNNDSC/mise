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
  },
  collectCoverageFrom: ['<rootDir>/src/**/*.ts', '!<rootDir>/src/index.ts', '!<rootDir>/src/**/*.d.ts'],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  coverageProvider: 'babel',
  coverageThreshold: {
    // Measured when the files moved from cumin (2026-10-08); a ratchet, raise as coverage improves.
    global: { statements: 89, branches: 64, functions: 87, lines: 89 },
  },
};
