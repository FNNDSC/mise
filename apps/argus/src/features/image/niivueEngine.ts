/**
 * @file niivue behind the image field: a NIfTI or MGZ volume, one plane,
 * three linked planes, or a 3D render.
 *
 * niivue reads these formats natively and links its planes through one
 * crosshair; what it lacks, it says: no zoom on the primary button, no
 * measurement report. The verb comes back false and the bar names it.
 *
 * @module
 */
import {
  type ImageColormap,
  type ImageEngine,
  type ImageEngineHost,
  type ImageEngineState,
  type ImageLayout,
  type ImageTool,
} from './engine.js';

type NiivueModule = typeof import('@niivue/niivue');
type Niivue = InstanceType<NiivueModule['Niivue']>;

/** niivue's own names for the pane's colormaps. */
const COLORMAP_NAMES: Readonly<Record<ImageColormap, string>> = {
  gray: 'gray',
  hot: 'hot',
  jet: 'jet',
  cool: 'cool',
};

/** niivue's drag mode for each tool it can honour. */
const DRAG_MODES: Readonly<Partial<Record<ImageTool, string>>> = {
  wl: 'contrast',
  pan: 'pan',
  length: 'measurement',
  angle: 'angle',
};

/** niivue as the image engine. */
export class NiivueEngine implements ImageEngine {
  public readonly name = 'niivue' as const;
  private readonly host: ImageEngineHost;
  private readonly path: string;
  private nv: Niivue | null = null;
  private module: NiivueModule | null = null;
  private layout: ImageLayout = 'mpr';
  private tool: ImageTool = 'wl';
  private slice: number = 0;
  private slices: number = 0;
  private refused: number = 0;
  private disposed: boolean = false;

  /**
   * @param host - The pane's lendings.
   * @param path - The volume's CFS path.
   */
  constructor(host: ImageEngineHost, path: string) {
    this.host = host;
    this.path = path;
  }

  public async open(field: HTMLElement): Promise<void> {
    const canvas: HTMLCanvasElement = document.createElement('canvas');
    canvas.className = 'image-canvas';
    field.appendChild(canvas);
    this.host.readout_set('LOADING');
    const started: number = performance.now();
    this.module = await import('@niivue/niivue');
    if (this.disposed) return;
    // niivue's crosshair width is in voxels by default: on a small volume
    // one voxel is a fat bar. A percent of the field reads the same at any
    // resolution.
    const nv: Niivue = new this.module.Niivue({
      isResizeCanvas: true,
      logLevel: 'error',
      dragAndDropEnabled: false,
      crosshairWidth: 0.4,
      crosshairWidthUnit: 'percent',
    });
    nv.onLocationChange = (location: unknown): void => {
      const message: { vox?: number[]; string?: string } = location as { vox?: number[]; string?: string };
      const z: number | undefined = message.vox?.[2];
      if (z !== undefined) this.slice = z + 1;
      this.host.readout_set(`${this.slices > 0 ? `SLICE ${this.slice} OF ${this.slices} · ` : ''}${message.string ?? ''}`);
    };
    await nv.attachToCanvas(canvas);
    const name: string = this.path.split('/').pop() ?? 'volume.nii.gz';
    try {
      await nv.loadVolumes([{ url: `${location.origin}${this.host.source.url_of(this.path)}`, name }]);
    } catch (error: unknown) {
      this.refused = 1;
      this.host.readout_set('REFUSED 1 OF 1');
      this.host.note(`image: ${this.path}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (this.disposed) return;
    this.nv = nv;
    const dims: number[] | undefined = (nv.volumes[0] as { dims?: number[] } | undefined)?.dims;
    this.slices = dims?.[3] ?? 0;
    nv.setSliceType(nv.sliceTypeMultiplanar);
    this.layout = 'mpr';
    this.host.readout_set(`${this.slices} SLICES`);
    this.host.note(`image: ${name} drawn in ${Math.round(performance.now() - started)} ms`);
    this.host.regard(this.path);
  }

  public async layout_set(layout: ImageLayout): Promise<boolean> {
    if (this.nv === null) return false;
    this.nv.setSliceType(layout === 'single' ? this.nv.sliceTypeAxial : layout === 'mpr' ? this.nv.sliceTypeMultiplanar : this.nv.sliceTypeRender);
    this.layout = layout;
    this.host.readout_set(`${this.slices} SLICES`);
    return true;
  }

  public slice_set(slice: number): boolean {
    if (this.nv === null || this.slices === 0) return false;
    const wanted: number = Math.max(1, Math.min(slice, this.slices));
    const current: number = this.slice > 0 ? this.slice : Math.ceil(this.slices / 2);
    this.nv.moveCrosshairInVox(0, 0, wanted - current);
    this.slice = wanted;
    return true;
  }

  public wl_set(lower: number, upper: number): boolean {
    const volume = this.nv?.volumes[0] as { cal_min?: number; cal_max?: number } | undefined;
    if (this.nv === null || volume === undefined) return false;
    volume.cal_min = lower;
    volume.cal_max = upper;
    this.nv.updateGLVolume();
    return true;
  }

  public colormap_set(name: ImageColormap): boolean {
    const volume = this.nv?.volumes[0] as { id?: string } | undefined;
    if (this.nv === null || volume?.id === undefined) return false;
    this.nv.setColormap(volume.id, COLORMAP_NAMES[name]);
    return true;
  }

  public tool_set(tool: ImageTool): boolean {
    const mode: string | undefined = DRAG_MODES[tool];
    if (this.nv === null || mode === undefined) return false;
    this.nv.setDragMode(mode);
    this.tool = tool;
    return true;
  }

  public annotations_export(): Promise<Blob | null> {
    return Promise.resolve(null);
  }

  public annotations_import(): Promise<number> {
    return Promise.resolve(0);
  }

  public state_get(): ImageEngineState {
    return { engine: 'niivue', layout: this.layout, slice: this.slice, slices: this.slices, tool: this.tool, refused: this.refused, annotations: 0 };
  }

  public dispose(): void {
    this.disposed = true;
    this.nv = null;
  }
}
