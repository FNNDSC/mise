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
export type ImageLayout = 'single' | 'mpr' | '3d';

/** The layouts, in the order the LAYOUT block cycles them. */
export const IMAGE_LAYOUTS: readonly ImageLayout[] = ['single', 'mpr', '3d'];

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

/** What the pane lends an engine: the bar, the console, and the regard. */
export interface ImageEngineHost {
  source: ImageSource;
  /** The bar's state readout. */
  readout_set(text: string): void;
  /** One line in the console: text is first-class, an engine's events included. */
  note(line: string): void;
  /** The instance now on screen, as the pane's regard. */
  regard(path: string): void;
}

/** What is on the field, for the bar and for a smoke probe. */
export interface ImageEngineState {
  engine: 'cornerstone' | 'niivue';
  layout: ImageLayout;
  /** One-based index of the slice on screen, 0 before any. */
  slice: number;
  slices: number;
  tool: ImageTool;
  /** Slices that could not be read. */
  refused: number;
}

/** A guest engine behind the field. */
export interface ImageEngine {
  readonly name: 'cornerstone' | 'niivue';
  /** Mounts into the field and shows the first thing it can. */
  open(field: HTMLElement): Promise<void>;
  layout_set(layout: ImageLayout): Promise<boolean>;
  /** One-based. */
  slice_set(slice: number): boolean;
  wl_set(lower: number, upper: number): boolean;
  colormap_set(name: ImageColormap): boolean;
  tool_set(tool: ImageTool): boolean;
  /** The measurements on the field as a DICOM SR, or null when the engine has none to give. */
  annotations_export(): Promise<Blob | null>;
  state_get(): ImageEngineState;
  dispose(): void;
}

/** Path extensions each engine answers to. */
export const VOLUME_FILE_PATTERN: RegExp = /\.(nii|nii\.gz|mgz|mgh)$/i;
export const DICOM_FILE_PATTERN: RegExp = /\.dcm$/i;
/** How oxidicom names a series folder: `<SeriesNumber>-<description>-<7 hex of the UID hash>`. */
export const SERIES_FOLDER_PATTERN: RegExp = /^\d+-.*-[0-9a-f]{7}$/;

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
