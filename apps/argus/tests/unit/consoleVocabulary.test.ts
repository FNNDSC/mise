/**
 * @jest-environment jsdom
 */
/**
 * @file The browser lists what the console lists, in the console's vocabulary.
 *
 * The console's `ls` paints each kind of entry with an icon and a colour
 * from `packages/chili/config/colors.yml`; the browser's rows carry the same
 * icon and the same colour name, and this holds the two tables equal so a
 * change to one is a change to both or a failing test.
 */
import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TYPE_COLOURS, TYPE_GLYPHS } from '../../src/features/files/panel.js';
import { CONSOLE_PALETTE, consolePalette_publish } from '../../src/console/ansi.js';

const CONFIG: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../packages/chili/config/colors.yml');

/** Reads `key: "\\uXXXX"` under `icons:` and `color: name` under each `fileTypes` kind. */
function consoleTable_read(): { icons: Record<string, string>; colours: Record<string, string> } {
  const text: string = readFileSync(CONFIG, 'utf8');
  const icons: Record<string, string> = {};
  for (const m of text.matchAll(/^  (\w+): "\\u([0-9A-Fa-f]{4})"/gm)) {
    icons[m[1] as string] = String.fromCharCode(parseInt(m[2] as string, 16));
  }
  const colours: Record<string, string> = {};
  const types: string = text.slice(text.indexOf('fileTypes:'), text.indexOf('specialPaths:'));
  for (const m of types.matchAll(/^  (\w+):\n(?:    .*\n)*?    color: (\w+)/gm)) {
    colours[m[1] as string] = m[2] as string;
  }
  return { icons, colours };
}

describe('the browser speaks the console\'s listing vocabulary', () => {
  const table = consoleTable_read();

  it('read the console\'s table', () => {
    expect(Object.keys(table.icons).sort()).toEqual(['dir', 'file', 'link', 'pipeline', 'plugin', 'vfs']);
    expect(Object.keys(table.colours).sort()).toEqual(['dir', 'file', 'link', 'pipeline', 'plugin', 'vfs']);
  });

  it('wears the console\'s icon for every kind the console names, and the file\'s for a job', () => {
    for (const [kind, icon] of Object.entries(table.icons)) {
      expect(TYPE_GLYPHS[kind as keyof typeof TYPE_GLYPHS]).toBe(icon);
    }
    expect(TYPE_GLYPHS.job).toBe(table.icons['file']);
  });

  it('wears the console\'s colour name for every kind the console names', () => {
    for (const [kind, colour] of Object.entries(table.colours)) {
      expect(TYPE_COLOURS[kind as keyof typeof TYPE_COLOURS]).toBe(colour);
    }
  });

  it('publishes the palette as tokens the stylesheet reads', () => {
    const root: HTMLElement = document.createElement('div');
    consolePalette_publish(root);
    for (const [name, hex] of Object.entries(CONSOLE_PALETTE)) {
      expect(root.style.getPropertyValue(`--console-${name}`)).toBe(hex);
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
