import baseConfig from '../jest.config.base.mjs';

export default {
  ...baseConfig,
  roots: ['<rootDir>/test'],
  coverageProvider: 'v8',
};
