/**
 * @file The empty pane: what a split creates, and the pane specifier.
 *
 * The pane holds a prompt, not a menu — whatever command runs there claims
 * the pane: an `fs.listing` turns it into a file browser, a `feed.dag`
 * into a DAG, a `pacs.query` opens the PACS workspace. New pane kinds
 * arrive with new envelope models; the chooser problem never scales
 * because there is no chooser. A few capsules shortcut the frequent
 * cases; a command with no pane projection shows its rendered output as a
 * one-shot result card, so every command is projectable.
 *
 * @module
 */
import type { WireEnvelope } from '@fnndsc/menu';
import type { ExecuteOutcome } from '../../calypso/client.js';

/** The pane kinds an envelope model can claim. */
export type ClaimKind = 'files' | 'dag' | 'pacs';

/** What the empty pane asks of its host. */
export interface EmptyPanelHandlers {
  /** Runs a command silently, results delivered to this pane alone. */
  execute: (line: string) => Promise<ExecuteOutcome>;
  /** A model claimed the pane: become `kind`, seeded with these envelopes. */
  claim: (kind: ClaimKind, envelopes: WireEnvelope[]) => void;
}

/** Envelope model kinds mapped to the pane kind they claim. */
const CLAIM_BY_MODEL: Readonly<Record<string, ClaimKind>> = {
  'fs.listing': 'files',
  'feed.dag': 'dag',
  'feed.list': 'dag',
  'pacs.query': 'pacs',
};

/**
 * The empty pane controller: shortcuts, the claiming prompt, and the
 * result card.
 */
export class EmptyPanel {
  private readonly result: HTMLElement;
  private readonly handlers: EmptyPanelHandlers;

  /**
   * @param mount - The stamped pane element.
   * @param handlers - Host callbacks.
   */
  constructor(mount: HTMLElement, handlers: EmptyPanelHandlers) {
    this.handlers = handlers;
    this.result = element_find(mount, '.empty-result');
    const prompt: HTMLInputElement = element_find(mount, '.empty-prompt') as HTMLInputElement;
    prompt.addEventListener('keydown', (event: KeyboardEvent): void => {
      if (event.key === 'Enter' && prompt.value.trim().length > 0) {
        void this.line_run(prompt.value.trim());
        prompt.value = '';
      }
    });
    element_find(mount, '.empty-go-files').addEventListener('click', (): void => {
      void this.line_run('ls .');
    });
    element_find(mount, '.empty-go-dag').addEventListener('click', (): void => {
      void this.line_run('proc feeds');
    });
    element_find(mount, '.empty-go-pacs').addEventListener('click', (): void => {
      this.handlers.claim('pacs', []);
    });
    // The new pane takes focus, and its focus is the prompt.
    window.setTimeout((): void => prompt.focus(), 0);
  }

  /**
   * Runs one line; a pane-shaped model claims the pane, anything else
   * becomes the result card.
   *
   * @param line - The command line.
   */
  private async line_run(line: string): Promise<void> {
    this.result.textContent = '…';
    let outcome: ExecuteOutcome;
    try {
      outcome = await this.handlers.execute(line);
    } catch (error: unknown) {
      this.result.textContent = error instanceof Error ? error.message : String(error);
      return;
    }
    for (const envelope of outcome.envelopes) {
      const kind: ClaimKind | undefined =
        envelope.model?.kind !== undefined ? CLAIM_BY_MODEL[envelope.model.kind] : undefined;
      if (kind !== undefined) {
        this.handlers.claim(kind, outcome.envelopes);
        return;
      }
    }
    const rendered: string = outcome.envelopes
      .map((envelope: WireEnvelope): string => envelope.rendered)
      .join('\n');
    this.result.textContent = ansi_strip(rendered) || '(no output)';
  }
}

/**
 * Finds a required descendant.
 *
 * @param mount - The pane element.
 * @param selector - The descendant's selector.
 * @returns The element.
 * @throws {Error} When absent.
 */
function element_find(mount: HTMLElement, selector: string): HTMLElement {
  const found: HTMLElement | null = mount.querySelector<HTMLElement>(selector);
  if (found === null) {
    throw new Error(`empty pane template is missing ${selector}`);
  }
  return found;
}

/**
 * Strips ANSI escape sequences from rendered text.
 *
 * @param text - The ANSI-decorated text.
 * @returns The plain text.
 */
function ansi_strip(text: string): string {
  return text.replace(/\x1b\[[0-9;:]*[A-Za-z]/g, '');
}
