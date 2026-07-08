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
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!<rootDir>/src/index.ts',
    '!<rootDir>/src/**/*.d.ts',
  ],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  coverageProvider: 'babel',
  coverageThreshold: {
    global: { statements: 90, branches: 80, functions: 90, lines: 90 },
    './src/**/*.ts': { statements: 60, lines: 60 },
  },
};
