/**
 * @file A grayscale grid as a terminal thumbnail.
 *
 * One pipeline, two renderings chosen by the surface: an ASCII ramp that any
 * pipe can print, and ANSI truecolour half-blocks (`▀`, two pixel rows per
 * character cell) for a colour terminal. The grid is box-downsampled to the
 * cell width, correcting for the ~2:1 aspect of a character cell so the image
 * is not stretched. The plain ramp is always the floor; colour is an upgrade,
 * never a requirement.
 *
 * @module
 */
import chalk from 'chalk';
import type { DicomGray } from '@fnndsc/salsa';

/** Luminance ramp, darkest to brightest; ten steps read well at thumbnail size. */
const RAMP: string = ' .:-=+*#%@';

/** How wide a thumbnail is, in character cells. */
export const THUMBNAIL_COLS: number = 44;

/**
 * Box-averages a grid into `cols`×`rows` cells of 0..255.
 *
 * @param grid - The source luminance.
 * @param cols - Target columns.
 * @param rows - Target rows.
 * @returns The downsampled cells, `out[y * cols + x]`.
 */
function downsample(grid: DicomGray, cols: number, rows: number): Float32Array {
  const { width: w, height: h, gray } = grid;
  const out: Float32Array = new Float32Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    const y0: number = Math.floor((cy * h) / rows);
    const y1: number = Math.max(y0 + 1, Math.floor(((cy + 1) * h) / rows));
    for (let cx = 0; cx < cols; cx++) {
      const x0: number = Math.floor((cx * w) / cols);
      const x1: number = Math.max(x0 + 1, Math.floor(((cx + 1) * w) / cols));
      let sum: number = 0;
      let n: number = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sum += gray[y * w + x]; n++; }
      out[cy * cols + cx] = n === 0 ? 0 : sum / n;
    }
  }
  return out;
}

/**
 * Renders a grayscale grid as an indented terminal thumbnail.
 *
 * @param grid - The slice luminance.
 * @param color - Whether the surface renders ANSI colour.
 * @param cols - Thumbnail width in cells; defaults to {@link THUMBNAIL_COLS}.
 * @returns The thumbnail, lines indented by two spaces, trailing newline.
 */
export function thumbnail_render(grid: DicomGray, color: boolean, cols: number = THUMBNAIL_COLS): string {
  // A character cell is about twice as tall as wide; halve the row count so a
  // square image stays square. Half-blocks pack two pixel rows per cell.
  const charRows: number = Math.max(1, Math.round(cols * (grid.height / grid.width) * 0.5));
  if (!color) {
    const cells: Float32Array = downsample(grid, cols, charRows);
    let out: string = '';
    for (let y = 0; y < charRows; y++) {
      let line: string = '';
      for (let x = 0; x < cols; x++) line += RAMP[Math.round((cells[y * cols + x] / 255) * (RAMP.length - 1))];
      out += `  ${line}\n`;
    }
    return out;
  }
  const cells: Float32Array = downsample(grid, cols, charRows * 2);
  let out: string = '';
  for (let y = 0; y < charRows; y++) {
    let line: string = '';
    for (let x = 0; x < cols; x++) {
      const top: number = Math.round(cells[(2 * y) * cols + x]);
      const bottom: number = Math.round(cells[(2 * y + 1) * cols + x]);
      line += chalk.bgRgb(bottom, bottom, bottom).rgb(top, top, top)('▀');
    }
    out += `  ${line}\n`;
  }
  return out;
}
