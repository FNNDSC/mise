/**
 * @file Pointer gestures: a mouse, a pen and fingers, read as intents.
 *
 * The canvas hears raw pointer events; the rig and the scene want intents.
 * This sits between and keeps every piece of pointer state in one place:
 *
 * - a press on empty space begins a VIEW DRAG — an orbit, or a pan with
 *   shift or the right or middle button (always a pan in a flat view);
 * - a press the scene takes as a GRAB (a node under the pointer) is handed
 *   back to it, move by move, until the release;
 * - two FINGERS steer the camera together — spreading closes in, pinching
 *   draws back, the pair moving together pans — and the finger left when
 *   one lifts neither orbits nor taps;
 * - a click SELECTS, a double click ACTIVATES; a finger has no double click
 *   it can count on, so two taps close in time and place are one;
 * - the click that ends a drag, a pull or a gesture is its release, never a
 *   select;
 * - the wheel dollies.
 *
 * What lies under the pointer, what a grab moves, and what a tip says are
 * the scene's; this knows only pointers.
 *
 * @module
 */
import type { CameraRig } from './cameraRig.js';

/** Screen travel past which a press becomes a drag. */
export const DRAG_THRESHOLD_PX: number = 4;
/** Two taps this close in time are a double tap. */
export const DOUBLE_TAP_MS: number = 350;
/** Two taps this close in place are a double tap. */
export const DOUBLE_TAP_PX: number = 30;
/** A browser's own dblclick this soon after a double tap is the same act. */
const TAP_DBLCLICK_ECHO_MS: number = 600;
/** How long the lift that ends a gesture keeps swallowing its click. */
const GESTURE_LIFT_MS: number = 400;

/**
 * What the gestures hand back to the scene that owns the canvas.
 *
 * @property grab_begin - A press landed where no gesture holds the camera:
 *   return true when it took hold of something, and its moves come here.
 * @property grab_move - The pointer moved while holding.
 * @property grab_end - The hold let go: return whether it had moved, so its
 *   click is swallowed.
 * @property hover - The pointer moved over the field with nothing held.
 * @property leave - The pointer left the field.
 * @property tap - A click or a tap: `select`, or `activate` on a double.
 * @property tip_hide - A press or a gesture began; whatever names the thing
 *   under the pointer is out of date.
 * @property gesture_end - The last finger of a two-finger gesture lifted:
 *   the camera stands where the fingers left it. Optional — a scene that
 *   reads nothing into a finished pinch leaves it out.
 */
export interface GestureTarget {
  grab_begin(event: PointerEvent): boolean;
  grab_move(event: PointerEvent): void;
  grab_end(): boolean;
  hover(event: PointerEvent): void;
  leave(event: PointerEvent): void;
  tap(event: MouseEvent, kind: 'select' | 'activate'): void;
  tip_hide(): void;
  gesture_end?(): void;
}

/**
 * How the view is steered, read at the moment it is.
 *
 * @property flat - The view is flat: a drag pans, never orbits.
 * @property untethered - The camera is parked off the focus (a place, not
 *   a thing): the dolly runs down the eye ray, and a pinch does not pan.
 */
export interface GestureMode {
  flat(): boolean;
  untethered(): boolean;
}

/** An empty-space drag steering the view. */
interface ViewDrag {
  lastX: number;
  lastY: number;
  startX: number;
  startY: number;
  pan: boolean;
  moved: boolean;
}

/**
 * The pointer's intents on one canvas.
 */
export class PointerGestures {
  private readonly touches: Map<number, { x: number; y: number }> = new Map();
  private pinch: { spread: number; midX: number; midY: number } | null = null;
  private gestureHeld: boolean = false;
  private lastTap: { at: number; x: number; y: number } | null = null;
  private kind: string = 'mouse';
  private tapActivatedAt: number = 0;
  private suppressClick: boolean = false;
  private viewDrag: ViewDrag | null = null;
  private grabbing: boolean = false;
  private over: boolean = false;
  private readonly detachers: Array<() => void> = [];

  /**
   * @param element - The canvas; its touch action is taken from the page.
   * @param rig - The camera the view gestures steer.
   * @param target - The scene's side of each gesture.
   * @param mode - How the view is steered right now.
   * @param clock - Wall-clock milliseconds; `Date.now` unless a test drives time.
   */
  constructor(
    private readonly element: HTMLElement,
    private readonly rig: CameraRig,
    private readonly target: GestureTarget,
    private readonly mode: GestureMode,
    private readonly clock: () => number = Date.now,
  ) {
    // Fingers belong to the scene, not the page: without this the browser
    // takes a pinch for a page zoom and a drag for a scroll.
    element.style.touchAction = 'none';
    this.listen('click', (event: Event): void => this.click_handle(event as MouseEvent));
    this.listen('dblclick', (event: Event): void => {
      if (this.clock() - this.tapActivatedAt < TAP_DBLCLICK_ECHO_MS) return;
      this.target.tap(event as MouseEvent, 'activate');
    });
    this.listen('pointerdown', (event: Event): void => this.down_handle(event as PointerEvent));
    this.listen('pointerup', (event: Event): void => this.up_handle(event as PointerEvent));
    this.listen('pointercancel', (event: Event): void => this.up_handle(event as PointerEvent));
    this.listen('pointermove', (event: Event): void => this.move_handle(event as PointerEvent));
    this.listen('pointerleave', (event: Event): void => {
      this.over = false;
      this.target.leave(event as PointerEvent);
    });
    // The wheel dollies: closer to read a dense graph, back for the whole.
    this.listen('wheel', (event: Event): void => {
      event.preventDefault();
      this.rig.dolly((event as WheelEvent).deltaY, this.mode.untethered());
    }, { passive: false });
    // Right-drag pans; the browser's menu would eat the gesture.
    this.listen('contextmenu', (event: Event): void => event.preventDefault());
  }

  /** @returns Whether the pointer is over the field: the idle spin waits while it is. */
  public pointerOver(): boolean {
    return this.over;
  }

  /** @returns What the last press was made with: `mouse`, `pen` or `touch`. */
  public pressKind(): string {
    return this.kind;
  }

  /** @returns How many fingers are down. */
  public fingersDown(): number {
    return this.touches.size;
  }

  /** Stops listening. */
  public detach(): void {
    for (const off of this.detachers.splice(0)) off();
  }

  private listen(name: string, handler: (event: Event) => void, options?: AddEventListenerOptions): void {
    this.element.addEventListener(name, handler, options);
    this.detachers.push((): void => this.element.removeEventListener(name, handler, options));
  }

  private click_handle(event: MouseEvent): void {
    // The click that ends a pull, a view drag or a gesture is its release.
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    if (this.kind === 'touch') {
      const now: number = this.clock();
      const last = this.lastTap;
      if (last !== null && now - last.at <= DOUBLE_TAP_MS && Math.hypot(event.clientX - last.x, event.clientY - last.y) <= DOUBLE_TAP_PX) {
        this.lastTap = null;
        this.tapActivatedAt = now;
        this.target.tap(event, 'activate');
        return;
      }
      this.lastTap = { at: now, x: event.clientX, y: event.clientY };
    }
    this.target.tap(event, 'select');
  }

  private down_handle(event: PointerEvent): void {
    this.kind = event.pointerType;
    if (event.pointerType === 'touch') {
      // The first finger of a new touch starts clean: a lift the browser
      // never reported (a cancelled gesture, a system swipe) must not leave
      // a phantom finger that turns every later tap into a third.
      if (event.isPrimary) {
        this.touches.clear();
        this.pinch = null;
        this.gestureHeld = false;
      }
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.touches.size === 2) {
        this.gesture_begin();
        return;
      }
      if (this.touches.size > 2 || this.gestureHeld) return;
      this.press(event);
      // No hover under a finger: the press names what it landed on — after
      // the press, which clears the tip a cursor leaves behind.
      this.hover(event);
      return;
    }
    this.press(event);
  }

  private up_handle(event: PointerEvent): void {
    if (event.pointerType === 'touch') {
      this.touches.delete(event.pointerId);
      if (this.touches.size < 2) this.pinch = null;
      if (this.touches.size === 0 && this.gestureHeld) {
        this.gestureHeld = false;
        // The lift that ends a gesture is not a tap.
        this.suppressClick = true;
        setTimeout((): void => { this.suppressClick = false; }, GESTURE_LIFT_MS);
        this.release();
        this.target.gesture_end?.();
        return;
      }
    }
    this.release();
  }

  private move_handle(event: PointerEvent): void {
    if (event.pointerType === 'touch' && this.touches.has(event.pointerId)) {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pinch !== null) {
        this.gesture_move();
        return;
      }
      if (this.gestureHeld) return;
    }
    if (this.grabbing) {
      this.target.grab_move(event);
    } else if (this.viewDrag !== null) {
      this.view_move(event);
    } else {
      this.hover(event);
    }
  }

  private hover(event: PointerEvent): void {
    // The space holds still while the pointer is over it: a target that
    // turns under the cursor is a click on a neighbour.
    this.over = true;
    this.target.hover(event);
  }

  /**
   * A press touches the space: the idle spin pauses exactly where it is —
   * never a snap — and what follows depends on what was under the pointer.
   */
  private press(event: PointerEvent): void {
    if (this.rig.holding_get() || this.rig.flying()) return;
    this.rig.spin_pause();
    if (this.target.grab_begin(event)) {
      this.grabbing = true;
    } else {
      this.viewDrag = {
        lastX: event.clientX,
        lastY: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        pan: event.shiftKey || event.button === 2 || event.button === 1,
        moved: false,
      };
    }
    try {
      this.element.setPointerCapture(event.pointerId);
    } catch {
      // A capture refusal (synthetic events, a vanished pointer) only costs
      // drag continuity outside the canvas.
    }
    this.target.tip_hide();
  }

  /** Lets go of whatever a press began: a view drag, or the scene's grab. */
  private release(): void {
    if (this.viewDrag !== null) {
      if (this.viewDrag.moved) this.suppressClick = true;
      this.viewDrag = null;
      this.rig.spin_pause();
    }
    if (!this.grabbing) return;
    this.grabbing = false;
    this.rig.spin_pause();
    if (this.target.grab_end()) this.suppressClick = true;
  }

  /** Steers the view from an empty-space drag: orbit, or pan. */
  private view_move(event: PointerEvent): void {
    const drag: ViewDrag | null = this.viewDrag;
    if (drag === null) return;
    this.rig.spin_pause();
    const dx: number = event.clientX - drag.lastX;
    const dy: number = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (!drag.moved && Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > DRAG_THRESHOLD_PX) {
      drag.moved = true;
      this.rig.touch_note();
    }
    if (!drag.moved) return;
    if (drag.pan || this.mode.flat()) {
      this.rig.pan(dx, dy);
    } else {
      this.rig.orbit(dx, dy);
    }
  }

  /** The two fingers down: their spread and their middle. */
  private fingers_read(): { spread: number; midX: number; midY: number } | null {
    const [a, b] = [...this.touches.values()];
    if (a === undefined || b === undefined) return null;
    return { spread: Math.hypot(a.x - b.x, a.y - b.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
  }

  /**
   * A second finger lands: whatever the first began — a pull, an orbit —
   * lets go, and the two steer the camera together until they lift.
   */
  private gesture_begin(): void {
    this.release();
    this.gestureHeld = true;
    this.pinch = this.fingers_read();
    this.rig.spin_pause();
    this.target.tip_hide();
  }

  /**
   * Two fingers move: spreading closes in and pinching draws back, as the
   * wheel does, and the pair moving together pans.
   */
  private gesture_move(): void {
    const now = this.fingers_read();
    if (now === null || this.pinch === null) return;
    if (now.spread > 0 && this.pinch.spread > 0) {
      // The spread's ratio is the zoom, in the wheel's own units, so a
      // pinch and a wheel travel the same.
      this.rig.dolly(Math.log(this.pinch.spread / now.spread) / 0.001, this.mode.untethered());
    }
    if (this.mode.flat() || !this.mode.untethered()) this.rig.pan(now.midX - this.pinch.midX, now.midY - this.pinch.midY);
    this.pinch = now;
  }
}
