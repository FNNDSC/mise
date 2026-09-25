/**
 * @file The stars of a scene: every node a point of light, the threads that
 * join them, and the nebulae that mark a cluster.
 *
 * A scene draws its field as stars from afar; the field holds the two
 * layers (glow and embers), the thread lines, and the nebulae, keeps each
 * star's slot, and lets a molecule's stars and threads fade out as the
 * molecule turns solid and back in as it turns to stars again.
 *
 * @module
 */
import * as THREE from 'three';
import { NEBULA_OPACITY, THREAD_OPACITY } from './constants.js';
import { nebulaTexture_get } from './nebula.js';
import { starLayer_make, starScale_of, type StarEntry, type StarLayer } from './stars.js';

/** A cluster's nebula: whose it is, where, how far it reaches. */
export interface Nebula {
  id: string;
  position: THREE.Vector3;
  radius: number;
}

/** The stars, threads and nebulae of one scene. */
export class StarField {
  private readonly parent: THREE.Object3D;
  private stars: StarEntry[] = [];
  private index: Map<string, number> = new Map();
  private nebulaList: Nebula[] = [];
  private materials: THREE.ShaderMaterial[] = [];
  private layers: Array<{ alpha: THREE.BufferAttribute; base: Float32Array }> = [];
  private threads: { attribute: THREE.BufferAttribute; base: Float32Array } | null = null;
  private starsTouched: boolean = false;
  private threadsTouched: boolean = false;

  /**
   * @param parent - Where the field is drawn.
   */
  constructor(parent: THREE.Object3D) {
    this.parent = parent;
  }

  /** How many stars are drawn. */
  public count(): number {
    return this.stars.length;
  }

  /** Every star, in the order drawn. */
  public list(): ReadonlyArray<StarEntry> {
    return this.stars;
  }

  /** The first star drawn for a node, if any. */
  public entry(id: string): StarEntry | undefined {
    const at: number | undefined = this.index.get(id);
    return at === undefined ? undefined : this.stars[at];
  }

  /** Every node drawn as a star. */
  public ids(): IterableIterator<string> {
    return this.index.keys();
  }

  /** Every nebula. */
  public nebulae(): ReadonlyArray<Nebula> {
    return this.nebulaList;
  }

  /**
   * Draws stars as two layers — the glow, and the embers over it.
   *
   * @param entries - The stars.
   * @param pixelRatio - The display's pixel ratio.
   * @param heightPx - The canvas's height, in device pixels.
   * @param fovDeg - The camera's vertical field of view.
   */
  public draw(entries: StarEntry[], pixelRatio: number, heightPx: number, fovDeg: number): void {
    for (const entry of entries) {
      if (!this.index.has(entry.id)) this.index.set(entry.id, this.stars.length);
      this.stars.push(entry);
    }
    for (const ember of [false, true]) {
      const layer: StarEntry[] = entries.filter((entry: StarEntry): boolean => entry.ember === ember);
      if (layer.length === 0) continue;
      const drawn: StarLayer = starLayer_make(layer, ember, this.layers.length, pixelRatio);
      this.layers.push({ alpha: drawn.alpha, base: drawn.base });
      this.parent.add(drawn.points);
      this.materials.push(drawn.material);
    }
    this.scale_update(heightPx, fovDeg);
  }

  /**
   * Keeps the stars' pixel scale true to the canvas and the camera.
   *
   * @param heightPx - The canvas's height, in device pixels.
   * @param fovDeg - The camera's vertical field of view.
   */
  public scale_update(heightPx: number, fovDeg: number): void {
    if (this.materials.length === 0) return;
    const scale: number = starScale_of(heightPx, fovDeg);
    for (const material of this.materials) {
      const uniform = material.uniforms['scale'];
      if (uniform !== undefined) uniform.value = scale;
    }
  }

  /**
   * Draws the faint threads between stars, as one line batch.
   *
   * @param positions - Segment ends, six numbers a segment.
   * @param colors - Their colours, six numbers a segment.
   */
  public threads_draw(positions: ReadonlyArray<number>, colors: ReadonlyArray<number>): void {
    if (positions.length === 0) return;
    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions as number[], 3));
    const attribute: THREE.Float32BufferAttribute = new THREE.Float32BufferAttribute(colors as number[], 3);
    geometry.setAttribute('color', attribute);
    this.threads = { attribute, base: Float32Array.from(colors) };
    this.parent.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: THREAD_OPACITY, blending: THREE.AdditiveBlending, depthWrite: false,
    })));
  }

  /**
   * A cluster's handle while the scene draws stars: a soft glow facing the
   * camera.
   *
   * @param id - The cluster's anchor.
   * @param position - Where it stands.
   * @param radius - How far it reaches.
   * @param color - Its hue.
   * @param dim - Drawn at a third of its light.
   */
  public nebula_add(id: string, position: THREE.Vector3, radius: number, color: THREE.Color, dim: boolean): void {
    const sprite: THREE.Sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: nebulaTexture_get(),
      color,
      transparent: true,
      opacity: dim ? NEBULA_OPACITY / 3 : NEBULA_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    sprite.position.copy(position);
    sprite.scale.setScalar(radius * 2);
    sprite.renderOrder = 0;
    this.parent.add(sprite);
    this.nebulaList.push({ id, position: position.clone(), radius });
  }

  /**
   * Fades stars to a share of their resting light (0 gone, 1 as drawn).
   *
   * @param entries - The stars.
   * @param share - How much of their light they keep.
   */
  public stars_fade(entries: ReadonlyArray<StarEntry>, share: number): void {
    for (const entry of entries) {
      const layer = entry.layer === undefined ? undefined : this.layers[entry.layer];
      if (layer === undefined || entry.slot === undefined) continue;
      layer.alpha.setX(entry.slot, (layer.base[entry.slot] ?? 1) * share);
      this.starsTouched = true;
    }
  }

  /**
   * Fades thread segments to a share of their resting colour.
   *
   * @param segments - The segments, by index.
   * @param share - How much of their colour they keep.
   */
  public threads_fade(segments: ReadonlyArray<number>, share: number): void {
    if (this.threads === null || segments.length === 0) return;
    const colors = this.threads.attribute.array as Float32Array;
    const base: Float32Array = this.threads.base;
    for (const segment of segments) {
      for (let k = segment * 6; k < segment * 6 + 6; k++) colors[k] = (base[k] ?? 0) * share;
    }
    this.threadsTouched = true;
  }

  /** Sends this frame's fades to the screen. */
  public flush(): void {
    if (this.starsTouched) for (const layer of this.layers) layer.alpha.needsUpdate = true;
    if (this.threadsTouched && this.threads !== null) this.threads.attribute.needsUpdate = true;
    this.starsTouched = false;
    this.threadsTouched = false;
  }

  /** Forgets everything: the scene is being redrawn (its parent already cleared). */
  public clear(): void {
    this.stars = [];
    this.index = new Map();
    this.nebulaList = [];
    this.materials = [];
    this.layers = [];
    this.threads = null;
    this.starsTouched = false;
    this.threadsTouched = false;
  }
}
