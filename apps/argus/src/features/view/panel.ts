/**
 * @file The Viewer pane: a slaved projection of its group's regard.
 *
 * The viewer holds no state of its own and issues no gestures: it renders
 * whatever address its link group's regard names — an image through the
 * daemon's `/vfs` route, anything else as text — and retargets on every
 * write. Before the first indication it shows a defined awaiting-state:
 * "no regard yet" is schema-legal, not an error. Design record:
 * docs/aegis.adoc.
 *
 * @module
 */
import type { RegardValue } from '../../app/subjects.js';

/** What the viewer asks of its host. */
export interface ViewerHandlers {
  /** Fetches a file's text content (silent, pane-local traffic). */
  content_fetch: (path: string) => Promise<string>;
  /** Builds the token-gated image URL for a path. */
  imageUrl_build: (path: string) => string;
  /** Whether a path renders as an image. */
  path_isImage: (path: string) => boolean;
}

/**
 * The viewer pane controller.
 */
export class ViewerPanel {
  private readonly container: HTMLElement;
  private readonly title: HTMLElement;
  private readonly handlers: ViewerHandlers;
  /** Guards against a slow fetch painting over a newer indication. */
  private currentAddress: string | null = null;

  /**
   * @param container - The element content renders into.
   * @param title - The pane header's title element.
   * @param handlers - Host callbacks.
   */
  constructor(container: HTMLElement, title: HTMLElement, handlers: ViewerHandlers) {
    this.container = container;
    this.title = title;
    this.handlers = handlers;
    this.awaiting_render();
  }

  /**
   * Renders one regard value: the group indicated a new address.
   *
   * @param value - The group's retained regard.
   */
  public regard_show(value: RegardValue): void {
    this.currentAddress = value.address;
    this.title.textContent = `VIEWER — ${value.address}`.toUpperCase();
    if (this.handlers.path_isImage(value.address)) {
      this.container.replaceChildren();
      const image: HTMLImageElement = document.createElement('img');
      image.className = 'files-image';
      image.src = this.handlers.imageUrl_build(value.address);
      image.alt = value.address;
      this.container.appendChild(image);
      return;
    }
    void this.handlers.content_fetch(value.address).then((content: string): void => {
      if (this.currentAddress !== value.address) {
        return;
      }
      this.container.replaceChildren();
      // A blank result (an unreadable address, a directory) stays a defined
      // state, never a silently empty pane.
      if (content.trim().length === 0) {
        const hint: HTMLParagraphElement = document.createElement('p');
        hint.className = 'files-empty';
        hint.textContent = `NO PREVIEW — ${value.address.toUpperCase()}`;
        this.container.appendChild(hint);
        return;
      }
      const body: HTMLPreElement = document.createElement('pre');
      body.className = 'files-content';
      body.textContent = content;
      this.container.appendChild(body);
    });
  }

  /** Paints the awaiting-state shown before the group's first indication. */
  private awaiting_render(): void {
    this.container.replaceChildren();
    const hint: HTMLParagraphElement = document.createElement('p');
    hint.className = 'files-empty';
    hint.textContent = 'NO REGARD — INDICATE A FILE OR NODE IN THIS PANE’S GROUP';
    this.container.appendChild(hint);
  }
}
