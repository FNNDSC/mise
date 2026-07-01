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
  // human sign-off. salsa is a pure logic layer — only barrels are excluded.
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!<rootDir>/src/index.ts',
    '!<rootDir>/src/**/*.d.ts',
    '!<rootDir>/src/jobs/index.ts', // barrel
    '!<rootDir>/src/vfs/index.ts', // barrel
  ],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  coverageProvider: 'babel',
  // Ratchet floor. Wave 1 (salsa) complete at 82% statements — target met.
  // Still below the eventual per-file 60% floor: vfs/providers/pacs_content,
  // store_import, plugin_register (pick up before lock-in).
  coverageThreshold: {
    global: { statements: 81, branches: 65, functions: 85, lines: 81 },
  },
};
