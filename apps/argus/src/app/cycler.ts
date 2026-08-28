/**
 * @file The ambient pipeline cycler: registered pipelines take turns as a
 * slowly rotating miniature DAG in the header's left field.
 *
 * Ambient chrome in the cascade's spirit — but every shape shown is a real
 * registered pipeline's authored topology, fetched silently through the
 * same `pipeline diagram` command an operator could type. No interaction;
 * the full DAG pane is where engagement lives.
 *
 * @module
 */
import {
  pipelineDiagramModelSchema,
  DAG_MODEL_KINDS,
  type PipelineDiagramModel,
  type PipelineDiagramNode,
  type WireEnvelope,
} from '@fnndsc/menu';
import { DagScene, type SceneNode } from '../scene/dagScene.js';

/** How long each pipeline holds the stage. */
const CYCLE_MS: number = 20000;

/**
 * The cycler: feeds pipeline names through silent diagram fetches and
 * renders each arriving model in an ambient miniature scene.
 */
export class PipelineCycler {
  private readonly scene: DagScene;
  private readonly nameplate: HTMLElement;
  private readonly command_run: (line: string) => void;
  private names: string[] = [];
  private cursor: number = 0;
  private timer: number | null = null;

  /**
   * @param mount - The header element the miniature renders into.
   * @param nameplate - The element naming the pipeline on stage.
   * @param command_run - Runs a session command silently.
   */
  constructor(mount: HTMLElement, nameplate: HTMLElement, command_run: (line: string) => void) {
    this.nameplate = nameplate;
    this.command_run = command_run;
    this.scene = new DagScene(mount, {}, { ambient: true });
    new MutationObserver((): void => this.scene.palette_refresh()).observe(
      document.documentElement,
      { attributes: true, attributeFilter: ['data-lcars'] },
    );
    // The cycler is a header face now: returning to it after another face
    // (or a slid-away header) leaves the canvas at whatever size the hidden
    // box had, so refit whenever the face changes.
    new MutationObserver((): void => {
      window.setTimeout((): void => this.scene.size_fit(), 60);
    }).observe(document.body, { attributes: true, attributeFilter: ['data-header'] });
    window.addEventListener('resize', (): void => this.scene.size_fit());
  }

  /**
   * Starts cycling over the given pipeline names.
   *
   * @param names - Registered pipeline names, in display order.
   */
  public names_set(names: string[]): void {
    this.names = names;
    this.cursor = 0;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (names.length === 0) {
      return;
    }
    this.next_request();
    if (names.length > 1) {
      this.timer = window.setInterval((): void => this.next_request(), CYCLE_MS);
    }
  }

  /**
   * Observes envelopes for arriving pipeline diagrams and puts them on
   * stage. The pane and the cycler share the model; whichever asked, the
   * miniature shows the latest authored topology seen.
   *
   * @param envelope - Any envelope crossing the session.
   */
  public envelope_observe(envelope: WireEnvelope): void {
    if (envelope.model?.kind !== DAG_MODEL_KINDS.pipelineDiagram) {
      return;
    }
    const parsed = pipelineDiagramModelSchema.safeParse(envelope.model.data);
    if (!parsed.success) {
      return;
    }
    const model: PipelineDiagramModel = parsed.data;
    this.nameplate.textContent = model.name;
    this.scene.graph_set({
      nodes: model.nodes.map((node: PipelineDiagramNode): SceneNode => ({
        id: node.id,
        label: node.label,
        parentIds: node.parentIds,
        joinParentIds: node.joinParentIds,
      })),
    });
    this.scene.size_fit();
  }

  /** Asks for the next pipeline's diagram, silently. */
  private next_request(): void {
    const name: string | undefined = this.names[this.cursor % this.names.length];
    this.cursor++;
    if (name !== undefined) {
      this.command_run(`pipeline diagram ${name}`);
    }
  }
}
