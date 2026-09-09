/**
 * @file Cornerstone3D behind the image field: a DICOM series as a lazy
 * stack, a streamed volume in three linked planes, or a 3D render.
 *
 * Every tool behaviour here is the library's own (window and level, scroll,
 * zoom, pan, length, angle, probe, crosshairs); this file binds them and
 * reports. Image ids are `wadouri:` over the `/vfs` route mise serves, one
 * file each, so the first slice is on screen after one fetch and the rest
 * follow the wheel. A volume needs every slice before it exists, and the
 * bar says so while it loads.
 *
 * The measurement report adapter asks who an image is; mise answers from its
 * own series model and the file's name, never from the loader's memory.
 *
 * @module
 */
import type { DicomSeriesModel } from '@fnndsc/menu';
import {
  IMAGE_TOOLS,
  type ImageColormap,
  type ImageEngine,
  type ImageEngineHost,
  type ImageEngineState,
  type ImageLayout,
  type ImageTool,
} from './engine.js';

type Cornerstone = typeof import('@cornerstonejs/core');
type CornerstoneTools = typeof import('@cornerstonejs/tools');
type DicomLoader = typeof import('@cornerstonejs/dicom-image-loader');

/** The three libraries, loaded once per page, only when an image pane asks. */
interface Loaded {
  core: Cornerstone;
  tools: CornerstoneTools;
  loader: DicomLoader;
}

let loaded: Promise<Loaded> | null = null;

/** Loads and initialises Cornerstone3D once for the page. */
function cornerstone_load(): Promise<Loaded> {
  if (loaded === null) {
    loaded = (async (): Promise<Loaded> => {
      const [core, tools, loader] = await Promise.all([
        import('@cornerstonejs/core'),
        import('@cornerstonejs/tools'),
        import('@cornerstonejs/dicom-image-loader'),
      ]);
      await core.init();
      loader.init({ maxWebWorkers: 2 });
      tools.init();
      for (const tool of [
        tools.StackScrollTool,
        tools.WindowLevelTool,
        tools.ZoomTool,
        tools.PanTool,
        tools.LengthTool,
        tools.AngleTool,
        tools.ProbeTool,
        tools.CrosshairsTool,
        tools.TrackballRotateTool,
      ]) {
        tools.addTool(tool);
      }
      return { core, tools, loader };
    })();
  }
  return loaded;
}

/** Cornerstone's own names for the pane's colormaps (vtk.js colour maps). */
const COLORMAP_NAMES: Readonly<Record<ImageColormap, string>> = {
  gray: 'Grayscale',
  hot: 'Black-Body Radiation',
  jet: 'jet',
  cool: 'Cool to Warm',
};

/** Which library tool each pane tool names. */
const TOOL_NAMES: Readonly<Record<ImageTool, string>> = {
  wl: 'WindowLevel',
  zoom: 'Zoom',
  pan: 'Pan',
  length: 'Length',
  angle: 'Angle',
  probe: 'Probe',
};

let engineSerial: number = 0;

/** Cornerstone3D as the image engine. */
export class CornerstoneEngine implements ImageEngine {
  public readonly name = 'cornerstone' as const;
  private readonly host: ImageEngineHost;
  private readonly series: DicomSeriesModel;
  private readonly serial: number = engineSerial++;
  private readonly imageIds: string[];
  private readonly pathByImageId: Map<string, string> = new Map<string, string>();
  private libraries: Loaded | null = null;
  private field: HTMLElement | null = null;
  private renderingEngine: import('@cornerstonejs/core').RenderingEngine | null = null;
  private layout: ImageLayout = 'single';
  private tool: ImageTool = 'wl';
  private slice: number = 0;
  private readonly refused: Set<string> = new Set<string>();
  private startAt: number;
  private disposed: boolean = false;
  private metadataRegistered: boolean = false;

  /**
   * @param host - The pane's lendings.
   * @param series - The series the kernel answered with.
   * @param startAt - The one-based slice to show first.
   */
  constructor(host: ImageEngineHost, series: DicomSeriesModel, startAt: number = 1) {
    this.host = host;
    this.series = series;
    this.startAt = Math.max(1, Math.min(startAt, series.files.length));
    // One file, many frames: each frame is an image id of its own.
    this.imageIds = series.files.length === 1 && series.frames > 1
      ? Array.from({ length: series.frames }, (_, frame: number): string => `wadouri:${location.origin}${host.source.url_of(series.files[0] ?? '')}&frame=${frame}`)
      : series.files.map((path: string): string => `wadouri:${location.origin}${host.source.url_of(path)}`);
    this.imageIds.forEach((imageId: string, index: number): void => {
      this.pathByImageId.set(imageId, series.files.length === 1 ? (series.files[0] ?? '') : (series.files[index] ?? ''));
    });
  }

  public async open(field: HTMLElement): Promise<void> {
    this.field = field;
    this.host.readout_set(`LOADING 1 OF ${this.imageIds.length}`);
    this.libraries = await cornerstone_load();
    if (this.disposed) return;
    this.metadata_register();
    this.loadFailures_watch();
    await this.stack_show();
  }

  public async layout_set(layout: ImageLayout): Promise<boolean> {
    if (this.libraries === null || this.field === null) return false;
    if (layout === this.layout) return true;
    if (layout === 'single') {
      await this.stack_show();
      return true;
    }
    await this.volume_show(layout);
    return true;
  }

  public slice_set(slice: number): boolean {
    if (this.layout !== 'single' || this.renderingEngine === null) return false;
    const viewport = this.stackViewport_get();
    if (viewport === null) return false;
    const index: number = Math.max(0, Math.min(slice - 1, this.imageIds.length - 1));
    void viewport.setImageIdIndex(index);
    return true;
  }

  public wl_set(lower: number, upper: number): boolean {
    if (this.renderingEngine === null) return false;
    for (const viewport of this.renderingEngine.getViewports()) {
      (viewport as { setProperties?: (properties: { voiRange: { lower: number; upper: number } }) => void }).setProperties?.({ voiRange: { lower, upper } });
      viewport.render();
    }
    return true;
  }

  public colormap_set(name: ImageColormap): boolean {
    if (this.renderingEngine === null) return false;
    const colormap: string = COLORMAP_NAMES[name];
    for (const viewport of this.renderingEngine.getViewports()) {
      try {
        (viewport as { setProperties?: (properties: { colormap: { name: string } }) => void }).setProperties?.({ colormap: { name: colormap } });
        viewport.render();
      } catch {
        return false;
      }
    }
    return true;
  }

  public tool_set(tool: ImageTool): boolean {
    if (this.libraries === null) return false;
    const group = this.libraries.tools.ToolGroupManager.getToolGroup(this.toolGroupId_get());
    if (group === undefined) return false;
    const bindings = this.libraries.tools.Enums.MouseBindings;
    for (const other of IMAGE_TOOLS) {
      if (other !== tool) group.setToolPassive(TOOL_NAMES[other]);
    }
    group.setToolActive(TOOL_NAMES[tool], { bindings: [{ mouseButton: bindings.Primary }] });
    this.tool = tool;
    return true;
  }

  public async annotations_export(): Promise<Blob | null> {
    if (this.libraries === null) return null;
    const { tools, core } = this.libraries;
    const annotations = tools.annotation.state.getAllAnnotations();
    if (annotations.length === 0) return null;
    // The adapter wants annotations grouped by image id, then by tool.
    const toolState: Record<string, Record<string, unknown[]>> = {};
    for (const entry of annotations as Array<{ metadata: { referencedImageId?: string; toolName: string } }>) {
      const imageId: string = entry.metadata.referencedImageId ?? '';
      if (!this.pathByImageId.has(imageId)) continue;
      const byTool: Record<string, unknown[]> = (toolState[imageId] ??= {});
      (byTool[entry.metadata.toolName] ??= []).push(entry);
    }
    if (Object.keys(toolState).length === 0) return null;
    const { adaptersSR } = await import('@cornerstonejs/adapters');
    const report = adaptersSR.Cornerstone3D.MeasurementReport.generateReport(toolState, core.metaData, {}) as { dataset: Record<string, unknown> };
    // dcmjs's writer reaches for Node's Buffer; the browser gets the polyfill.
    if ((globalThis as { Buffer?: unknown }).Buffer === undefined) {
      (globalThis as { Buffer?: unknown }).Buffer = (await import('buffer')).Buffer;
    }
    const dcmjs = (await import('dcmjs')).default;
    return dcmjs.data.datasetToBlob(report.dataset);
  }

  public state_get(): ImageEngineState {
    return {
      engine: 'cornerstone',
      layout: this.layout,
      slice: this.slice,
      slices: this.imageIds.length,
      tool: this.tool,
      refused: this.refused.size,
    };
  }

  public dispose(): void {
    this.disposed = true;
    this.field_clear();
    this.field = null;
  }

  /**
   * Tells the metadata layer who each image is, from mise's own knowledge:
   * the series model names the series and study, oxidicom's file name
   * carries the SOPInstanceUID. The SR adapter asks exactly this.
   */
  private metadata_register(): void {
    if (this.metadataRegistered || this.libraries === null) return;
    this.metadataRegistered = true;
    const series: DicomSeriesModel = this.series;
    const sopByImageId: Map<string, string> = new Map<string, string>();
    for (const [imageId, path] of this.pathByImageId) {
      const name: string = path.split('/').pop() ?? '';
      const fromName: string | undefined = /^\d+-(.+)\.dcm$/i.exec(name)?.[1];
      sopByImageId.set(imageId, fromName ?? `${series.seriesInstanceUID ?? '0'}.${sopByImageId.size + 1}`);
    }
    const sopClass: string = '1.2.840.10008.5.1.4.1.1.4';
    this.libraries.core.metaData.addProvider((type: string, imageId: string): unknown => {
      const sop: string | undefined = sopByImageId.get(imageId);
      if (sop === undefined) return undefined;
      if (type === 'sopCommonModule') return { sopInstanceUID: sop, sopClassUID: sopClass };
      if (type === 'instance') {
        return {
          SOPInstanceUID: sop,
          SOPClassUID: sopClass,
          SeriesInstanceUID: series.seriesInstanceUID ?? '',
          StudyInstanceUID: series.studyInstanceUID ?? '',
          Modality: series.modality,
          SeriesDescription: series.seriesDescription,
          SeriesNumber: series.seriesNumber ?? 0,
          PatientID: '',
          PatientName: '',
          StudyDate: '',
          StudyTime: '',
          AccessionNumber: '',
          StudyID: '',
        };
      }
      return undefined;
    }, 10_000);
  }

  /** A slice that cannot be read is counted and named; the canvas is never left blank without a word. */
  private loadFailures_watch(): void {
    if (this.libraries === null) return;
    const { core } = this.libraries;
    core.eventTarget.addEventListener(core.Enums.Events.IMAGE_LOAD_FAILED, (event: Event): void => {
      const detail: { imageId?: string; error?: { message?: string } } = (event as CustomEvent).detail ?? {};
      if (detail.imageId === undefined || !this.pathByImageId.has(detail.imageId)) return;
      this.refused.add(detail.imageId);
      const message: string = detail.error?.message ?? '';
      const syntax: string | undefined = /transfer syntax[^0-9]*([0-9.]+)/i.exec(message)?.[1];
      this.host.readout_set(
        syntax !== undefined
          ? `UNSUPPORTED TRANSFER SYNTAX ${syntax}`
          : `REFUSED ${this.refused.size} OF ${this.imageIds.length}`,
      );
      this.host.note(`image: ${this.pathByImageId.get(detail.imageId) ?? detail.imageId}: ${message || 'could not be read'}`);
    });
  }

  private engineId_get(): string {
    return `image-${this.serial}`;
  }

  private toolGroupId_get(): string {
    return `${this.engineId_get()}-${this.layout}`;
  }

  private stackViewport_get(): import('@cornerstonejs/core').Types.IStackViewport | null {
    if (this.renderingEngine === null) return null;
    const viewport = this.renderingEngine.getViewport(`${this.engineId_get()}-stack`);
    return (viewport as import('@cornerstonejs/core').Types.IStackViewport | undefined) ?? null;
  }

  /** One stack viewport: the first slice after one file, the rest on the wheel. */
  private async stack_show(): Promise<void> {
    if (this.libraries === null || this.field === null) return;
    const { core, tools } = this.libraries;
    this.field_clear();
    this.layout = 'single';
    const element: HTMLDivElement = this.viewport_make('stack');
    const engineId: string = this.engineId_get();
    const viewportId: string = `${engineId}-stack`;
    this.renderingEngine = new core.RenderingEngine(engineId);
    this.renderingEngine.enableElement({ viewportId, type: core.Enums.ViewportType.STACK, element });
    const viewport = this.renderingEngine.getViewport(viewportId) as import('@cornerstonejs/core').Types.IStackViewport;
    element.addEventListener(core.Enums.Events.STACK_NEW_IMAGE, (event: Event): void => {
      const detail: { imageIdIndex: number; imageId: string } = (event as CustomEvent).detail;
      this.slice = detail.imageIdIndex + 1;
      const path: string = this.pathByImageId.get(detail.imageId) ?? '';
      this.host.readout_set(`SLICE ${this.slice} OF ${this.imageIds.length}${this.refused.size > 0 ? ` · REFUSED ${this.refused.size}` : ''}`);
      this.host.regard(path);
    });
    const started: number = performance.now();
    await viewport.setStack(this.imageIds, this.startAt - 1);
    viewport.render();
    if (this.disposed) return;
    this.host.note(`image: ${this.imageIds.length} slices, first on screen in ${Math.round(performance.now() - started)} ms`);
    const group = tools.ToolGroupManager.getToolGroup(this.toolGroupId_get()) ?? tools.ToolGroupManager.createToolGroup(this.toolGroupId_get());
    if (group === undefined) return;
    for (const name of Object.values(TOOL_NAMES)) group.addTool(name);
    group.addTool(tools.StackScrollTool.toolName);
    group.addViewport(viewportId, engineId);
    const bindings = tools.Enums.MouseBindings;
    group.setToolActive(tools.StackScrollTool.toolName, { bindings: [{ mouseButton: bindings.Wheel }] });
    group.setToolActive(TOOL_NAMES[this.tool], { bindings: [{ mouseButton: bindings.Primary }] });
    group.setToolActive(TOOL_NAMES.zoom, { bindings: [{ mouseButton: bindings.Secondary }] });
    group.setToolActive(TOOL_NAMES.pan, { bindings: [{ mouseButton: bindings.Auxiliary }] });
  }

  /** Three linked planes, or one 3D render, over a volume streamed slice by slice. */
  private async volume_show(layout: 'mpr' | '3d'): Promise<void> {
    if (this.libraries === null || this.field === null) return;
    const { core, tools } = this.libraries;
    const started: number = performance.now();
    this.host.readout_set(`LOADING ${this.imageIds.length} SLICES FOR ${layout.toUpperCase()}`);
    // A volume exists only once every header is known; the loader learns
    // them by loading. This is the cost the LOAD guard stands in front of.
    await Promise.all(this.imageIds.map((imageId: string): Promise<unknown> => core.imageLoader.loadAndCacheImage(imageId).catch((): null => null)));
    if (this.disposed) return;
    this.field_clear();
    this.layout = layout;
    const engineId: string = this.engineId_get();
    const volumeId: string = `cornerstoneStreamingImageVolume:${engineId}`;
    const grid: HTMLElement = document.createElement('div');
    grid.className = layout === 'mpr' ? 'image-mpr' : 'image-render';
    this.field.appendChild(grid);
    const planes: Array<[string, import('@cornerstonejs/core').Enums.OrientationAxis | undefined]> = layout === 'mpr'
      ? [['axial', core.Enums.OrientationAxis.AXIAL], ['coronal', core.Enums.OrientationAxis.CORONAL], ['sagittal', core.Enums.OrientationAxis.SAGITTAL]]
      : [['render', undefined]];
    this.renderingEngine = new core.RenderingEngine(engineId);
    const inputs = planes.map(([name, orientation]) => {
      const element: HTMLDivElement = document.createElement('div');
      element.className = `image-viewport image-viewport-${name}`;
      grid.appendChild(element);
      return {
        viewportId: `${engineId}-${name}`,
        type: layout === 'mpr' ? core.Enums.ViewportType.ORTHOGRAPHIC : core.Enums.ViewportType.VOLUME_3D,
        element,
        ...(orientation !== undefined ? { defaultOptions: { orientation } } : {}),
      };
    });
    this.renderingEngine.setViewports(inputs);
    const volume = await core.volumeLoader.createAndCacheVolume(volumeId, { imageIds: this.imageIds });
    void (volume as { load: () => void }).load();
    const viewportIds: string[] = inputs.map((input): string => input.viewportId);
    await core.setVolumesForViewports(this.renderingEngine, [{ volumeId }], viewportIds);
    if (layout === '3d') {
      const render = this.renderingEngine.getViewport(viewportIds[0] ?? '') as { setProperties?: (properties: { preset: string }) => void } | undefined;
      render?.setProperties?.({ preset: this.series.modality.toUpperCase() === 'CT' ? 'CT-Bone' : 'MR-Default' });
    }
    const group = tools.ToolGroupManager.getToolGroup(this.toolGroupId_get()) ?? tools.ToolGroupManager.createToolGroup(this.toolGroupId_get());
    if (group === undefined) return;
    const bindings = tools.Enums.MouseBindings;
    for (const viewportId of viewportIds) group.addViewport(viewportId, engineId);
    if (layout === 'mpr') {
      group.addTool(tools.CrosshairsTool.toolName, {
        getReferenceLineColor: (id: string): string => (id.endsWith('axial') ? 'rgb(200, 0, 0)' : id.endsWith('coronal') ? 'rgb(200, 200, 0)' : 'rgb(0, 200, 0)'),
      });
      group.addTool(tools.StackScrollTool.toolName);
      group.addTool(TOOL_NAMES.zoom);
      group.setToolActive(tools.CrosshairsTool.toolName, { bindings: [{ mouseButton: bindings.Primary }] });
      group.setToolActive(tools.StackScrollTool.toolName, { bindings: [{ mouseButton: bindings.Wheel }] });
      group.setToolActive(TOOL_NAMES.zoom, { bindings: [{ mouseButton: bindings.Secondary }] });
      for (const input of inputs) {
        input.element.addEventListener(core.Enums.Events.VOLUME_NEW_IMAGE, (event: Event): void => {
          const detail: { imageIndex?: number } = (event as CustomEvent).detail;
          this.host.readout_set(`MPR ${input.viewportId.split('-').pop()?.toUpperCase() ?? ''} ${detail.imageIndex ?? ''}`);
        });
      }
    } else {
      group.addTool(tools.TrackballRotateTool.toolName);
      group.addTool(TOOL_NAMES.zoom);
      group.setToolActive(tools.TrackballRotateTool.toolName, { bindings: [{ mouseButton: bindings.Primary }] });
      group.setToolActive(TOOL_NAMES.zoom, { bindings: [{ mouseButton: bindings.Secondary }] });
    }
    this.renderingEngine.renderViewports(viewportIds);
    // The layout is the bar's mode annunciation; the state reads the count.
    this.host.readout_set(`${this.imageIds.length} SLICES${this.refused.size > 0 ? ` · REFUSED ${this.refused.size}` : ''}`);
    this.host.note(`image: ${layout} up in ${Math.round(performance.now() - started)} ms`);
  }

  private viewport_make(name: string): HTMLDivElement {
    const element: HTMLDivElement = document.createElement('div');
    element.className = `image-viewport image-viewport-${name}`;
    this.field?.appendChild(element);
    return element;
  }

  private field_clear(): void {
    if (this.renderingEngine !== null && this.libraries !== null) {
      for (const layout of ['single', 'mpr', '3d']) {
        this.libraries.tools.ToolGroupManager.destroyToolGroup(`${this.engineId_get()}-${layout}`);
      }
      this.renderingEngine.destroy();
      this.renderingEngine = null;
    }
    this.field?.replaceChildren();
  }
}
