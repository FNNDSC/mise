/**
 * @file The SLAB layout's own vtk scene: a crisp acquisition slice sweeping
 * through a ghost of the volume.
 *
 * SLAB drives its own vtk render window rather than a Cornerstone viewport.
 * A `vtkImageSlice` plane composited into a Cornerstone `VOLUME_3D` viewport
 * crashes that viewport's z-buffer pass (a null texture), while the same two
 * actors in a plain vtk renderer compose without complaint — which is what
 * the standalone prototype proved. So SLAB owns its scene: a volume actor
 * ghosted to a faint shell, a crisp image-slice actor at the current slice,
 * a trackball for rotate/zoom/pan, and the wheel bound to the sweep.
 *
 * The pixels and the geometry come from Cornerstone (which loads the DICOM);
 * this scene never touches the wire.
 *
 * @module
 */
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow.js';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume.js';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper.js';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice.js';
import vtkImageMapper from '@kitware/vtk.js/Rendering/Core/ImageMapper.js';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction.js';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction.js';
import vtkInteractorStyleManipulator from '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator.js';
import vtkMouseCameraTrackballRotateManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballRotateManipulator.js';
import vtkMouseCameraTrackballZoomManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomManipulator.js';
import vtkMouseCameraTrackballPanManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballPanManipulator.js';

/** What the scene needs to open. */

/** Two fingers' travel, in pixels, that sweeps one slice. */
const SWEEP_TOUCH_PX: number = 12;
export interface SlabSceneOptions {
  /** The vtkImageData holding the volume (dims, spacing, origin, direction, scalars). */
  imageData: unknown;
  /** The volume's scalar range, for the ghost ramp and the default window. */
  range: [number, number];
  /** Zero-based slice the crisp plane starts on. */
  startK: number;
  /** How many slices there are, so the wheel can clamp. */
  slices: number;
  /** The pane's window/level for the crisp slice, or null for the range. */
  voi: { lower: number; upper: number } | null;
  /** The ghost's opacity, 0..1, or null to hide it. */
  ghost: number | null;
  /** Called when the wheel sweeps to a new slice (zero-based). */
  onSweep: (k: number) => void;
}

/** A running SLAB scene; the pane drives it and tears it down. */
export interface SlabScene {
  sweep(k: number): void;
  ghost_set(level: number | null): void;
  wl_set(lower: number, upper: number): void;
  resize(): void;
  slice_get(): number;
  dispose(): void;
}

/**
 * Opens a SLAB scene on an element.
 *
 * @param element - The field element to render into.
 * @param options - The volume, the slice, the window and the ghost.
 * @returns The running scene.
 */
export function slabScene_open(element: HTMLElement, options: SlabSceneOptions): SlabScene {
  const grw = vtkGenericRenderWindow.newInstance({ background: [0, 0, 0] });
  grw.setContainer(element as HTMLElement);
  grw.resize();
  const renderer = grw.getRenderer();
  const renderWindow = grw.getRenderWindow();

  let ghostLevel: number | null = options.ghost;
  let currentK: number = Math.max(0, Math.min(options.startK, options.slices - 1));
  const [lo, hi] = options.range;

  // The ghost volume: grayscale, faint.
  const volumeMapper = vtkVolumeMapper.newInstance();
  (volumeMapper as unknown as { setInputData: (d: unknown) => void }).setInputData(options.imageData);
  (volumeMapper as unknown as { setSampleDistance?: (n: number) => void }).setSampleDistance?.(1.2);
  const volume = vtkVolume.newInstance();
  (volume as unknown as { setMapper: (m: unknown) => void }).setMapper(volumeMapper);
  const ctf = vtkColorTransferFunction.newInstance();
  ctf.addRGBPoint(lo, 0.6, 0.6, 0.6);
  ctf.addRGBPoint(hi, 1, 1, 1);
  const otf = vtkPiecewiseFunction.newInstance();
  const vprop = (volume as unknown as { getProperty: () => { setRGBTransferFunction: (i: number, f: unknown) => void; setScalarOpacity: (i: number, f: unknown) => void; setScalarOpacityUnitDistance: (i: number, d: number) => void; setInterpolationTypeToLinear: () => void } }).getProperty();
  vprop.setRGBTransferFunction(0, ctf);
  vprop.setScalarOpacity(0, otf);
  vprop.setScalarOpacityUnitDistance(0, 3);
  vprop.setInterpolationTypeToLinear();
  const ghost_apply = (): void => {
    otf.removeAllPoints();
    if (ghostLevel === null || ghostLevel <= 0) {
      otf.addPoint(lo, 0);
      otf.addPoint(hi, 0);
    } else {
      otf.addPoint(lo, 0);
      otf.addPoint(lo + (hi - lo) * 0.4, ghostLevel * 0.25);
      otf.addPoint(hi, ghostLevel);
    }
  };
  ghost_apply();
  renderer.addVolume(volume);

  // The crisp slice.
  const sliceMapper = vtkImageMapper.newInstance();
  (sliceMapper as unknown as { setInputData: (d: unknown) => void }).setInputData(options.imageData);
  (sliceMapper as unknown as { setKSlice: (n: number) => void }).setKSlice(currentK);
  const imageSlice = vtkImageSlice.newInstance();
  (imageSlice as unknown as { setMapper: (m: unknown) => void }).setMapper(sliceMapper);
  const sliceProp = (imageSlice as unknown as { getProperty: () => { setColorWindow: (w: number) => void; setColorLevel: (l: number) => void } }).getProperty();
  const window0: number = options.voi ? options.voi.upper - options.voi.lower : hi - lo;
  const level0: number = options.voi ? (options.voi.upper + options.voi.lower) / 2 : (hi + lo) / 2;
  sliceProp.setColorWindow(window0);
  sliceProp.setColorLevel(level0);
  renderer.addActor(imageSlice);

  // An oblique camera so the crisp plane sits inside the ghost.
  const camera_frame = (): void => {
    renderer.resetCamera();
    const cam = renderer.getActiveCamera();
    const fp = cam.getFocalPoint();
    const dist = cam.getDistance();
    // Nudge the camera off the reset axis so both actors are seen.
    cam.azimuth(30);
    cam.elevation(12);
    cam.setDistance(dist * 1.05);
    cam.zoom(1.4);
    renderer.resetCameraClippingRange();
    void fp;
  };
  camera_frame();

  // Rotate on the left drag, zoom on the right, pan on the middle. The wheel
  // is left for the sweep, not zoom, so no wheel manipulator is added.
  const style = vtkInteractorStyleManipulator.newInstance();
  const rotate = vtkMouseCameraTrackballRotateManipulator.newInstance({ button: 1 });
  const zoom = vtkMouseCameraTrackballZoomManipulator.newInstance({ button: 3 });
  const pan = vtkMouseCameraTrackballPanManipulator.newInstance({ button: 2 });
  style.addMouseManipulator(rotate);
  style.addMouseManipulator(zoom);
  style.addMouseManipulator(pan);
  const interactor = grw.getInteractor();
  interactor.setInteractorStyle(style);

  renderWindow.render();

  const sweep = (k: number): void => {
    const clamped: number = Math.max(0, Math.min(k, options.slices - 1));
    if (clamped === currentK) return;
    currentK = clamped;
    (sliceMapper as unknown as { setKSlice: (n: number) => void }).setKSlice(clamped);
    renderWindow.render();
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const next: number = currentK + (event.deltaY > 0 ? 1 : -1);
    sweep(next);
    options.onSweep(currentK);
  };
  element.addEventListener('wheel', onWheel, { passive: false });

  // Two fingers moving up or down sweep, as the wheel does: a slice every
  // few pixels of travel. Heard before vtk's own touch handling, which
  // would take the pair for a pinch or a turn.
  let sweepFrom: number | null = null;
  const fingersMid = (event: TouchEvent): number =>
    ((event.touches[0]?.clientY ?? 0) + (event.touches[1]?.clientY ?? 0)) / 2;
  const onTouchStart = (event: TouchEvent): void => {
    if (event.touches.length !== 2) { sweepFrom = null; return; }
    sweepFrom = fingersMid(event);
    event.preventDefault();
    event.stopPropagation();
  };
  const onTouchMove = (event: TouchEvent): void => {
    if (sweepFrom === null || event.touches.length !== 2) return;
    event.preventDefault();
    event.stopPropagation();
    const travel: number = fingersMid(event) - sweepFrom;
    const steps: number = Math.trunc(travel / SWEEP_TOUCH_PX);
    if (steps === 0) return;
    sweepFrom += steps * SWEEP_TOUCH_PX;
    sweep(currentK + steps);
    options.onSweep(currentK);
  };
  const onTouchEnd = (event: TouchEvent): void => {
    if (event.touches.length < 2) sweepFrom = null;
  };
  element.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
  element.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
  element.addEventListener('touchend', onTouchEnd, { capture: true });
  element.addEventListener('touchcancel', onTouchEnd, { capture: true });

  return {
    sweep,
    ghost_set: (level: number | null): void => {
      ghostLevel = level === null ? null : Math.max(0, Math.min(1, level));
      ghost_apply();
      renderWindow.render();
    },
    wl_set: (lower: number, upper: number): void => {
      sliceProp.setColorWindow(upper - lower);
      sliceProp.setColorLevel((upper + lower) / 2);
      renderWindow.render();
    },
    resize: (): void => { grw.resize(); renderWindow.render(); },
    slice_get: (): number => currentK,
    dispose: (): void => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('touchstart', onTouchStart, { capture: true });
      element.removeEventListener('touchmove', onTouchMove, { capture: true });
      element.removeEventListener('touchend', onTouchEnd, { capture: true });
      element.removeEventListener('touchcancel', onTouchEnd, { capture: true });
      try { renderer.removeVolume(volume); renderer.removeActor(imageSlice); } catch { /* torn down */ }
      try { (grw as unknown as { delete: () => void }).delete(); } catch { /* already gone */ }
    },
  };
}
