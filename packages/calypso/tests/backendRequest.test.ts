/**
 * @file The calypso command hosts ChRIS, unless a test names another backend.
 */
import { backendRequest_parse } from '../src/calypso';

describe('the backend the calypso command hosts', () => {
  it('is ChRIS when none is named', () => {
    expect(backendRequest_parse(['node', 'calypso'], {})).toEqual({ backend: 'chris' });
  });

  it('is another only for a test that says it is one', () => {
    expect(backendRequest_parse(['node', 'calypso', '--backend', 'null'], { CALYPSO_TEST_BACKENDS: '1' })).toEqual({ backend: 'null' });
    expect(backendRequest_parse(['node', 'calypso', '--backend', 'null'], {})).toEqual({ error: '--backend is for tests (set CALYPSO_TEST_BACKENDS=1)' });
  });

  it('refuses a backend it cannot host, by name', () => {
    expect(backendRequest_parse(['node', 'calypso', '--backend', 'aws'], { CALYPSO_TEST_BACKENDS: '1' })).toEqual({ error: '--backend takes null' });
    expect(backendRequest_parse(['node', 'calypso', '--backend'], { CALYPSO_TEST_BACKENDS: '1' })).toEqual({ error: '--backend takes null' });
  });
});
