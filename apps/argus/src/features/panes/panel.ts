/**
 * @file The PANES domain: every link group you have moved away from, as cards
 * to bring back.
 *
 * A group that leaves the stage is not gone — it waits in the dormant set
 * (see `app/dormant.ts`). This pane draws that set as a grid of cards: the
 * viewer's thumbnail, the group's label, and a badge per member. Pressing a
 * card restores the whole group onto the stage; the small DISMISS is the one
 * gesture that forgets it. The pane holds no state of its own — it renders the
 * set each time it is shown.
 *
 * @module
 */
import type { GroupSnapshot } from '../../app/dormant.js';

/** What the PANES pane asks of the surface. */
export interface PanesHost {
  /** The dormant groups, newest-first. */
  list(): GroupSnapshot[];
  /** Bring a group back onto the stage. */
  restore(id: string): void;
  /** Forget a group — the one explicit destroy. */
  dismiss(id: string): void;
}

/** The card grid of dormant groups. */
export class PanesPanel {
  private readonly grid: HTMLElement;
  private readonly empty: HTMLElement;

  /**
   * @param mount - The pane's root (from `tpl-pane-panes`).
   * @param host - The surface callbacks.
   */
  constructor(mount: HTMLElement, private readonly host: PanesHost) {
    this.grid = mount.querySelector<HTMLElement>('.panes-grid') as HTMLElement;
    this.empty = mount.querySelector<HTMLElement>('.panes-empty') as HTMLElement;
    this.grid.addEventListener('click', this.click_handle);
  }

  /** Redraws the grid from the current dormant set. */
  public render(): void {
    const groups: GroupSnapshot[] = this.host.list();
    this.empty.hidden = groups.length > 0;
    this.grid.replaceChildren(...groups.map((group): HTMLElement => this.card_build(group)));
  }

  /** Builds one card. Text is set as text, never HTML — a label is data. */
  private card_build(group: GroupSnapshot): HTMLElement {
    const card: HTMLButtonElement = document.createElement('button');
    card.className = 'panes-card';
    card.dataset['restore'] = group.id;
    card.title = `restore ${group.label}`;

    const figure: HTMLElement = document.createElement('span');
    figure.className = 'panes-card-figure';
    if (group.thumbnail !== undefined) {
      const image: HTMLImageElement = document.createElement('img');
      image.src = group.thumbnail;
      image.alt = '';
      figure.appendChild(image);
    } else {
      // No raster (a volume, or a buffer that would not capture): a glyph.
      figure.classList.add('panes-card-glyph');
      figure.textContent = group.members.includes('files') && !group.members.includes('viewer') ? '▤' : '▣';
    }
    card.appendChild(figure);

    const label: HTMLElement = document.createElement('span');
    label.className = 'panes-card-label';
    label.textContent = group.label;
    card.appendChild(label);

    const badges: HTMLElement = document.createElement('span');
    badges.className = 'panes-card-badges';
    for (const member of dedupe(group.members)) {
      const badge: HTMLElement = document.createElement('span');
      badge.className = 'panes-card-badge';
      badge.textContent = member.toUpperCase();
      badges.appendChild(badge);
    }
    card.appendChild(badges);

    const dismiss: HTMLButtonElement = document.createElement('button');
    dismiss.className = 'panes-card-dismiss';
    dismiss.dataset['dismiss'] = group.id;
    dismiss.title = `forget ${group.label}`;
    dismiss.textContent = 'DISMISS';
    card.appendChild(dismiss);

    return card;
  }

  /** One click either forgets a group (its DISMISS) or restores it. */
  private readonly click_handle = (event: MouseEvent): void => {
    const target: HTMLElement = event.target as HTMLElement;
    const dismiss: HTMLElement | null = target.closest<HTMLElement>('[data-dismiss]');
    if (dismiss !== null) {
      event.stopPropagation();
      const id: string = dismiss.dataset['dismiss'] ?? '';
      this.host.dismiss(id);
      this.render();
      return;
    }
    const card: HTMLElement | null = target.closest<HTMLElement>('[data-restore]');
    if (card !== null) this.host.restore(card.dataset['restore'] ?? '');
  };
}

/** Members, deduplicated, order kept — a group can hold two of a kind. */
function dedupe(members: string[]): string[] {
  return [...new Set(members)];
}
