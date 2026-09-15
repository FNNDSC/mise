/**
 * @file `image` — show a DICOM series or a volume, as the kernel sees it.
 *
 * `image <path>` is a KERNEL command, not a surface verb: it resolves what
 * the path is and emits an `image.view` intent for whatever surface is
 * listening. A graphical surface (ARGUS) opens a rendered pane from the
 * intent; a text surface (chell on a TTY) prints the reflection this command
 * renders. So `image ~/uploads/sag-anon` works the same from a browser and
 * from a terminal sharing one CALYPSO session.
 *
 * Usage:
 *   image [--force] <path>   a series folder, a .dcm, or a NIfTI/MGZ volume
 *
 * The path resolves to a series (via the same reader `dcm series` uses) or a
 * volume file; anything else is refused by name. `--force` rides through the
 * volume-size guard a graphical surface would otherwise hold at.
 *
 * @module
 */
import { type CommandEnvelope, envelope_ok, envelope_error, type Result } from '@fnndsc/cumin';
import { context_getSingle, dicomSeries_summarize, dicomSlice_gray, type DicomSeriesSummary, type DicomGrayOutcome } from '@fnndsc/salsa';
import { IMAGE_MODEL_KINDS, type DicomSeriesModel, type ImageViewModel } from '@fnndsc/menu';
import chalk from 'chalk';
import { commandArgs_process, path_resolve, type ParsedArgs } from '../utils.js';
import { args_checkHasHelpFlag, help_render } from '../help.js';
import { surface_get } from '../../core/surface.js';
import { series_render } from './dicom.js';
import { thumbnail_render } from './thumbnail.js';

/** Path endings a volume renderer answers to. */
const VOLUME_PATTERN: RegExp = /\.(nii|nii\.gz|mgz|mgh)$/i;
/** One DICOM file; its folder is the series. */
const DICOM_FILE_PATTERN: RegExp = /\.dcm$/i;

/**
 * Handles `image [--force] <path>`.
 *
 * @param args - The command arguments.
 * @returns An envelope carrying the reflection text and the `image.view` intent.
 */
export async function builtin_image(args: string[]): Promise<CommandEnvelope> {
  if (args_checkHasHelpFlag(args, 'image')) return envelope_ok(help_render('image'));
  const parsed: ParsedArgs = commandArgs_process(args, { booleanLongOptions: ['force'] });
  const target: string | undefined = (parsed._ as string[])[0];
  if (target === undefined) return envelope_ok(help_render('image'));
  const force: boolean = parsed.force === true;
  const resolved: string = await path_resolve(target);

  // A volume file: the intent names it; a text surface has no volume to draw.
  if (VOLUME_PATTERN.test(resolved)) {
    const name: string = resolved.split('/').pop() ?? resolved;
    const model: ImageViewModel = { path: resolved, target: 'volume', ...(force ? { force } : {}) };
    return envelope_ok(
      `${chalk.cyan('image')} ${name}\n${chalk.gray('  a volume; a graphical surface renders it, a terminal shows this line.')}\n`,
      { kind: IMAGE_MODEL_KINDS.view, data: model },
    );
  }

  // A series: the folder the path names, or the folder a .dcm sits in.
  const folder: string = DICOM_FILE_PATTERN.test(resolved) ? resolved.slice(0, resolved.lastIndexOf('/')) : resolved;
  const annotationRoot: string | undefined = await annotationRoot_get();
  const summary: Result<DicomSeriesSummary> = await dicomSeries_summarize(folder, annotationRoot !== undefined ? { annotationRoot } : {});
  if (!summary.ok) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`image: ${target}: not a readable DICOM series, study, or volume`)}\n`);
  }
  const series: DicomSeriesModel = summary.value;
  const model: ImageViewModel = { path: resolved, target: 'series', ...(force ? { force } : {}) };
  // The reflection: the same facts `dcm series` shows, under an `image` line,
  // and a thumbnail of the middle slice so a text surface shows the image too.
  const thumbnail: string = await sliceThumbnail_render(series);
  const reflection: string = `${chalk.cyan('image')} ${series.seriesDescription || folder}\n${series_render(series)}${thumbnail}`;
  return envelope_ok(reflection, { kind: IMAGE_MODEL_KINDS.view, data: model });
}

/**
 * Renders the middle slice of a series as a terminal thumbnail: an ASCII ramp,
 * or ANSI half-blocks when the surface renders colour. A slice this build
 * cannot decode (compressed pixels) says so in one line; anything else that
 * cannot be read leaves the reflection with its facts and no picture.
 *
 * @param series - The resolved series.
 * @returns The thumbnail block (leading newline), a one-line note, or empty.
 */
async function sliceThumbnail_render(series: DicomSeriesModel): Promise<string> {
  const slice: string | undefined = series.files[Math.floor(series.files.length / 2)] ?? series.header;
  if (slice === undefined) return '';
  const gray: Result<DicomGrayOutcome> = await dicomSlice_gray(slice);
  if (!gray.ok) return '';
  if (gray.value.kind === 'compressed') {
    return `\n${chalk.gray(`  (${gray.value.transferSyntax} — compressed pixels; no text preview in this build)`)}\n`;
  }
  return `\n${thumbnail_render(gray.value, surface_get().capabilities.color)}`;
}

/** Where the session's annotations live: `/home/<user>/annotations`. */
async function annotationRoot_get(): Promise<string | undefined> {
  const user: string | null = (await context_getSingle()).user;
  return user === null ? undefined : `/home/${user}/annotations`;
}
