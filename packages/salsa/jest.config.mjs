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
  // Ratchet floor. Bumped at each wave checkpoint. Target: 80.
  // Wave 1: jobOps, all intent wrappers, feeds, and the native/etc/proc/pacs
  // providers + files/index. Remaining low files (plugins/index, *_content,
  // executors, store_import, plugin_register, peer_search) still to do.
  coverageThreshold: {
    global: { statements: 70, branches: 57, functions: 72, lines: 69 },
  },
};
