/**
 * @file The showpieces: `sl` (a starship crosses), `cmatrix` (the glyph
 * rain), `rain`, and the aquarium. None listens; each only runs.
 *
 * @module
 */
import type { GameProgram, Grid, Palette } from './program.js';

/** The starship, as the kernel's still draws it (the Enterprise; the kernel's `show.ts` holds the same rows). */
const STARSHIP: ReadonlyArray<string> = [
  '          ______________________________                                    ',
  '         /  ___________________________  \\                                  ',
  '        |  |   NCC-1701      ARGUS     |  |     ____________________________',
  '         \\__|_________________________|_/    /[============================>',
  '             \\______________   ______/      /                               ',
  '                            \\ \\____________/                                ',
  '                             \\______________________________                ',
  '                             [==============================>               ',
];

/** `sl`: the starship glides right to left, forever, with a wake. */
export function sl_make(): GameProgram {
  let x: number = Number.NaN;
  let frame: number = 0;
  return {
    title: 'SL',
    tick: 60,
    step: (size): void => {
      // A field that shrank (a zoom undone, a split) leaves the ship past the
      // right edge: bring it to the edge rather than wait for it to arrive.
      if (Number.isNaN(x) || x > size.cols) x = size.cols;
      x -= 1;
      frame += 1;
      if (x < -(STARSHIP[0] as string).length - 6) x = size.cols;
    },
    draw: (grid: Grid, palette: Palette): void => {
      const top: number = Math.max(0, Math.floor((grid.rows - STARSHIP.length) / 2));
      STARSHIP.forEach((line: string, row: number): void => grid.text(Math.round(x), top + row, line, palette.lit));
      const wake: string = frame % 2 === 0 ? '=~-' : '~=-';
      const tail: number = STARSHIP.length - 1;
      grid.text(Math.round(x) + (STARSHIP[tail] as string).trimEnd().length, top + tail, wake, palette.cool);
    },
  };
}

/** The glyphs `cmatrix` rains. */
const MATRIX_GLYPHS: string = 'ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏｹﾒｴｶｷﾑﾕﾗｾﾈｽﾀﾇﾍ0123456789Z:・.=*+-<>¦|';

interface Drop { row: number; speed: number; length: number; glyphs: string[] }

/** `cmatrix`: columns of glyphs falling, the head bright, the tail fading. */
export function cmatrix_make(): GameProgram {
  const drops: Map<number, Drop> = new Map();
  let clock: number = 0;
  return {
    title: 'CMATRIX',
    tick: 50,
    step: (size, random): void => {
      clock += 1;
      for (let col: number = 0; col < size.cols; col++) {
        const drop: Drop | undefined = drops.get(col);
        if (drop === undefined) {
          if (random() < 0.02) drops.set(col, { row: -1, speed: 1 + Math.floor(random() * 2), length: 4 + Math.floor(random() * 12), glyphs: [] });
          continue;
        }
        if (clock % drop.speed !== 0) continue;
        drop.row += 1;
        drop.glyphs.unshift(MATRIX_GLYPHS[Math.floor(random() * MATRIX_GLYPHS.length)] as string);
        if (drop.glyphs.length > drop.length) drop.glyphs.pop();
        if (drop.row - drop.length > size.rows) drops.delete(col);
      }
    },
    draw: (grid: Grid, palette: Palette): void => {
      for (const [col, drop] of drops) {
        drop.glyphs.forEach((glyph: string, i: number): void => {
          const hue: string = i === 0 ? '#ffffff' : i < drop.length / 2 ? palette.lit : palette.dim;
          grid.put(col, drop.row - i, glyph, hue);
        });
      }
    },
  };
}

interface Raindrop { col: number; row: number; splash: number }

/** `rain`: drops fall and ring out on the floor. */
export function rain_make(): GameProgram {
  const drops: Raindrop[] = [];
  return {
    title: 'RAIN',
    tick: 70,
    step: (size, random): void => {
      if (random() < 0.9) drops.push({ col: Math.floor(random() * size.cols), row: 0, splash: 0 });
      for (const drop of drops) {
        if (drop.row < size.rows - 1) drop.row += 1;
        else drop.splash += 1;
      }
      for (let i: number = drops.length - 1; i >= 0; i--) if ((drops[i] as Raindrop).splash > 3) drops.splice(i, 1);
    },
    draw: (grid: Grid, palette: Palette): void => {
      for (const drop of drops) {
        if (drop.splash === 0) { grid.put(drop.col, drop.row, '|', palette.cool); continue; }
        const ring: string = ['o', 'O', '( )'][drop.splash - 1] as string;
        grid.text(drop.col - (ring.length >> 1), grid.rows - 1, ring, palette.dim);
      }
    },
  };
}

interface Fish { col: number; row: number; right: boolean; speed: number; hue: number }
interface Bubble { col: number; row: number }

/** The aquarium: fish both ways, weed swaying, bubbles rising. */
export function aquarium_make(): GameProgram {
  const fish: Fish[] = [];
  const bubbles: Bubble[] = [];
  let clock: number = 0;
  return {
    title: 'ASCIIQUARIUM',
    tick: 90,
    step: (size, random): void => {
      clock += 1;
      if (fish.length < Math.max(3, size.cols / 12) && random() < 0.08) {
        const right: boolean = random() < 0.5;
        fish.push({ col: right ? -4 : size.cols + 1, row: 2 + Math.floor(random() * Math.max(1, size.rows - 5)), right, speed: 1 + Math.floor(random() * 2), hue: Math.floor(random() * 3) });
      }
      for (const f of fish) if (clock % f.speed === 0) f.col += f.right ? 1 : -1;
      for (let i: number = fish.length - 1; i >= 0; i--) { const f: Fish = fish[i] as Fish; if (f.col < -5 || f.col > size.cols + 2) fish.splice(i, 1); }
      if (random() < 0.3) { const f: Fish | undefined = fish[Math.floor(random() * fish.length)]; if (f !== undefined) bubbles.push({ col: f.col + (f.right ? 4 : -1), row: f.row - 1 }); }
      for (const b of bubbles) b.row -= 1;
      for (let i: number = bubbles.length - 1; i >= 0; i--) if ((bubbles[i] as Bubble).row < 1) bubbles.splice(i, 1);
    },
    draw: (grid: Grid, palette: Palette): void => {
      const surface: string = (clock % 4 < 2 ? '~^' : '^~').repeat(grid.cols >> 1);
      grid.text(0, 0, surface, palette.cool);
      const hues: string[] = [palette.lit, palette.cool, palette.warn];
      for (const f of fish) grid.text(f.col, f.row, f.right ? '><>' : '<><', hues[f.hue] as string);
      for (const b of bubbles) grid.put(b.col, b.row, b.row % 2 === 0 ? 'o' : '.', palette.dim);
      for (let col: number = 2; col < grid.cols; col += 7) {
        const sway: number = (clock >> 2) % 2 === 0 ? 0 : 1;
        for (let h: number = 0; h < 3; h++) grid.put(col + ((h + sway) % 2), grid.rows - 2 - h, h % 2 === 0 ? '(' : ')', palette.dim);
      }
      grid.text(0, grid.rows - 1, '^'.repeat(grid.cols), palette.dim);
    },
  };
}
