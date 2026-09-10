/**
 * @file The tags pane: a DICOM instance's elements as a listing that
 * follows the image pane's slice.
 *
 * Slaved, never detached: the image pane writes the instance on screen as
 * its regard, the tags pane asks the kernel (`dcm tags`) and redraws. What
 * it draws is a listing in the façade's sense — module groups as levels
 * that fold, sequences as levels beneath their row, caps that sort, the
 * one filter strip — never a table of its own. A folder answer (constant
 * against varying) lists the same way, with a VARYING group whose values
 * read first..last and a distinct count.
 *
 * Identifying tags come flagged from the kernel and are shown redacted
 * until the REDACT block on the frame says otherwise. The kernel strips
 * nothing; the surface chooses.
 *
 * @module
 */
import type { DicomTag, DicomTagGroup, DicomTagsModel, DicomVaryingTag } from '@fnndsc/menu';
import { Listing, listingChild_declare, type ListingStateParts } from '../roster/listing.js';
import type { ListingTrait } from '../roster/row.js';

/** The groups in the order the listing shows them, VARYING last. */
const GROUP_ORDER: readonly string[] = ['patient', 'study', 'series', 'image', 'equipment', 'meta', 'private', 'other', 'varying'];

/** Groups folded shut at first: the reader asked for the image, not the file's plumbing. */
const FOLDED_AT_FIRST: ReadonlySet<string> = new Set<string>(['meta', 'private']);

/** What a redacted value reads as. */
const REDACTED: string = '••••';

/** One module group, or VARYING. */
interface GroupRow {
  group: string;
  rows: TagRow[];
}

/** One element, at any depth. */
interface TagRow {
  tag: string;
  name: string;
  vr: string;
  value: string;
  decoded?: string;
  phi: boolean;
  /** Sequence items, each a set of rows. */
  items: ItemRow[];
  /** For a varying tag: the distinct count across the folder. */
  distinct?: number;
  /** A stable key: the tag plus its place in the tree. */
  key: string;
}

/** One item of a sequence. */
interface ItemRow {
  index: number;
  rows: TagRow[];
  key: string;
}

/** Host callbacks. */
export interface TagsPanelHandlers {
  /** One line in the console. */
  note: (line: string) => void;
}

/** The tags pane controller. */
export class TagsPanel {
  private readonly pane: HTMLElement;
  private readonly title: HTMLElement;
  private readonly modeSpan: HTMLElement;
  private readonly redactBlock: HTMLButtonElement;
  private readonly listing: Listing<GroupRow>;
  private readonly handlers: TagsPanelHandlers;
  private redact: boolean = true;
  private model: DicomTagsModel | null = null;
  private groups: GroupRow[] = [];

  /**
   * @param mount - The stamped pane element.
   * @param handlers - Host callbacks.
   */
  constructor(mount: HTMLElement, handlers: TagsPanelHandlers) {
    this.handlers = handlers;
    this.pane = mount;
    this.title = element_find(mount, '.pane-title');
    this.modeSpan = element_find(mount, '.pane-mode');
    this.redactBlock = element_find(mount, '.tags-redact') as HTMLButtonElement;
    this.redactBlock.addEventListener('click', (): void => this.redact_set(!this.redact));
    const panel: HTMLElement = element_find(mount, '.tags-panel');
    this.listing = new Listing<GroupRow>({
      mount: panel,
      traits: this.groupTraits_declare(),
      key: (row: GroupRow): string => row.group,
      chrome: { root: mount, prefix: 'tags' },
      caps: 'root',
      row: {
        className: (): string => 'tags-group-row',
        groupClassName: (row: GroupRow): string => `tags-group tags-group-${row.group}`,
        decorate: (element: HTMLElement): void => {
          element.title = 'fold this group open or shut (it keeps its place)';
        },
      },
      child: listingChild_declare(
        (row: GroupRow): ReadonlyArray<TagRow> => row.rows,
        {
          traits: this.tagTraits_declare(),
          key: (row: TagRow): string => row.key,
          activatable: (row: TagRow): boolean => row.items.length > 0,
          row: {
            className: (row: TagRow): string => `tags-row${row.phi ? ' tags-phi' : ''}`,
            groupClassName: (): string => 'tags-sequence',
            decorate: (element: HTMLElement, row: TagRow): void => {
              element.title = row.items.length > 0 ? `${row.name}: fold the sequence open or shut` : `${row.tag} ${row.name}`;
            },
          },
          child: listingChild_declare(
            (row: TagRow): ReadonlyArray<ItemRow> => row.items,
            {
              traits: this.itemTraits_declare(),
              key: (row: ItemRow): string => row.key,
              row: { className: (): string => 'tags-item-row', groupClassName: (): string => 'tags-item' },
              child: listingChild_declare(
                (row: ItemRow): ReadonlyArray<TagRow> => row.rows,
                {
                  traits: this.tagTraits_declare(),
                  key: (row: TagRow): string => row.key,
                  activatable: (): boolean => false,
                  row: { className: (row: TagRow): string => `tags-row tags-row-deep${row.phi ? ' tags-phi' : ''}` },
                },
              ),
            },
          ),
        },
      ),
      state: (parts: ListingStateParts): string => this.stateLine_compose(parts),
      empty: (): HTMLElement => note_make('NO TAGS'),
    });
    this.redactBlock_paint();
    this.listing.rows_set([], { field: 'tags' });
  }

  /**
   * Shows a `dicom.tags` answer.
   *
   * @param model - The kernel's answer for one file or one folder.
   */
  public model_show(model: DicomTagsModel): void {
    this.model = model;
    this.title.textContent = `TAGS ${title_of(model)}`;
    this.pane.dataset['modality'] = modalityHue_of(model);
    this.groups = groups_build(model);
    this.listing.rows_set([{ key: model.path, rows: this.groups }], { field: model.path });
    this.listing.open_set(0, this.groups.map((group: GroupRow): string => group.group).filter((group: string): boolean => !FOLDED_AT_FIRST.has(group)));
    this.modeSpan.textContent = model.subject === 'folder' ? 'FOLDER' : '';
  }

  /** The path on stage, or null. */
  public path_get(): string | null {
    return this.model?.path ?? null;
  }

  /** Whether identifying values are hidden. */
  public redact_get(): boolean {
    return this.redact;
  }

  /**
   * Shows or hides identifying values; the block on the frame says which.
   */
  public redact_set(on: boolean): void {
    this.redact = on;
    this.redactBlock_paint();
    if (this.model !== null) this.listing.rows_set([{ key: this.model.path, rows: this.groups }], { field: this.model.path });
  }

  /** Opens or closes the filter strip; the language's `tags filter`. */
  public filter_set(text: string | null): void {
    if (text === null) {
      this.listing.filter_toggle(false);
      return;
    }
    this.listing.filter_toggle(true);
    this.listing.filter_set(text);
  }

  private stateLine_compose(parts: ListingStateParts): string {
    const count: number = this.groups.reduce((total: number, group: GroupRow): number => total + group.rows.length, 0);
    const words: string[] = [];
    if (this.model !== null && this.model.subject === 'folder') {
      words.push(this.model.read === this.model.of ? `${this.model.read} FILES` : `${this.model.read} OF ${this.model.of} FILES`);
      if (this.model.refused.length > 0) words.push(`REFUSED ${this.model.refused.length}`);
    }
    words.push(parts.filter !== '' ? parts.filter : `${count} TAGS`);
    if (this.redact) words.push('REDACTED');
    return words.join(' · ');
  }

  private redactBlock_paint(): void {
    this.redactBlock.textContent = this.redact ? 'REDACT ON' : 'REDACT OFF';
    this.redactBlock.classList.toggle('rail-off', !this.redact);
    this.pane.classList.toggle('tags-redacted', this.redact);
  }

  private value_cell(row: TagRow): HTMLElement {
    const cell: HTMLSpanElement = document.createElement('span');
    cell.className = 'tags-value';
    if (row.phi && this.redact) {
      cell.textContent = REDACTED;
      cell.title = 'identifying value, redacted; the REDACT block on the frame reveals it';
      return cell;
    }
    cell.textContent = row.value;
    if (row.decoded !== undefined) {
      const decoded: HTMLSpanElement = document.createElement('span');
      decoded.className = 'tags-decoded';
      decoded.textContent = ` ${row.decoded}`;
      cell.appendChild(decoded);
    }
    if (row.distinct !== undefined) {
      const distinct: HTMLSpanElement = document.createElement('span');
      distinct.className = 'tags-decoded';
      distinct.textContent = ` (${row.distinct} distinct)`;
      cell.appendChild(distinct);
    }
    return cell;
  }

  private groupTraits_declare(): ReadonlyArray<ListingTrait<GroupRow>> {
    return [
      fold_trait<GroupRow>((): boolean => true),
      {
        key: 'group',
        label: 'GROUP',
        className: 'tags-group-name',
        width: 'minmax(12em, 1fr)',
        cell: (row: GroupRow): string => row.group.toUpperCase(),
        compare: (row: GroupRow): number => GROUP_ORDER.indexOf(row.group),
      },
      {
        key: 'count',
        label: 'TAGS',
        className: 'tags-group-count',
        width: '5em',
        cell: (row: GroupRow): string => String(row.rows.length),
        compare: (row: GroupRow): number => row.rows.length,
      },
    ];
  }

  private tagTraits_declare(): ReadonlyArray<ListingTrait<TagRow>> {
    return [
      fold_trait<TagRow>((row: TagRow): boolean => row.items.length > 0),
      {
        key: 'tag',
        label: 'TAG',
        className: 'tags-tag',
        width: '7em',
        cell: (row: TagRow): string => row.tag,
        compare: (row: TagRow): string => row.tag,
      },
      {
        key: 'name',
        label: 'NAME',
        className: 'tags-name',
        width: 'minmax(8em, 1.4fr)',
        cell: (row: TagRow): string => row.name,
        compare: (row: TagRow): string => row.name.toLowerCase(),
      },
      {
        key: 'vr',
        label: 'VR',
        className: 'tags-vr',
        width: '2.4em',
        cell: (row: TagRow): string => row.vr,
        compare: (row: TagRow): string => row.vr,
      },
      {
        key: 'value',
        label: 'VALUE',
        className: 'tags-value-cell',
        width: 'minmax(6em, 2fr)',
        cell: (row: TagRow): HTMLElement => this.value_cell(row),
        // The filter and the sort read the value as shown: a redacted
        // value neither matches nor orders by what it hides.
        compare: (row: TagRow): string => (row.phi && this.redact ? REDACTED : `${row.value} ${row.decoded ?? ''}`).toLowerCase(),
      },
    ];
  }

  private itemTraits_declare(): ReadonlyArray<ListingTrait<ItemRow>> {
    return [
      fold_trait<ItemRow>((): boolean => true),
      {
        key: 'item',
        label: 'ITEM',
        className: 'tags-item-name',
        width: 'minmax(12em, 1fr)',
        cell: (row: ItemRow): string => `ITEM ${row.index}`,
        compare: (row: ItemRow): number => row.index,
      },
      {
        key: 'count',
        label: 'TAGS',
        className: 'tags-group-count',
        width: '5em',
        cell: (row: ItemRow): string => String(row.rows.length),
        compare: (row: ItemRow): number => row.rows.length,
      },
    ];
  }
}

/** The fold glyph column, drawn from the group's open state by the stylesheet. */
function fold_trait<T>(folds: (row: T) => boolean): ListingTrait<T> {
  return {
    key: 'fold',
    label: '',
    className: 'tags-fold',
    capped: false,
    width: '1.4em',
    cell: (row: T): HTMLElement => {
      const fold: HTMLSpanElement = document.createElement('span');
      fold.className = folds(row) ? 'tags-fold' : 'tags-fold tags-fold-none';
      return fold;
    },
  };
}

/** Builds the groups from the kernel's answer: constant tags by module, varying tags as one group. */
function groups_build(model: DicomTagsModel): GroupRow[] {
  const byGroup: Map<string, TagRow[]> = new Map<string, TagRow[]>();
  for (const tag of model.constant) {
    const group: DicomTagGroup = tag.group;
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group)?.push(tagRow_build(tag, `${group}/${tag.tag}`));
  }
  if (model.varying.length > 0) {
    byGroup.set(
      'varying',
      model.varying.map((tag: DicomVaryingTag): TagRow => ({
        tag: tag.tag,
        name: tag.name,
        vr: tag.vr,
        value: tag.distinct === 1 ? tag.first : `${tag.first} .. ${tag.last}`,
        phi: tag.phi,
        items: [],
        distinct: tag.distinct,
        key: `varying/${tag.tag}`,
      })),
    );
  }
  return GROUP_ORDER
    .filter((group: string): boolean => byGroup.has(group))
    .map((group: string): GroupRow => ({ group, rows: byGroup.get(group) ?? [] }));
}

/** One tag as a row, its sequence items as rows beneath. */
function tagRow_build(tag: DicomTag, key: string): TagRow {
  return {
    tag: tag.tag,
    name: tag.name,
    vr: tag.vr,
    value: tag.value,
    ...(tag.decoded !== undefined ? { decoded: tag.decoded } : {}),
    phi: tag.phi,
    items: (tag.items ?? []).map((item: DicomTag[], index: number): ItemRow => ({
      index: index + 1,
      key: `${key}/${index + 1}`,
      rows: item.map((inner: DicomTag): TagRow => tagRow_build(inner, `${key}/${index + 1}/${inner.tag}`)),
    })),
    key,
  };
}

/**
 * A bar-sized name for what is listed: an oxidicom file's instance number,
 * a folder's last segment, else the file name cut short. The whole path is
 * the row's own business, not the bar's.
 */
function title_of(model: DicomTagsModel): string {
  const name: string = model.path.replace(/\/$/, '').split('/').pop() ?? model.path;
  if (model.subject === 'folder') return name.length > 24 ? `${name.slice(0, 22)}…` : name;
  const instance: string | undefined = /^(\d+)-/.exec(name)?.[1];
  if (instance !== undefined) return `INSTANCE ${Number(instance)}`;
  return name.length > 24 ? `${name.slice(0, 22)}…` : name;
}

/** The frame's hue: the file's own modality, so the tags pane matches the image it follows. */
function modalityHue_of(model: DicomTagsModel): string {
  const modality: string = (model.constant.find((tag: DicomTag): boolean => tag.name === 'Modality')?.value ?? '').toUpperCase();
  return modality === 'MR' || modality === 'CT' || modality === 'PT' ? modality : 'OT';
}

function note_make(text: string): HTMLElement {
  const note: HTMLElement = document.createElement('div');
  note.className = 'tags-note';
  note.textContent = text;
  return note;
}

function element_find(mount: HTMLElement, selector: string): HTMLElement {
  const found: HTMLElement | null = mount.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`tags pane: missing ${selector}`);
  return found;
}
