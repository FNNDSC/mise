/**
 * @file A porter's configuration: one CUBE, sensible defaults, refusals by name.
 */
import { describe, it, expect } from '@jest/globals';
import { porterConfig_resolve, chellEntry_locate, PORTER_DEFAULT_PORT } from '../../src/config.js';

const locate = (): string => '/opt/chell/dist/index.js';

describe('porterConfig_resolve', () => {
  it('needs the CUBE and nothing else', () => {
    const config = porterConfig_resolve({ PORTER_CUBE_URL: 'https://cube.example.org/api/v1/' }, locate);
    expect(config.cubeUrl).toBe('https://cube.example.org/api/v1/');
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(PORTER_DEFAULT_PORT);
    expect(config.chellEntry).toBe('/opt/chell/dist/index.js');
    expect(config.stateDir.endsWith('/porter')).toBe(true);
  });

  it('gives the CUBE its trailing slash', () => {
    expect(porterConfig_resolve({ PORTER_CUBE_URL: 'https://cube.example.org/api/v1' }, locate).cubeUrl).toBe('https://cube.example.org/api/v1/');
  });

  it('takes the deployment facts from the environment', () => {
    const config = porterConfig_resolve({
      PORTER_CUBE_URL: 'https://cube.example.org/api/v1/',
      PORTER_STATE_DIR: '/var/lib/porter',
      PORTER_HOST: '0.0.0.0',
      PORTER_PORT: '8080',
      PORTER_CHELL: '/usr/lib/chell/index.js',
      XDG_STATE_HOME: '/ignored',
    }, locate);
    expect(config).toMatchObject({
      cubeUrl: 'https://cube.example.org/api/v1/',
      stateDir: '/var/lib/porter',
      host: '0.0.0.0',
      port: 8080,
      chellEntry: '/usr/lib/chell/index.js',
    });
  });

  it('puts the state under XDG_STATE_HOME when told one', () => {
    expect(porterConfig_resolve({ PORTER_CUBE_URL: 'https://c/api/v1/', XDG_STATE_HOME: '/state' }, locate).stateDir).toBe('/state/porter');
  });

  it('makes up a secret when given none, and says so; keeps one it is given', () => {
    const made = porterConfig_resolve({ PORTER_CUBE_URL: 'https://c/api/v1/' }, locate);
    expect(made.secretGenerated).toBe(true);
    expect(made.secret.length).toBeGreaterThanOrEqual(32);
    expect(made.cookieHours).toBe(24);
    const given = porterConfig_resolve({ PORTER_CUBE_URL: 'https://c/api/v1/', PORTER_SECRET: 'a-secret-of-at-least-twenty-characters', PORTER_COOKIE_HOURS: '8' }, locate);
    expect(given.secret).toBe('a-secret-of-at-least-twenty-characters');
    expect(given.secretGenerated).toBe(false);
    expect(given.cookieHours).toBe(8);
  });

  it('refuses by name', () => {
    expect(() => porterConfig_resolve({}, locate)).toThrow('PORTER_CUBE_URL is required');
    expect(() => porterConfig_resolve({ PORTER_CUBE_URL: 'not a url' }, locate)).toThrow('PORTER_CUBE_URL is not a URL');
    expect(() => porterConfig_resolve({ PORTER_CUBE_URL: 'https://c/api/v1/', PORTER_PORT: 'eighty' }, locate)).toThrow('PORTER_PORT is not a port');
    expect(() => porterConfig_resolve({ PORTER_CUBE_URL: 'https://c/api/v1/', PORTER_SECRET: 'short' }, locate)).toThrow('PORTER_SECRET is too short');
    expect(() => porterConfig_resolve({ PORTER_CUBE_URL: 'https://c/api/v1/', PORTER_COOKIE_HOURS: 'forever' }, locate)).toThrow('PORTER_COOKIE_HOURS is not a span');
  });
});

describe('chellEntry_locate', () => {
  it('finds the chell installed beside the porter', () => {
    expect(chellEntry_locate()).toMatch(/chell\/dist\/index\.js$/);
  });
});
