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
  // salsa is a pure logic layer; only barrels (re-exports) are excluded.
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!<rootDir>/src/index.ts',
    '!<rootDir>/src/**/*.d.ts',
    '!<rootDir>/src/jobs/index.ts', // barrel
    '!<rootDir>/src/vfs/index.ts', // barrel
  ],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  coverageProvider: 'babel',
  // Minimum coverage enforced by CI; raise as coverage improves.
  coverageThreshold: {
    global: { statements: 92, branches: 78, functions: 94, lines: 93 },
    // Per-file floor: no covered file may fall below 60% statements/lines.
    './src/**/*.ts': { statements: 60, lines: 60 },
  },
};
