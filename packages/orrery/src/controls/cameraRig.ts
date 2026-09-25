/**
 * @file The camera rig: the eye, the world it turns, and the flights
 * between one stance and the next.
 *
 * A scene is looked at by one perspective camera and turned as one world
 * (a group every drawer hangs from). The rig owns both motions and nothing
 * else: which nodes to frame, and why, stays with its caller, which hands
 * in world points and radii. It keeps
 *
 * - the FOCUS, the world point looked at: the pivot of the idle spin and
 *   the orbit, the target of the dolly, carried by a pan and moved by a
 *   flight that frames something;
 * - the FLIGHT under way, eased in position and aim together;
 * - the HOLD while the camera is parked inside a node, and the stance it
 *   flies back to;
 * - whether the operator has TOUCHED the camera since the scene last framed
 *   itself, and the pause of the idle spin after every touch.
 *
 * @module
 */
import * as THREE from 'three';

/** Idle rotation speed, radians per frame. */
export const SPIN_INTERACTIVE: number = 0.0022;
/** The ambient tumble's rotation speed, radians per frame. */
export const SPIN_AMBIENT: number = 0.006;
/**
 * How fast the ambient tumble axis wanders, radians of phase per frame.
 * Well below the spin rate, so the motion reads as one continuous freeform
 * tumble rather than a wobble.
 */
export const TUMBLE_DRIFT: number = 0.0035;
/** How long after the last touch the idle spin stays paused. */
export const SPIN_RESUME_MS: number = 10_000;
/** How long a fly-in and its fly-back take. */
export const FLIGHT_INTO_MS: number = 700;
/** The world's up: the axis the idle spin and a sideways orbit turn about. */
export const WORLD_UP: THREE.Vector3 = new THREE.Vector3(0, 1, 0);

/**
 * One drawn thing as a framing needs it: where it stands in the world and
 * how far it reaches.
 */
export interface WorldReach {
  position: THREE.Vector3;
  radius: number;
}

/**
 * How a framing parks the camera.
 *
 * @property minDistance - The closest the camera stands, however small the thing.
 * @property margin - Room around the thing, as a factor of the fitting distance.
 * @property stance - `axis` looks down the depth axis; `threeQuarter` opens
 *   on an orbit, so a cloud grown from near-planar anchors reads as volume.
 * @property farFloor - The far plane's floor.
 * @property farScale - The far plane as a factor of distance plus radius.
 */
export interface FrameOptions {
  minDistance: number;
  margin: number;
  stance: 'axis' | 'threeQuarter';
  farFloor: number;
  farScale: number;
}

const FRAME_DEFAULTS: FrameOptions = { minDistance: 8, margin: 1.15, stance: 'axis', farFloor: 200, farScale: 2 };

/** A flight in progress: where from, where to, and what to do on arrival. */
interface Flight {
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromQuat: THREE.Quaternion;
  toQuat: THREE.Quaternion;
  startedAt: number;
  durationMs: number;
  onDone: () => void;
}

/**
 * Smoothstep: gentle leave, gentle arrive.
 *
 * @param t - Progress, 0..1.
 * @returns The eased progress.
 */
export function ease_smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * The camera and the world it turns, steered.
 */
export class CameraRig {
  /** The world point the camera looks at. */
  public readonly focus: THREE.Vector3 = new THREE.Vector3();

  private flight: Flight | null = null;
  private home: { position: THREE.Vector3; quaternion: THREE.Quaternion } | null = null;
  private holding: boolean = false;
  private touched: boolean = false;
  private spinIdleUntil: number = 0;
  private readonly tumbleAxis: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  private tumblePhase: number;

  /**
   * @param camera - The eye.
   * @param world - The group every drawer hangs from; turns move it.
   * @param clock - Wall-clock milliseconds; `Date.now` unless a test drives time.
   * @param tumblePhase - Where the ambient tumble's wander starts; random so
   *   miniatures side by side do not turn in step.
   */
  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly world: THREE.Object3D,
    private readonly clock: () => number = Date.now,
    tumblePhase: number = Math.random() * Math.PI * 2,
  ) {
    this.tumblePhase = tumblePhase;
  }

  /** @returns Whether a flight is under way. */
  public flying(): boolean {
    return this.flight !== null;
  }

  /** @returns Whether the camera is parked inside a node. */
  public holding_get(): boolean {
    return this.holding;
  }

  /**
   * Whether the operator has placed the camera since the scene last framed
   * itself: a repaint of the same space keeps a placed camera.
   *
   * @returns True once touched since the last framing.
   */
  public touched_get(): boolean {
    return this.touched;
  }

  /** The operator placed the camera: a repaint must not reframe it. */
  public touch_note(): void {
    this.touched = true;
  }

  /** The operator is steering: the idle spin waits a while. */
  public spin_pause(): void {
    this.spinIdleUntil = this.clock() + SPIN_RESUME_MS;
  }

  /** @returns The distance from the eye to the focus. */
  public eyeDistance(): number {
    return this.camera.position.distanceTo(this.focus);
  }

  /**
   * Turns the world about an axis through the focus.
   *
   * @param axis - A unit axis in world space.
   * @param angle - Radians.
   */
  public turn_about(axis: THREE.Vector3, angle: number): void {
    const q: THREE.Quaternion = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    this.world.position.sub(this.focus).applyQuaternion(q).add(this.focus);
    this.world.quaternion.premultiply(q);
  }

  /**
   * Orbits about the focus by a screen drag: across turns about the world's
   * up, along turns about the camera's right.
   *
   * @param dx - Screen pixels across.
   * @param dy - Screen pixels down.
   */
  public orbit(dx: number, dy: number): void {
    this.turn_about(WORLD_UP, dx * 0.005);
    this.turn_about(new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).normalize(), dy * 0.005);
  }

  /**
   * Dollies by a wheel's travel. Toward the focus, not the world's origin:
   * after a flight to a feed the camera looks at the feed, and a dolly must
   * close on it. `alongEye` dollies down the eye ray instead, for a camera
   * parked off-axis, where closing on the focus slid the view sideways.
   *
   * @param deltaY - The wheel's travel; positive draws back.
   * @param alongEye - Dolly along the look direction, unclamped.
   */
  public dolly(deltaY: number, alongEye: boolean = false): void {
    this.spin_pause();
    this.touched = true;
    if (alongEye) {
      const heading: THREE.Vector3 = this.camera.getWorldDirection(new THREE.Vector3());
      const speed: number = Math.max(4, this.camera.position.length()) * 0.0012;
      this.camera.position.addScaledVector(heading, -deltaY * speed);
      return;
    }
    const offset: THREE.Vector3 = this.camera.position.clone().sub(this.focus);
    const eye: number = offset.length();
    const next: number = Math.min(Math.max(eye * Math.exp(deltaY * 0.001), 1.5), Math.max(40, this.camera.far * 0.45));
    this.camera.position.copy(this.focus).addScaledVector(offset, next / Math.max(0.0001, eye));
  }

  /**
   * Slides the camera in its own plane by a screen distance; the focus
   * rides along, so the next turn pivots on what is now in the middle.
   *
   * @param dx - Screen pixels across.
   * @param dy - Screen pixels down.
   */
  public pan(dx: number, dy: number): void {
    const factor: number = this.camera.position.distanceTo(this.focus) * 0.0016;
    const shift: THREE.Vector3 = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).multiplyScalar(-dx * factor)
      .add(new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1).multiplyScalar(dy * factor));
    this.camera.position.add(shift);
    this.focus.add(shift);
  }

  /**
   * Parks the camera on a thing at once: the world is moved so the thing's
   * centre lies at the origin, the focus goes there, and the camera stands
   * back far enough to hold its radius in both directions of the view.
   *
   * @param center - The thing's centre, in the world group's own space.
   * @param radius - How far it reaches.
   * @param options - How to park; see {@link FrameOptions}.
   */
  public frame(center: THREE.Vector3, radius: number, options: Partial<FrameOptions> = {}): void {
    const o: FrameOptions = { ...FRAME_DEFAULTS, ...options };
    const distance: number = Math.max(o.minDistance, this.fitDistance(radius) * o.margin);
    this.world.position.copy(center).applyQuaternion(this.world.quaternion).negate();
    this.focus.set(0, 0, 0);
    if (o.stance === 'threeQuarter') {
      this.camera.position.set(distance * 0.5, distance * 0.4, distance * 0.85);
    } else {
      this.camera.position.set(0, 0, distance);
    }
    this.camera.far = Math.max(o.farFloor, (distance + radius) * o.farScale);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(0, 0, 0);
  }

  /** The scene framed itself: the camera is the scene's again, not the operator's. */
  public touch_clear(): void {
    this.touched = false;
  }

  /**
   * Flies to frame a set of things: the framing those things alone would
   * get, reached from where the camera stands, along the line it already
   * looks down, so the flight reads as a dolly and never a swing.
   *
   * @param reaches - The things, in world space.
   * @param durationMs - The flight's length.
   * @param onDone - Called on arrival (at once when there is nothing).
   * @param bulk - The share of the things the frame must hold, 0..1: at 1
   *   every outlier is inside; lower lets the farthest few spill, so a
   *   settle that throws a few far out does not shrink the bulk to specks.
   * @param margin - Room around, as a factor of the fitting distance.
   */
  public flyToFit(reaches: ReadonlyArray<WorldReach>, durationMs: number, onDone: () => void, bulk: number = 1, margin: number = 1.15): void {
    if (reaches.length === 0) {
      onDone();
      return;
    }
    let radiusMax: number = 0;
    const center: THREE.Vector3 = new THREE.Vector3();
    for (const reach of reaches) {
      center.add(reach.position);
      radiusMax = Math.max(radiusMax, reach.radius);
    }
    center.divideScalar(reaches.length);
    const distances: number[] = reaches.map((reach: WorldReach): number => center.distanceTo(reach.position)).sort((a: number, b: number): number => a - b);
    const kept: number = Math.max(1, Math.min(distances.length, Math.ceil(distances.length * Math.min(1, Math.max(0.1, bulk)))));
    const radius: number = Math.max(1, (distances[kept - 1] ?? 1) + radiusMax);
    const distance: number = Math.max(3, this.fitDistance(radius) * margin);
    this.camera.far = Math.max(this.camera.far, (distance + radius) * 2);
    this.camera.updateProjectionMatrix();
    this.flyAlongLine(center, distance, durationMs, onDone);
  }

  /**
   * Flies toward one thing, along the line the camera already looks down,
   * to a distance where its neighbourhood fills the view.
   *
   * @param reach - The thing, in world space.
   * @param distance - How far from it to stop; never closer than four radii.
   * @param durationMs - The flight's length.
   * @param onDone - Called on arrival.
   */
  public flyToward(reach: WorldReach, distance: number, durationMs: number, onDone: () => void): void {
    this.flyAlongLine(reach.position, Math.max(distance, reach.radius * 4), durationMs, onDone);
  }

  /**
   * Flies into a thing: aims at it from the current stance, then dollies to
   * just shy of its surface, and holds there — no spin, no new flight —
   * until {@link flyBack}. The stance is remembered to fly back to.
   *
   * @param target - The thing's centre, in world space.
   * @param onArrived - Called once inside.
   * @returns False when a flight or a hold already has the camera.
   */
  public flyInto(target: THREE.Vector3, onArrived: () => void): boolean {
    if (this.flight !== null || this.holding) return false;
    this.holding = true;
    this.home = { position: this.camera.position.clone(), quaternion: this.camera.quaternion.clone() };
    const toPos: THREE.Vector3 = target.clone().add(this.camera.position.clone().sub(target).normalize().multiplyScalar(0.4));
    this.flight_begin(toPos, this.aim_from(this.camera.position, target), FLIGHT_INTO_MS, onArrived);
    return true;
  }

  /**
   * Flies back out to the stance before the fly-in and releases the hold.
   *
   * @param onDone - Called once home (at once when there is no stance to return to).
   */
  public flyBack(onDone: () => void): void {
    const home = this.home;
    if (home === null) {
      this.holding = false;
      onDone();
      return;
    }
    this.flight_begin(home.position.clone(), home.quaternion.clone(), FLIGHT_INTO_MS, (): void => {
      this.home = null;
      this.holding = false;
      this.spin_pause();
      onDone();
    });
  }

  /**
   * Advances the flight, if any: position and aim eased together. Calls the
   * flight's arrival once it lands.
   */
  public flight_step(): void {
    const flight: Flight | null = this.flight;
    if (flight === null) return;
    const t: number = Math.min(1, (this.clock() - flight.startedAt) / flight.durationMs);
    const eased: number = ease_smooth(t);
    this.camera.position.lerpVectors(flight.fromPos, flight.toPos, eased);
    this.camera.quaternion.slerpQuaternions(flight.fromQuat, flight.toQuat, eased);
    if (t >= 1) {
      this.flight = null;
      flight.onDone();
    }
  }

  /**
   * The idle spin, one frame's worth: turns about the world's up unless the
   * operator touched the camera lately, a flight or a hold has it, or the
   * caller says the space must stand still (a pointer over it, a flat view).
   *
   * @param allowed - Whether the caller lets the space turn.
   */
  public spin_step(allowed: boolean): void {
    if (!allowed || this.holding || this.flight !== null || this.clock() < this.spinIdleUntil) return;
    this.turn_about(WORLD_UP, SPIN_INTERACTIVE);
  }

  /**
   * The ambient tumble, one frame's worth: constant angular speed about an
   * axis that itself drifts, so a miniature turns through every orientation
   * rather than orbiting one axis. Incommensurate frequencies keep the
   * wander from settling into a repeating figure.
   */
  public tumble_step(): void {
    this.tumblePhase += TUMBLE_DRIFT;
    this.tumbleAxis
      .set(
        Math.sin(this.tumblePhase * 0.7),
        Math.cos(this.tumblePhase * 0.4) + 0.6,
        Math.sin(this.tumblePhase * 0.3) * 0.8,
      )
      .normalize();
    this.world.rotateOnWorldAxis(this.tumbleAxis, SPIN_AMBIENT);
  }

  /** The distance at which a radius fills the view in both directions. */
  private fitDistance(radius: number): number {
    const fov: number = (this.camera.fov * Math.PI) / 180;
    const fitH: number = radius / Math.tan(fov / 2);
    const fitW: number = radius / (Math.tan(fov / 2) * Math.max(0.1, this.camera.aspect));
    return Math.max(fitH, fitW);
  }

  /** The aim a camera at a position would have looking at a target. */
  private aim_from(position: THREE.Vector3, target: THREE.Vector3): THREE.Quaternion {
    const aim: THREE.Camera = this.camera.clone();
    aim.position.copy(position);
    aim.lookAt(target);
    return aim.quaternion.clone();
  }

  /** Flies to stand a distance from a centre, along the current line of sight. */
  private flyAlongLine(center: THREE.Vector3, distance: number, durationMs: number, onDone: () => void): void {
    const heading: THREE.Vector3 = this.camera.position.clone().sub(center);
    if (heading.lengthSq() < 0.0001) heading.set(0, 0, 1);
    heading.normalize();
    const toPos: THREE.Vector3 = center.clone().add(heading.multiplyScalar(distance));
    this.focus.copy(center);
    this.flight_begin(toPos, this.aim_from(toPos, center), durationMs, onDone);
  }

  private flight_begin(toPos: THREE.Vector3, toQuat: THREE.Quaternion, durationMs: number, onDone: () => void): void {
    this.flight = {
      fromPos: this.camera.position.clone(),
      toPos,
      fromQuat: this.camera.quaternion.clone(),
      toQuat,
      startedAt: this.clock(),
      durationMs,
      onDone,
    };
  }
}
