/**
 * @file The seam between the image pane and the guest engine that draws.
 *
 * The pane owns the frame, the bar, the verbs, focus and hue; an engine owns
 * the field: pixels, tools and their behaviours. Two engines stand behind
 * this one interface — Cornerstone3D for DICOM series, niivue for NIfTI and
 * MGZ volumes — and the pane never asks which one it holds beyond what the
 * interface answers. A verb an engine cannot honour returns false and the
 * bar says so by name; nothing goes silent.
 *
 * Bytes reach an engine through mise only: `ImageSource` turns a CFS path
 * into the token-gated `/vfs` URL, and the DICOM engine wears it as a
 * `wadouri:` image id. When CUBE's DICOMweb lands, this is the one place
 * that changes.
 *
 * @module
 */

/** How the field is laid out. */
export type ImageLayout = 'single' | 'mpr' | '3d' | 'slab';

/** The layouts, in the order the LAYOUT block cycles them. */
export const IMAGE_LAYOUTS: readonly ImageLayout[] = ['single', 'mpr', '3d', 'slab'];

/** A tool bound to the primary mouse button. */
export type ImageTool = 'wl' | 'zoom' | 'pan' | 'length' | 'angle' | 'probe';

/** The tools, in block order. Behaviour is the engine's; the pane draws one button per name. */
export const IMAGE_TOOLS: readonly ImageTool[] = ['wl', 'zoom', 'pan', 'length', 'angle', 'probe'];

/** The colormaps a pane offers by name. Each engine maps them to its own. */
export type ImageColormap = 'gray' | 'hot' | 'jet' | 'cool';

export const IMAGE_COLORMAPS: readonly ImageColormap[] = ['gray', 'hot', 'jet', 'cool'];

/** A window and level preset: a range in the image's own units. */
export interface WindowLevelPreset {
  name: string;
  lower: number;
  upper: number;
  /** Modalities the preset belongs to; empty means any. */
  modalities: readonly string[];
}

/** Presets by modality. CT in Hounsfield units; MR has none that generalise. */
export const WINDOW_LEVEL_PRESETS: readonly WindowLevelPreset[] = [
  { name: 'brain', lower: 0, upper: 80, modalities: ['CT'] },
  { name: 'bone', lower: -500, upper: 1300, modalities: ['CT'] },
  { name: 'lung', lower: -1400, upper: 200, modalities: ['CT'] },
  { name: 'soft', lower: -160, upper: 240, modalities: ['CT'] },
  { name: 'liver', lower: -10, upper: 140, modalities: ['CT'] },
];

/** Where an engine's bytes come from: mise, and only mise. */
export interface ImageSource {
  /** The token-gated URL that serves one CFS path. */
  url_of(path: string): string;
}

/**
 * What a load looks like while it is happening.
 *
 * `total` of zero means the work is real but uncountable — a single file
 * arriving over a wire whose length nobody stated — and the field shows
 * motion without a fraction rather than a bar that would be a guess.
 */
export interface ImageProgress {
  /** What is being done, in the frame's own voice: `BUILDING MPR`. */
  label: string;
  done: number;
  total: number;
}

/** What the pane lends an engine: the bar, the console, and the regard. */
export interface ImageEngineHost {
  source: ImageSource;
  /** The bar's state readout. */
  readout_set(text: string): void;
  /**
   * Says the field is working, and how far along.
   *
   * Null takes the notice away. An engine that fetches a whole series
   * before it can draw anything MUST say so: a viewer that holds the
   * previous image on screen while it works is indistinguishable from one
   * that has ignored the press.
   */
  progress_set(progress: ImageProgress | null): void;
  /** One line in the console: text is first-class, an engine's events included. */
  note(line: string): void;
  /** The instance now on screen, as the pane's regard. */
  regard(path: string): void;
  /**
   * The probe's live reading under the pointer, or null when there is none.
   *
   * A probe is a readout, not a mark: it says what is under the pointer
   * while the pointer is there. Position in the image's own indices, the
   * slice, and the value in the modality's unit.
   */
  probe_set(text: string | null): void;
}

/** What is on the field, for the bar and for a smoke probe. */
export interface ImageEngineState {
  engine: 'cornerstone' | 'niivue';
  layout: ImageLayout;
  /** One-based index of the slice on screen, 0 before any. */
  slice: number;
  slices: number;
  tool: ImageTool;
  /** The tool on the primary drag, or null when the layout's own gesture (MPR crosshair, 3D trackball) holds it. */
  primaryTool: ImageTool | null;
  /** Slices that could not be read. */
  refused: number;
  /** Measurements on the field, drawn or reloaded. */
  annotations: number;
  /**
   * Every slice is on hand. A stack that is still arriving does not scroll:
   * a wheel that lands on a slice not yet fetched shows a gap, and a series
   * that appears in pieces is not a series.
   */
  filled: boolean;
}

/** A guest engine behind the field. */
export interface ImageEngine {
  readonly name: 'cornerstone' | 'niivue';
  /** Mounts into the field and shows the first thing it can. */
  open(field: HTMLElement): Promise<void>;
  layout_set(layout: ImageLayout): Promise<boolean>;
  /**
   * The strength of the SLAB layout's ghost volume, 0..1, or null to hide it.
   * False when the engine has no SLAB. The default is set when SLAB opens.
   */
  ghost_set(level: number | null): boolean;
  /**
   * Fetches every slice the field does not yet hold, saying how far along
   * on the way, and unlocks the scroll when the last one lands. True once
   * the stack is whole; false when the engine has no stack to fill.
   */
  slices_fill(): Promise<boolean>;
  /** One-based. Refused while the stack is still arriving. */
  slice_set(slice: number): boolean;
  wl_set(lower: number, upper: number): boolean;
  colormap_set(name: ImageColormap): boolean;
  tool_set(tool: ImageTool): boolean;
  /** Which frame tools apply to what is on the field now (a render offers fewer than a stack). */
  toolsOffered_get(): readonly ImageTool[];
  /** The measurements on the field as a DICOM SR, or null when the engine has none to give. */
  annotations_export(): Promise<Blob | null>;
  /** Reads a DICOM SR's measurements onto the field; resolves to how many it could place. */
  annotations_import(bytes: ArrayBuffer): Promise<number>;
  state_get(): ImageEngineState;
  dispose(): void;
}

/** Path extensions each engine answers to. */
export const VOLUME_FILE_PATTERN: RegExp = /\.(nii|nii\.gz|mgz|mgh)$/i;
export const DICOM_FILE_PATTERN: RegExp = /\.dcm$/i;
/** How oxidicom names a series folder: `<SeriesNumber>-<description>-<7 hex of the UID hash>`. */
export const SERIES_FOLDER_PATTERN: RegExp = /^\d+-.*-[0-9a-f]{7}$/;

/** Where CUBE keeps what a PACS has sent. */
export const PACS_TREE_ROOT: string = '/SERVICES/PACS/';

/** How deep a series sits under that root: server, patient, study, series. */
const PACS_SERIES_DEPTH: number = 4;

/**
 * Whether a directory holds one series.
 *
 * Two ways to know, and neither costs a look inside. The NAME is one:
 * oxidicom writes a series folder in a shape nothing else does. The PLACE
 * is the other: inside the PACS tree the depth says what a folder is, so a
 * series stored under some other naming is still a series, and the study
 * above it is still not one.
 *
 * Deliberately not: reading the folder to find out. A verb offered only
 * after a listing of every row's contents is a verb that costs one request
 * per row before the operator has pressed anything.
 *
 * @param path - The folder's full CFS path.
 * @param name - Its own name, the last segment.
 * @returns True when the folder is one series.
 */
export function seriesFolder_is(path: string, name: string): boolean {
  if (SERIES_FOLDER_PATTERN.test(name)) return true;
  if (!path.startsWith(PACS_TREE_ROOT)) return false;
  const below: string = path.slice(PACS_TREE_ROOT.length).replace(/\/+$/, '');
  return below !== '' && below.split('/').length === PACS_SERIES_DEPTH;
}

/**
 * The preset for a name and modality, or undefined.
 *
 * @param name - The preset name, any case.
 * @param modality - The series' modality.
 * @returns The preset, when it exists for that modality.
 */
export function windowLevelPreset_find(name: string, modality: string): WindowLevelPreset | undefined {
  const wanted: string = name.toLowerCase();
  return WINDOW_LEVEL_PRESETS.find(
    (preset: WindowLevelPreset): boolean =>
      preset.name === wanted && (preset.modalities.length === 0 || preset.modalities.includes(modality.toUpperCase())),
  );
}
