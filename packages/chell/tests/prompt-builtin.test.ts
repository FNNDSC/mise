import { jest, describe, it, expect, beforeEach } from '@jest/globals';

interface PromptSettings {
  config: { promptTheme: string; p10kSegments: Record<string, boolean> };
}
const settings: PromptSettings = { config: { promptTheme: 'default', p10kSegments: {} } };
const mockSave = jest.fn();
jest.unstable_mockModule('../src/config/settings.js', () => ({ settings, settings_save: mockSave }));

const mockRender = jest.fn(() => 'RENDERED_PROMPT');
jest.unstable_mockModule('../src/core/prompt/index.js', () => ({
  THEME_NAMES: ['default', 'p10k', 'minimal'],
  P10K_OPTIONAL_SEGMENTS: ['time', 'duration', 'status', 'pacs'],
  prompt_render: mockRender,
}));

jest.unstable_mockModule('@fnndsc/salsa', () => ({ context_getSingle: jest.fn(async () => ({ pacsserver: null })) }));
jest.unstable_mockModule('@fnndsc/cumin', () => ({}));
jest.unstable_mockModule('../src/session/index.js', () => ({
  session: { getCWD: jest.fn(async () => '/home/chris'), offline: false, physicalMode_get: jest.fn(() => false) },
}));

const mockQuestion = jest.fn(async () => '');
jest.unstable_mockModule('../src/core/question.js', () => ({ repl_question: mockQuestion }));
jest.unstable_mockModule('../src/builtins/sys/prompt.helpers.js', () => ({
  promptContext_build: jest.fn(() => ({})),
  segmentTokens_parse: (s: string): string[] => s.split(/\s+/).filter(Boolean),
}));

const { builtin_prompt } = await import('../src/builtins/sys/prompt.js');

let logSpy: jest.SpiedFunction<typeof console.log>;
beforeEach(() => {
  jest.clearAllMocks();
  settings.config = { promptTheme: 'default', p10kSegments: { time: false, duration: false, status: false, pacs: false } };
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('builtin_prompt', () => {
  it('shows the current theme with no argument', async () => {
    await builtin_prompt([]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Prompt theme'));
  });

  it('lists available themes with an active marker', async () => {
    await builtin_prompt(['list']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Available prompt themes'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('p10k'));
  });

  it('switches to a known theme and saves', async () => {
    await builtin_prompt(['minimal']);
    expect(settings.config.promptTheme).toBe('minimal');
    expect(mockSave).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("set to 'minimal'"));
  });

  it('rejects an unknown theme', async () => {
    await builtin_prompt(['bogus']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown theme'));
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('toggles a valid p10k segment', async () => {
    await builtin_prompt(['toggle', 'time']);
    expect(settings.config.p10kSegments.time).toBe(true);
    expect(mockSave).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ON'));
  });

  it('rejects an invalid toggle segment', async () => {
    await builtin_prompt(['toggle', 'nope']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: prompt toggle'));
  });

  it('renders the prompt with --show', async () => {
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await builtin_prompt(['--show']);
    expect(mockRender).toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it('refuses --configure on a non-p10k theme', async () => {
    settings.config.promptTheme = 'default';
    await builtin_prompt(['--configure']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No configurable segments'));
  });

  it('toggles segments interactively with --configure on p10k', async () => {
    settings.config.promptTheme = 'p10k';
    mockQuestion.mockResolvedValue('time duration');
    await builtin_prompt(['--configure']);
    expect(settings.config.p10kSegments.time).toBe(true);
    expect(settings.config.p10kSegments.duration).toBe(true);
    expect(mockSave).toHaveBeenCalled();
  });

  it('exits --configure without saving on an empty answer', async () => {
    settings.config.promptTheme = 'p10k';
    mockQuestion.mockResolvedValue('');
    await builtin_prompt(['--configure']);
    expect(mockSave).not.toHaveBeenCalled();
  });
});
