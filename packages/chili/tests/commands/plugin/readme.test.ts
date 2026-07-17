import { pluginReadme_fetch, pluginReadme_render } from '../../../src/commands/plugin/readme';
import * as salsa from '@fnndsc/salsa';

jest.mock('@fnndsc/salsa');

describe('commands/plugin/readme', () => {
  it('should call salsa.plugin_readme with the provided pluginId', async () => {
    const document = { content: 'Mock README Content', format: 'markdown', sourceUrl: 'README.md' };
    (salsa.pluginReadmeDocument_fetch as jest.Mock).mockResolvedValue(document);
    const result = await pluginReadme_fetch('123');
    expect(salsa.pluginReadmeDocument_fetch).toHaveBeenCalledWith('123');
    expect(result).toEqual(document);
  });

  it('should return null if salsa.plugin_readme returns null', async () => {
    (salsa.pluginReadmeDocument_fetch as jest.Mock).mockResolvedValue(null);
    const result = await pluginReadme_fetch('456');
    expect(result).toBeNull();
  });

  it('preserves reStructuredText instead of parsing it as Markdown', () => {
    const content = 'pfdo_med2img\n============\n\n:Version: 1.2.2\n';
    expect(pluginReadme_render({ content, format: 'rst', sourceUrl: 'README.rst' })).toBe(content);
  });
});
