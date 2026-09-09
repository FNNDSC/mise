/**
 * @file THROWAWAY PROTOTYPE — the `image` pane with two guest engines.
 *
 * Never merged. Exists to answer, on real bytes over `/vfs`, the questions
 * the renderer evaluation could not answer from source alone: does a
 * Cornerstone3D stack scroll after one file, does its MPR crosshair link,
 * does its image-changed event reach mise, does the field keep the wheel
 * and the keys, do measurement bytes come out as SR; and does niivue draw
 * a NIfTI over the same route. Findings go to
 * docs/dicom-renderer-evaluation.adoc; this file goes nowhere.
 *
 * @module
 */
import {
  init as coreInit,
  RenderingEngine,
  Enums as CoreEnums,
  volumeLoader,
  imageLoader,
  setVolumesForViewports,
  cache,
  metaData,
  type Types as CoreTypes,
} from '@cornerstonejs/core';
import {
  init as toolsInit,
  addTool,
  ToolGroupManager,
  StackScrollTool,
  WindowLevelTool,
  ZoomTool,
  PanTool,
  LengthTool,
  CrosshairsTool,
  Enums as ToolEnums,
  annotation,
} from '@cornerstonejs/tools';
import { init as dicomLoaderInit } from '@cornerstonejs/dicom-image-loader';
import { adaptersSR } from '@cornerstonejs/adapters';
import type { DicomSeriesModel } from '@fnndsc/menu';

/** Host callbacks. */
export interface ImagePanelHandlers {
  /** Builds the token-gated `/vfs` URL for a path. */
  vfsUrl_build: (path: string) => string;
  /** Writes one line to the console, so an event is seen where text is first-class. */
  console_note: (line: string) => void;
}

/** What is on the field. */
type Engine = 'none' | 'stack' | 'mpr' | 'niivue';

let engineReady: Promise<void> | null = null;

/** Initialises Cornerstone3D once for the page. */
function cornerstone_ready(): Promise<void> {
  if (engineReady === null) {
    engineReady = (async (): Promise<void> => {
      await coreInit();
      dicomLoaderInit({ maxWebWorkers: 2 });
      toolsInit();
      addTool(StackScrollTool);
      addTool(WindowLevelTool);
      addTool(ZoomTool);
      addTool(PanTool);
      addTool(LengthTool);
      addTool(CrosshairsTool);
    })();
  }
  return engineReady;
}

let paneSerial: number = 0;

/** The prototype pane controller. */
export class ImagePanel {
  private readonly field: HTMLElement;
  private readonly title: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly handlers: ImagePanelHandlers;
  private readonly serial: number = paneSerial++;
  private engine: Engine = 'none';
  private renderingEngine: RenderingEngine | null = null;
  private imageIds: string[] = [];
  private series: DicomSeriesModel | null = null;
  private niivue: unknown = null;

  constructor(mount: HTMLElement, handlers: ImagePanelHandlers) {
    this.handlers = handlers;
    this.field = element_find(mount, '.image-field');
    this.title = element_find(mount, '.image-title');
    this.readout = element_find(mount, '.image-readout');
    this.field.tabIndex = 0;
    element_find(mount, '.image-go-stack').addEventListener('click', (): void => void this.stack_show());
    element_find(mount, '.image-go-mpr').addEventListener('click', (): void => void this.mpr_show());
    element_find(mount, '.image-go-wl').addEventListener('click', (): void => this.primary_set(WindowLevelTool.toolName));
    element_find(mount, '.image-go-zoom').addEventListener('click', (): void => this.primary_set(ZoomTool.toolName));
    element_find(mount, '.image-go-pan').addEventListener('click', (): void => this.primary_set(PanTool.toolName));
    element_find(mount, '.image-go-length').addEventListener('click', (): void => this.primary_set(LengthTool.toolName));
    element_find(mount, '.image-go-sr').addEventListener('click', (): void => void this.sr_export());
    // Focus containment probe: the field takes focus on click and reports
    // keys it receives; whether the console also saw them is the finding.
    this.field.addEventListener('mousedown', (): void => this.field.focus());
    this.field.addEventListener('keydown', (event: KeyboardEvent): void => {
      this.handlers.console_note(`image: field saw key ${event.key}`);
      event.stopPropagation();
    });
  }

  /** The pane was claimed by a `dicom.series` envelope. */
  async series_show(model: DicomSeriesModel): Promise<void> {
    this.series = model;
    this.title.textContent = `IMAGE ${model.modality} ${model.seriesDescription}`.trim();
    this.imageIds = model.files.map((path: string): string => `wadouri:${location.origin}${this.handlers.vfsUrl_build(path)}`);
    // The SR adapter asks the metadata layer who an image is. mise already
    // knows: the kernel's series model names the series and study, and
    // oxidicom's file name carries the SOPInstanceUID. This provider is the
    // seam S5 would build on; the wadouri loader's own answer arrives only
    // after a load and, in this build, not for `sopCommonModule` at all.
    const uidByImageId: Map<string, string> = new Map<string, string>();
    model.files.forEach((path: string, index: number): void => {
      const name: string = path.split('/').pop() ?? '';
      const sop: string = /^\d+-(.+)\.dcm$/i.exec(name)?.[1] ?? `${model.seriesInstanceUID ?? '0'}.${index + 1}`;
      uidByImageId.set(this.imageIds[index] ?? '', sop);
    });
    metaData.addProvider((type: string, imageId: string): unknown => {
      const sop: string | undefined = uidByImageId.get(imageId);
      if (sop === undefined) return undefined;
      if (type === 'sopCommonModule') return { sopInstanceUID: sop, sopClassUID: '1.2.840.10008.5.1.4.1.1.4' };
      if (type === 'instance') {
        return {
          SOPInstanceUID: sop,
          SOPClassUID: '1.2.840.10008.5.1.4.1.1.4',
          SeriesInstanceUID: model.seriesInstanceUID ?? '',
          StudyInstanceUID: model.studyInstanceUID ?? '',
          Modality: model.modality,
          SeriesDescription: model.seriesDescription,
          PatientID: 'SYNTH', PatientName: 'SYNTH', StudyDate: '20260909', StudyTime: '000000', AccessionNumber: '', StudyID: '', SeriesNumber: model.seriesNumber ?? 0,
        };
      }
      return undefined;
    }, 10_000);
    await this.stack_show();
  }

  /** A NIfTI or MGZ path: niivue draws it. */
  async volume_show(path: string): Promise<void> {
    this.field_clear();
    this.engine = 'niivue';
    this.title.textContent = `IMAGE NIFTI ${path.split('/').pop() ?? ''}`;
    const canvas: HTMLCanvasElement = document.createElement('canvas');
    canvas.className = 'image-canvas';
    this.field.appendChild(canvas);
    const started: number = performance.now();
    const { Niivue } = await import('@niivue/niivue');
    const nv = new Niivue({ isResizeCanvas: true, logLevel: 'error' });
    nv.onLocationChange = (location: unknown): void => {
      const message: { string?: string } = location as { string?: string };
      this.readout.textContent = message.string ?? '';
    };
    await nv.attachToCanvas(canvas);
    await nv.loadVolumes([{ url: `${location.origin}${this.handlers.vfsUrl_build(path)}`, name: path.split('/').pop() ?? 'volume.nii.gz' }]);
    nv.setSliceType(nv.sliceTypeMultiplanar);
    this.niivue = nv;
    this.handlers.console_note(`image: niivue drew ${path} in ${Math.round(performance.now() - started)} ms`);
  }

  /** One Cornerstone stack viewport over the series' file URLs. */
  private async stack_show(): Promise<void> {
    if (this.imageIds.length === 0) return;
    await cornerstone_ready();
    this.field_clear();
    this.engine = 'stack';
    const element: HTMLDivElement = this.viewport_make('stack');
    const engineId: string = `image-${this.serial}`;
    const viewportId: string = `${engineId}-stack`;
    this.renderingEngine = new RenderingEngine(engineId);
    this.renderingEngine.enableElement({ viewportId, type: CoreEnums.ViewportType.STACK, element });
    const viewport: CoreTypes.IStackViewport = this.renderingEngine.getViewport(viewportId) as CoreTypes.IStackViewport;
    const started: number = performance.now();
    let firstPixelAt: number | null = null;
    element.addEventListener(CoreEnums.Events.STACK_NEW_IMAGE, (event: Event): void => {
      const detail: { imageIdIndex: number; imageId: string } = (event as CustomEvent).detail;
      if (firstPixelAt === null) {
        firstPixelAt = performance.now();
        this.handlers.console_note(`image: first slice on screen ${Math.round(firstPixelAt - started)} ms after setStack, ${cache.getCacheSize()} bytes cached`);
      }
      const path: string = decodeURIComponent(/path=([^&]+)/.exec(detail.imageId)?.[1] ?? '');
      this.readout.textContent = `SLICE ${detail.imageIdIndex + 1} OF ${this.imageIds.length}  ${path.split('/').pop() ?? ''}`;
      this.handlers.console_note(`image: STACK_NEW_IMAGE ${detail.imageIdIndex + 1}/${this.imageIds.length}`);
    });
    await viewport.setStack(this.imageIds, 0);
    viewport.render();
    const group = ToolGroupManager.getToolGroup(`${engineId}-tools`) ?? ToolGroupManager.createToolGroup(`${engineId}-tools`);
    if (group === undefined) return;
    for (const tool of [StackScrollTool, WindowLevelTool, ZoomTool, PanTool, LengthTool]) group.addTool(tool.toolName);
    group.addViewport(viewportId, engineId);
    group.setToolActive(StackScrollTool.toolName, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Wheel }] });
    group.setToolActive(WindowLevelTool.toolName, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }] });
    group.setToolActive(ZoomTool.toolName, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Secondary }] });
    group.setToolActive(PanTool.toolName, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Auxiliary }] });
  }

  /** Three linked orthographic viewports over a streamed volume. */
  private async mpr_show(): Promise<void> {
    if (this.imageIds.length === 0) return;
    await cornerstone_ready();
    this.field_clear();
    this.engine = 'mpr';
    const engineId: string = `image-${this.serial}`;
    const volumeId: string = `cornerstoneStreamingImageVolume:image-${this.serial}`;
    const started: number = performance.now();
    // Metadata for every slice must be known before a volume is built; the
    // wadouri loader learns it by loading. This is the cost the plan named.
    await Promise.all(this.imageIds.map((imageId: string): Promise<unknown> => imageLoader.loadAndCacheImage(imageId)));
    this.handlers.console_note(`image: all ${this.imageIds.length} slices loaded for MPR in ${Math.round(performance.now() - started)} ms`);
    const grid: HTMLElement = document.createElement('div');
    grid.className = 'image-mpr';
    this.field.appendChild(grid);
    const axes: Array<[string, CoreEnums.OrientationAxis]> = [
      ['axial', CoreEnums.OrientationAxis.AXIAL],
      ['coronal', CoreEnums.OrientationAxis.CORONAL],
      ['sagittal', CoreEnums.OrientationAxis.SAGITTAL],
    ];
    this.renderingEngine = new RenderingEngine(engineId);
    const inputs: CoreTypes.PublicViewportInput[] = axes.map(([name, orientation]): CoreTypes.PublicViewportInput => {
      const element: HTMLDivElement = document.createElement('div');
      element.className = 'image-viewport';
      grid.appendChild(element);
      return { viewportId: `${engineId}-${name}`, type: CoreEnums.ViewportType.ORTHOGRAPHIC, element, defaultOptions: { orientation } };
    });
    this.renderingEngine.setViewports(inputs);
    const volume = await volumeLoader.createAndCacheVolume(volumeId, { imageIds: this.imageIds });
    void (volume as { load: () => void }).load();
    await setVolumesForViewports(this.renderingEngine, [{ volumeId }], inputs.map((input): string => input.viewportId));
    const group = ToolGroupManager.getToolGroup(`${engineId}-mpr-tools`) ?? ToolGroupManager.createToolGroup(`${engineId}-mpr-tools`);
    if (group === undefined) return;
    group.addTool(CrosshairsTool.toolName, {
      getReferenceLineColor: (id: string): string => (id.endsWith('axial') ? 'rgb(200, 0, 0)' : id.endsWith('coronal') ? 'rgb(200, 200, 0)' : 'rgb(0, 200, 0)'),
    });
    group.addTool(StackScrollTool.toolName);
    group.addTool(ZoomTool.toolName);
    for (const input of inputs) group.addViewport(input.viewportId, engineId);
    group.setToolActive(CrosshairsTool.toolName, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }] });
    group.setToolActive(StackScrollTool.toolName, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Wheel }] });
    group.setToolActive(ZoomTool.toolName, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Secondary }] });
    this.renderingEngine.renderViewports(inputs.map((input): string => input.viewportId));
    for (const input of inputs) {
      input.element.addEventListener(CoreEnums.Events.VOLUME_NEW_IMAGE, (event: Event): void => {
        const detail: { imageIndex?: number } = (event as CustomEvent).detail;
        this.readout.textContent = `MPR ${input.viewportId.split('-').pop()} index ${detail.imageIndex ?? '?'}`;
      });
    }
    this.handlers.console_note(`image: MPR up in ${Math.round(performance.now() - started)} ms`);
  }

  /** Rebinds the primary mouse button to one tool. */
  private primary_set(toolName: string): void {
    const group = ToolGroupManager.getToolGroup(`image-${this.serial}-tools`);
    if (group === undefined) return;
    for (const name of [WindowLevelTool.toolName, ZoomTool.toolName, PanTool.toolName, LengthTool.toolName]) {
      if (name !== toolName) group.setToolPassive(name);
    }
    group.setToolActive(toolName, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }] });
    this.handlers.console_note(`image: primary button is ${toolName}`);
  }

  /** Exports every annotation as a TID 1500 SR and reports the bytes. */
  private async sr_export(): Promise<void> {
    const annotations = annotation.state.getAllAnnotations();
    this.handlers.console_note(`image: ${annotations.length} annotation(s) on the field`);
    if (annotations.length === 0) return;
    const first = annotations[0] as { metadata?: { referencedImageId?: string; toolName?: string } };
    this.handlers.console_note(`image: annotation ${first.metadata?.toolName ?? '?'} on ${first.metadata?.referencedImageId?.replace(/token=[^&]*/, 'token=…') ?? '?'}; sopCommonModule ${JSON.stringify(metaData.get('sopCommonModule', first.metadata?.referencedImageId ?? ''))}`);
    try {
      // The adapter wants annotations grouped by image id, then by tool.
      const toolState: Record<string, Record<string, unknown[]>> = {};
      for (const entry of annotations as Array<{ metadata: { referencedImageId?: string; toolName: string } }>) {
        const imageId: string = entry.metadata.referencedImageId ?? '';
        const byTool: Record<string, unknown[]> = (toolState[imageId] ??= {});
        (byTool[entry.metadata.toolName] ??= []).push(entry);
      }
      const report = adaptersSR.Cornerstone3D.MeasurementReport.generateReport(toolState, metaData, {});
      const dataset: Record<string, unknown> = (report as { dataset: Record<string, unknown> }).dataset;
      // dcmjs's writer reaches for Node's Buffer; OHIF polyfills it the same way.
      if ((globalThis as { Buffer?: unknown }).Buffer === undefined) {
        (globalThis as { Buffer?: unknown }).Buffer = (await import('buffer')).Buffer;
      }
      const dcmjs = (await import('dcmjs')).default;
      const blob: Blob = dcmjs.data.datasetToBlob(dataset);
      const bytes: Uint8Array = new Uint8Array(await blob.arrayBuffer());
      this.handlers.console_note(`image: SR built, SOPClassUID ${String(dataset['SOPClassUID'])}, ${bytes.byteLength} bytes when written`);
      // Decision 6: annotations are files under ~/annotations/<SeriesInstanceUID>/, put there through /vfs.
      const home: string = /^(\/home\/[^/]+)\//.exec(this.series?.path ?? '')?.[1] ?? '/home/unknown';
      const target: string = `${home}/annotations/${this.series?.seriesInstanceUID ?? 'unknown'}/measurements.dcm`;
      const response: Response = await fetch(this.handlers.vfsUrl_build(target), { method: 'POST', body: blob });
      this.handlers.console_note(`image: SR put at ${target}: HTTP ${response.status}`);
    } catch (error: unknown) {
      this.handlers.console_note(`image: SR export failed: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.stack !== undefined) {
        for (const frame of error.stack.split('\n').slice(1, 5)) this.handlers.console_note(`image:   ${frame.trim()}`);
      }
    }
  }

  private viewport_make(name: string): HTMLDivElement {
    const element: HTMLDivElement = document.createElement('div');
    element.className = `image-viewport image-viewport-${name}`;
    this.field.appendChild(element);
    return element;
  }

  private field_clear(): void {
    if (this.renderingEngine !== null) {
      this.renderingEngine.destroy();
      this.renderingEngine = null;
      ToolGroupManager.destroyToolGroup(`image-${this.serial}-tools`);
      ToolGroupManager.destroyToolGroup(`image-${this.serial}-mpr-tools`);
    }
    this.niivue = null;
    this.field.replaceChildren();
    this.engine = 'none';
  }

  /** Releases the field. */
  dispose(): void {
    this.field_clear();
    this.series = null;
  }

  /** What is on the field, for the smoke probe. */
  state_get(): { engine: Engine; slices: number; series: string | null } {
    return { engine: this.engine, slices: this.imageIds.length, series: this.series?.path ?? null };
  }
}

function element_find(mount: HTMLElement, selector: string): HTMLElement {
  const found: HTMLElement | null = mount.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`image pane: missing ${selector}`);
  return found;
}
