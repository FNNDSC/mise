/**
 * @file The image pane: a series or a volume on a guest engine's field,
 * inside mise's frame.
 *
 * The field is foreign — an engine draws it and owns every tool behaviour —
 * and the frame is native: one block per library tool, LAYOUT, COLORMAP,
 * SAVE and the FOCUS mark ride the pane's mode frame like every mise
 * control, and nothing sits over the image. The bar reads the slice on
 * screen, what could not be read, and the layout when it is not the
 * default. Every verb the console offers lands on the same methods the
 * blocks press.
 *
 * Focus stays in the field: a click there takes it, keys stay there, Esc
 * gives it back. The FOCUS mark says who has the keyboard.
 *
 * @module
 */
import type { DicomSeriesModel } from '@fnndsc/menu';
import {
  IMAGE_COLORMAPS,
  IMAGE_LAYOUTS,
  IMAGE_TOOLS,
  WINDOW_LEVEL_PRESETS,
  type WindowLevelPreset,
  type ImageColormap,
  type ImageEngine,
  type ImageEngineHost,
  type ImageEngineState,
  type ImageLayout,
  type ImageSource,
  type ImageTool,
  windowLevelPreset_find,
} from './engine.js';

/** Host callbacks. */
export interface ImagePanelHandlers {
  source: ImageSource;
  /** One line in the console. */
  note: (line: string) => void;
  /** The instance on screen, as this pane's regard. */
  regard: (path: string) => void;
  /** Puts bytes at a CFS path through the surface's own route; resolves to the HTTP status. */
  file_put: (path: string, body: Blob) => Promise<number>;
  /** Opens (or focuses) the tags pane that follows this one. */
  tags_open: () => void;
}

/** A sibling series in a study folder, for `image series <n>`. */
export interface SeriesChoice {
  path: string;
  label: string;
}

/** Bytes a series may reach before a volume layout waits for LOAD. */
export const VOLUME_GUARD_BYTES: number = 256 * 1024 * 1024;

/** Bytes in the nearest unit, for the bar. */
function bytes_format(bytes: number): string {
  const units: string[] = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value: number = bytes;
  let unit: number = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return unit === 0 ? `${bytes} B` : `${value.toFixed(1)} ${units[unit]}`;
}

/** The hue a modality wears on the frame. */
function modalityHue_of(modality: string): string {
  const upper: string = modality.toUpperCase();
  if (upper === 'MR' || upper === 'CT' || upper === 'PT') return upper;
  return 'OT';
}

/** The image pane controller. */
export class ImagePanel {
  private readonly pane: HTMLElement;
  private readonly field: HTMLElement;
  private readonly title: HTMLElement;
  private readonly modeSpan: HTMLElement;
  private readonly stateSpan: HTMLElement;
  private readonly layoutPill: HTMLButtonElement;
  private readonly colormapPill: HTMLButtonElement;
  private readonly savePill: HTMLButtonElement;
  private readonly loadPill: HTMLButtonElement;
  private readonly presetPill: HTMLButtonElement;
  private readonly focusMark: HTMLElement;
  /** Bytes a series may reach before MPR or 3D waits for LOAD; null turns the guard off. */
  private guardBytes: number | null = VOLUME_GUARD_BYTES;
  /** LOAD was pressed (or `--force` given) for the series on the field. */
  private forced: boolean = false;
  /** The layout LOAD will apply. */
  private pendingLayout: ImageLayout | null = null;
  private presetIndex: number = -1;
  private readonly toolPills: Map<ImageTool, HTMLButtonElement> = new Map<ImageTool, HTMLButtonElement>();
  private readonly handlers: ImagePanelHandlers;
  private engine: ImageEngine | null = null;
  private series: DicomSeriesModel | null = null;
  private siblings: SeriesChoice[] = [];
  private colormap: ImageColormap = 'gray';
  private tool: ImageTool = 'wl';

  /**
   * @param mount - The stamped pane element.
   * @param handlers - Host callbacks.
   */
  constructor(mount: HTMLElement, handlers: ImagePanelHandlers) {
    this.handlers = handlers;
    this.pane = mount;
    this.field = element_find(mount, '.image-field');
    this.title = element_find(mount, '.pane-title');
    this.modeSpan = element_find(mount, '.pane-mode');
    this.stateSpan = element_find(mount, '.pane-state');
    this.layoutPill = element_find(mount, '.image-layout') as HTMLButtonElement;
    this.colormapPill = element_find(mount, '.image-colormap') as HTMLButtonElement;
    this.savePill = element_find(mount, '.image-save') as HTMLButtonElement;
    this.loadPill = element_find(mount, '.image-load') as HTMLButtonElement;
    this.presetPill = element_find(mount, '.image-preset') as HTMLButtonElement;
    this.focusMark = element_find(mount, '.image-focus');
    this.field.tabIndex = 0;

    this.layoutPill.addEventListener('click', (): void => void this.layout_cycle());
    this.colormapPill.addEventListener('click', (): void => void this.colormap_cycle());
    this.savePill.addEventListener('click', (): void => void this.annotations_save());
    this.loadPill.addEventListener('click', (): void => void this.load_press());
    this.presetPill.addEventListener('click', (): void => this.preset_cycle());
    element_find(mount, '.image-tags').addEventListener('click', (): void => this.handlers.tags_open());
    for (const tool of IMAGE_TOOLS) {
      const pill: HTMLButtonElement = element_find(mount, `.image-tool[data-tool="${tool}"]`) as HTMLButtonElement;
      this.toolPills.set(tool, pill);
      pill.addEventListener('click', (): void => void this.tool_set(tool));
    }
    this.toolPills_paint();

    // Focus stays in the field: a click takes it, keys stay, Esc gives it
    // back. The mark on the frame says who has the keyboard.
    // The mark is painted from the gestures themselves as well as from the
    // focus events: a window without focus (a headless run, a background
    // tab) still moves activeElement but fires no focusin.
    this.field.addEventListener('mousedown', (): void => {
      this.field.focus();
      this.focusMark_paint(true);
    });
    this.field.addEventListener('focusin', (): void => this.focusMark_paint(true));
    this.field.addEventListener('focusout', (event: FocusEvent): void => {
      if (!(event.relatedTarget instanceof Node) || !this.field.contains(event.relatedTarget)) this.focusMark_paint(false);
    });
    this.field.addEventListener('keydown', (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        this.field_release();
        event.stopPropagation();
        return;
      }
      event.stopPropagation();
    });
  }

  /** Whether the field holds the keyboard. */
  public field_hasFocus(): boolean {
    return document.activeElement instanceof Node && this.field.contains(document.activeElement);
  }

  /** Gives the keyboard back. */
  public field_release(): boolean {
    if (!this.field_hasFocus()) return false;
    (document.activeElement as HTMLElement).blur();
    this.focusMark_paint(false);
    return true;
  }

  /**
   * Shows a DICOM series the kernel answered with.
   *
   * @param model - The series.
   * @param options - Sibling series for a study folder, and the slice to start at.
   */
  public async series_show(model: DicomSeriesModel, options: { siblings?: SeriesChoice[]; startAt?: number; force?: boolean } = {}): Promise<void> {
    this.engine_dispose();
    this.series = model;
    this.forced = options.force === true;
    this.pendingLayout = null;
    this.loadPill.hidden = true;
    this.presets_paint(model.modality);
    this.siblings = options.siblings ?? [];
    this.pane.dataset['modality'] = modalityHue_of(model.modality);
    this.title.textContent = `IMAGE ${model.modality.toUpperCase()} ${model.seriesDescription}`.trim();
    if (this.siblings.length > 1) {
      const at: number = this.siblings.findIndex((choice: SeriesChoice): boolean => choice.path === model.path) + 1;
      this.handlers.note(`image: series ${at} of ${this.siblings.length} in this study; image series <n> switches`);
    }
    const { CornerstoneEngine } = await import('./cornerstoneEngine.js');
    const engine: ImageEngine = new CornerstoneEngine(this.engineHost_get(), model, options.startAt ?? 1);
    await this.engine_open(engine);
    await this.annotations_reload(engine, model);
  }

  /**
   * Reads the annotation files the kernel found for the series back onto
   * the field: what was saved comes back when the series reopens.
   */
  private async annotations_reload(engine: ImageEngine, model: DicomSeriesModel): Promise<void> {
    let placed: number = 0;
    for (const path of model.annotations.filter((file: string): boolean => /\.dcm$/i.test(file))) {
      if (this.engine !== engine) return;
      const name: string = path.split('/').pop() ?? path;
      try {
        const response: Response = await fetch(this.handlers.source.url_of(path));
        if (!response.ok) {
          this.handlers.note(`image: ${name}: HTTP ${response.status}`);
          continue;
        }
        const count: number = await engine.annotations_import(await response.arrayBuffer());
        placed += count;
        this.handlers.note(count > 0 ? `image: ${count} measurement${count === 1 ? '' : 's'} from ${name}` : `image: ${name}: no measurements this engine can place`);
      } catch (error: unknown) {
        this.handlers.note(`image: ${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.pane.dataset['annotations'] = String(placed);
  }

  /**
   * Shows a NIfTI or MGZ volume.
   *
   * @param path - The volume's CFS path.
   */
  public async volume_show(path: string): Promise<void> {
    this.engine_dispose();
    this.series = null;
    this.siblings = [];
    this.pane.dataset['modality'] = 'NIFTI';
    this.title.textContent = `IMAGE ${path.split('/').pop() ?? ''}`;
    this.forced = true;
    this.loadPill.hidden = true;
    this.presets_paint('NIFTI');
    const { NiivueEngine } = await import('./niivueEngine.js');
    await this.engine_open(new NiivueEngine(this.engineHost_get(), path));
  }

  /** The sibling series a study folder offered. */
  public siblings_get(): readonly SeriesChoice[] {
    return this.siblings;
  }

  /** The series on the field, or null. */
  public series_get(): DicomSeriesModel | null {
    return this.series;
  }

  /** What is on the field, for the bar and the smoke probe. */
  public state_get(): (ImageEngineState & { colormap: ImageColormap; path: string | null; guard: number | null; waiting: ImageLayout | null }) | null {
    if (this.engine === null) return null;
    return { ...this.engine.state_get(), colormap: this.colormap, path: this.series?.path ?? null, guard: this.guardBytes, waiting: this.pendingLayout };
  }

  /**
   * Sets the layout; false when the field has no engine or it refused.
   */
  public async layout_set(layout: ImageLayout): Promise<boolean> {
    if (this.engine === null) return false;
    // A volume layout pulls every slice; over the guard it waits for LOAD.
    // The stack never asks: its first slice costs one file.
    if (layout !== 'single' && this.guard_trips()) {
      this.pendingLayout = layout;
      this.loadPill.hidden = false;
      this.stateSpan.textContent = `SERIES ${bytes_format(this.series?.bytes ?? 0)} · LOAD FOR ${layout.toUpperCase()}`;
      this.handlers.note(`image: ${bytes_format(this.series?.bytes ?? 0)} to fetch for ${layout}; press LOAD, image load, or image --force <path>`);
      return false;
    }
    const ok: boolean = await this.engine.layout_set(layout);
    if (!ok) {
      this.handlers.note(`image: layout ${layout}: not offered by ${this.engine.name}`);
      return false;
    }
    this.layoutPill.textContent = layout.toUpperCase();
    this.modeSpan.textContent = layout === 'single' ? '' : layout.toUpperCase();
    return true;
  }

  /** Whether the series on the field is over the guard and not yet consented to. */
  private guard_trips(): boolean {
    return this.guardBytes !== null && !this.forced && this.engine?.name === 'cornerstone' && (this.series?.bytes ?? 0) > this.guardBytes;
  }

  /** LOAD: consent for this series, then the layout that was waiting. */
  public async load_press(): Promise<boolean> {
    this.forced = true;
    this.loadPill.hidden = true;
    const layout: ImageLayout | null = this.pendingLayout;
    this.pendingLayout = null;
    if (layout === null) return false;
    return this.layout_set(layout);
  }

  /**
   * Sets the guard: bytes, or null for none. A readout that acts says so,
   * so the console line names the new threshold.
   */
  public guard_set(bytes: number | null): void {
    this.guardBytes = bytes;
  }

  public guard_get(): number | null {
    return this.guardBytes;
  }

  /** Cycles the modality's window presets on the PRESET block. */
  private preset_cycle(): void {
    const presets: WindowLevelPreset[] = this.presets_for(this.series?.modality ?? 'NIFTI');
    if (presets.length === 0) return;
    this.presetIndex = (this.presetIndex + 1) % presets.length;
    const preset: WindowLevelPreset | undefined = presets[this.presetIndex];
    if (preset === undefined) return;
    if (this.wl_set(preset.lower, preset.upper)) this.presetPill.textContent = preset.name.toUpperCase();
  }

  private presets_for(modality: string): WindowLevelPreset[] {
    const upper: string = modality.toUpperCase();
    return WINDOW_LEVEL_PRESETS.filter((preset: WindowLevelPreset): boolean => preset.modalities.length === 0 || preset.modalities.includes(upper));
  }

  /** The PRESET block shows only where the modality has presets: a block that cannot act is no block. */
  private presets_paint(modality: string): void {
    this.presetIndex = -1;
    const presets: WindowLevelPreset[] = this.presets_for(modality);
    this.presetPill.hidden = presets.length === 0;
    this.presetPill.textContent = 'PRESET';
  }

  public slice_set(slice: number): boolean {
    if (this.engine === null) return false;
    const ok: boolean = this.engine.slice_set(slice);
    if (!ok) this.handlers.note(`image: slice ${slice}: not offered in ${this.engine.state_get().layout} layout by ${this.engine.name}`);
    return ok;
  }

  public wl_set(lower: number, upper: number): boolean {
    if (this.engine === null) return false;
    const ok: boolean = this.engine.wl_set(lower, upper);
    if (!ok) this.handlers.note(`image: wl: not offered by ${this.engine.name}`);
    return ok;
  }

  /** A named window and level preset for the series' modality. */
  public wlPreset_set(name: string): boolean {
    const modality: string = this.series?.modality ?? 'NIFTI';
    const preset = windowLevelPreset_find(name, modality);
    if (preset === undefined) {
      this.handlers.note(`image: wl preset ${name}: none for ${modality}`);
      return false;
    }
    return this.wl_set(preset.lower, preset.upper);
  }

  public colormap_set(name: ImageColormap): boolean {
    if (this.engine === null) return false;
    const ok: boolean = this.engine.colormap_set(name);
    if (!ok) {
      this.handlers.note(`image: colormap ${name}: not offered by ${this.engine.name}`);
      return false;
    }
    this.colormap = name;
    this.colormapPill.textContent = name.toUpperCase();
    return true;
  }

  public tool_set(tool: ImageTool): boolean {
    if (this.engine === null) return false;
    const ok: boolean = this.engine.tool_set(tool);
    if (!ok) {
      this.handlers.note(`image: ${tool}: not offered by ${this.engine.name}`);
      return false;
    }
    this.tool = tool;
    this.toolPills_paint();
    return true;
  }

  /**
   * Saves the measurements on the field as a DICOM SR under
   * `~/annotations/<SeriesInstanceUID>/`, through the surface's own route.
   */
  public async annotations_save(): Promise<boolean> {
    if (this.engine === null) return false;
    const uid: string | undefined = this.series?.seriesInstanceUID;
    const home: string | undefined = /^(\/home\/[^/]+)\//.exec(this.series?.path ?? '')?.[1];
    if (uid === undefined || home === undefined) {
      this.handlers.note('image: save: this series has no UID to file an annotation under');
      return false;
    }
    const blob: Blob | null = await this.engine.annotations_export();
    if (blob === null) {
      this.handlers.note(`image: save: nothing measured, or ${this.engine.name} writes no report`);
      return false;
    }
    const target: string = `${home}/annotations/${uid}/measurements.dcm`;
    const status: number = await this.handlers.file_put(target, blob);
    this.handlers.note(status === 200 ? `✓ ${target}` : `image: save: ${target}: HTTP ${status}`);
    return status === 200;
  }

  /** Releases the field. */
  public dispose(): void {
    this.engine_dispose();
  }

  private async layout_cycle(): Promise<void> {
    const current: ImageLayout = this.engine?.state_get().layout ?? 'single';
    const next: ImageLayout = IMAGE_LAYOUTS[(IMAGE_LAYOUTS.indexOf(current) + 1) % IMAGE_LAYOUTS.length] ?? 'single';
    await this.layout_set(next);
  }

  private async colormap_cycle(): Promise<void> {
    const next: ImageColormap = IMAGE_COLORMAPS[(IMAGE_COLORMAPS.indexOf(this.colormap) + 1) % IMAGE_COLORMAPS.length] ?? 'gray';
    this.colormap_set(next);
  }

  private async engine_open(engine: ImageEngine): Promise<void> {
    this.engine = engine;
    this.field.replaceChildren();
    this.layoutPill.textContent = 'SINGLE';
    this.modeSpan.textContent = '';
    this.colormapPill.textContent = this.colormap.toUpperCase();
    try {
      await engine.open(this.field);
    } catch (error: unknown) {
      this.stateSpan.textContent = 'REFUSED';
      this.handlers.note(`image: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const layout: ImageLayout = engine.state_get().layout;
    this.layoutPill.textContent = layout.toUpperCase();
    this.modeSpan.textContent = layout === 'single' ? '' : layout.toUpperCase();
    engine.tool_set(this.tool);
    this.toolPills_paint();
  }

  private engine_dispose(): void {
    this.engine?.dispose();
    this.engine = null;
    this.field.replaceChildren();
    this.stateSpan.textContent = '';
  }

  private engineHost_get(): ImageEngineHost {
    return {
      source: this.handlers.source,
      readout_set: (text: string): void => {
        this.stateSpan.textContent = text;
      },
      note: this.handlers.note,
      regard: this.handlers.regard,
    };
  }

  private toolPills_paint(): void {
    for (const [tool, pill] of this.toolPills) pill.classList.toggle('rail-off', tool !== this.tool);
  }

  private focusMark_paint(on: boolean): void {
    this.focusMark.hidden = !on;
    this.pane.classList.toggle('image-field-focused', on);
  }
}

function element_find(mount: HTMLElement, selector: string): HTMLElement {
  const found: HTMLElement | null = mount.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`image pane: missing ${selector}`);
  return found;
}
