/**
 * @file The entered feed's part of a graph's mode frame: NOTE (ADD NOTE /
 * EDIT NOTE once the note is read), TAG, RENAME, and the marks beneath them
 * — the feed's tags, each with the × that takes it off, then the note's first
 * line. It stands only while a feed is on stage, and reads the feed's facts
 * when the feed is entered (the note is never read for a listing).
 *
 * @module
 */

/** What the frame asks of the pane that holds it. */
export interface FeedFrameHandlers {
  /** The feed on stage, or null at the roster. */
  shown: () => number | null;
  /** The name of the feed on stage, for RENAME's question. */
  name: () => string;
  /** The feed was renamed: the pane's bar says the new name. */
  renamed: (feedId: number, title: string) => void;
  feed_entered?: (feedId: number) => void;
  feed_note?: (feedId: number) => void;
  feed_tag?: (feedId: number, worn: ReadonlyArray<string>) => void;
  feed_rename?: (feedId: number, title: string) => void;
  feed_untag?: (feedId: number, tag: string) => void;
}

/** The facts a feed's frame shows, as read on entry. */
export interface FeedFrameFacts {
  /** The note's text; null when it could not be read. */
  note: string | null;
  tags: ReadonlyArray<string>;
  /** The feed's name now; absent or empty when not read. */
  title?: string;
}

/** The entered feed's verbs and marks on a graph's frame. */
export class FeedFrame {
  private readonly notePill: HTMLElement | null;
  private readonly tagPill: HTMLElement | null;
  private readonly renamePill: HTMLElement | null;
  private readonly marks: HTMLElement | null;
  private readonly handlers: FeedFrameHandlers;
  /** The feed whose facts the frame holds, or asked for. */
  private readFeedId: number | null = null;
  /** The tags the feed on stage wears, as last read. */
  private tags: string[] = [];

  /**
   * @param frame - The mode frame holding `.dag-note`, `.dag-tag`, `.dag-rename` and `.dag-marks`.
   * @param handlers - The pane's callbacks.
   */
  constructor(frame: HTMLElement | null, handlers: FeedFrameHandlers) {
    this.handlers = handlers;
    this.notePill = frame?.querySelector<HTMLElement>('.dag-note') ?? null;
    this.tagPill = frame?.querySelector<HTMLElement>('.dag-tag') ?? null;
    this.renamePill = frame?.querySelector<HTMLElement>('.dag-rename') ?? null;
    this.marks = frame?.querySelector<HTMLElement>('.dag-marks') ?? null;
    const on = (pill: HTMLElement | null, act: (feedId: number) => void): void => {
      pill?.addEventListener('click', (): void => { const feedId: number | null = handlers.shown(); if (feedId !== null) act(feedId); });
    };
    on(this.notePill, (feedId: number): void => handlers.feed_note?.(feedId));
    on(this.tagPill, (feedId: number): void => handlers.feed_tag?.(feedId, this.tags));
    on(this.renamePill, (feedId: number): void => handlers.feed_rename?.(feedId, handlers.name()));
  }

  /**
   * Stands the frame's feed part, or stands it down at the roster (where the
   * next feed entered is read afresh, the same one included).
   *
   * @param shown - Whether a feed is on stage.
   */
  public shown_set(shown: boolean): void {
    for (const element of [this.notePill, this.tagPill, this.renamePill, this.marks]) if (element !== null) element.hidden = !shown;
    if (!shown) this.readFeedId = null;
  }

  /** A feed arrived on stage: its facts are read, unless they already are. */
  public arrived(feedId: number): void {
    if (this.readFeedId !== feedId) this.refresh();
  }

  /** Reads the facts of the feed on stage again. */
  public refresh(): void {
    const feedId: number | null = this.handlers.shown();
    if (feedId === null) return;
    this.readFeedId = feedId;
    this.handlers.feed_entered?.(feedId);
  }

  /**
   * Shows the entered feed's facts; a read for a feed no longer on stage is dropped.
   *
   * @param feedId - The feed read.
   * @param facts - Its note, tags and name.
   */
  public show(feedId: number, facts: FeedFrameFacts): void {
    if (feedId !== this.handlers.shown() || this.marks === null) return;
    if (facts.title !== undefined && facts.title !== '') this.handlers.renamed(feedId, facts.title);
    this.tags = [...facts.tags];
    const note: string = (facts.note ?? '').trim();
    if (this.notePill !== null) this.notePill.textContent = facts.note === null ? 'NOTE' : note === '' ? 'ADD NOTE' : 'EDIT NOTE';
    this.marks.replaceChildren();
    for (const tag of facts.tags) {
      const mark: HTMLSpanElement = document.createElement('span');
      mark.className = 'feedlist-tag dag-mark';
      mark.dataset['tag'] = tag;
      mark.textContent = `#${tag}`;
      const remove: HTMLSpanElement = document.createElement('span');
      remove.className = 'feedlist-tag-x';
      remove.title = `take ${tag} off this feed (setfattr -x)`;
      remove.textContent = '×';
      remove.addEventListener('click', (): void => this.handlers.feed_untag?.(feedId, tag));
      mark.append(remove);
      this.marks.append(mark);
    }
    if (note !== '') {
      const line: HTMLSpanElement = document.createElement('span');
      line.className = 'dag-note-line';
      line.textContent = note.split('\n')[0] ?? '';
      line.title = note;
      this.marks.append(line);
    }
  }
}
