import { pace_get, pace_note, pace_reset, pace_isPageMethod, PACE_WINDOW } from '../src/chrisapi/pace';

beforeEach(() => pace_reset());

describe('CUBE pace', () => {
  it('is unknown before any page was timed, then the median of what was', () => {
    expect(pace_get()).toBeNull();
    pace_note(2800, 10); pace_note(3000, 20); pace_note(2600, 30);
    expect(pace_get()).toEqual({ msPerPage: 2800, samples: 3, at: 30 });
    pace_note(100, 40);
    expect(pace_get()?.msPerPage).toBe(2700); // even count: the middle pair's mean
  });

  it('keeps a window and forgets what fell out of it', () => {
    for (let i = 0; i < PACE_WINDOW + 5; i++) pace_note(i < 5 ? 100000 : 1000, i);
    const pace = pace_get();
    expect(pace?.samples).toBe(PACE_WINDOW);
    expect(pace?.msPerPage).toBe(1000);
  });

  it('times the page fetchers and nothing else', () => {
    expect(pace_isPageMethod('getPluginInstances')).toBe(true);
    expect(pace_isPageMethod('getFeeds')).toBe(true);
    expect(pace_isPageMethod('getPublicFeeds')).toBe(true);
    expect(pace_isPageMethod('getFeed')).toBe(false);
    expect(pace_isPageMethod('createWorkflow')).toBe(false);
  });
});
