/**
 * @file A container's resources as folders: `<container>/<kind>/<name>/…`
 * (docs/stratus.adoc, D4 and D5).
 *
 * Beside its child containers, every container level holds one folder per
 * resource kind (`instances networks loadbalancers volumes buckets dns`),
 * listing the session's region (DNS is global). A resource is a folder of
 * field files: `name id state region created tags info.json` for every kind,
 * plus the kind's own (an instance `shape zone ips`, a volume `size
 * attached`, a load balancer `ip shape`). A network holds `subnets/` and
 * `securitygroups/`; a bucket holds `objects/`, its objects as files (a `/`
 * in an object's name is a folder), and `links`, its pre-authenticated
 * links; a DNS zone holds `records/`, a file per record name whose text is
 * the record set as zone-file lines (the apex is `@`).
 *
 * Duplicate display names wear `~<id6>` (`names.ts`). Every answer is kept
 * for the cache's life. The tree reads only: object bytes are read, never
 * written (D6).
 *
 * @module
 */
import type { VFSItem } from '@fnndsc/fond';
import type {
  CloudBucket, CloudDnsZone, CloudDriver, CloudInstance, CloudLink, CloudLoadBalancer, CloudNetwork, CloudObject, CloudRecord, CloudResource,
  CloudSecurityGroup, CloudSubnet, CloudVolume, ResourceCounts, ResourceKind,
} from '../cloud/driver.js';
import type { AnswerCache } from '../cache.js';
import { UNCOUNTED } from './look.js';
import { ambiguity_words, segment_resolve, segments_assign, type Segment, type SegmentMatch } from '../names.js';

/** The kind folders a container level holds, in listing order. */
export const KIND_FOLDERS: ReadonlyArray<ResourceKind> = ['instances', 'networks', 'loadbalancers', 'volumes', 'buckets', 'dns'];
/**
 * Whether a path segment is a container level's kind folder.
 *
 * @param segment - The segment.
 * @returns True for `instances networks loadbalancers volumes buckets dns`.
 */
export function kindFolder_is(segment: string | undefined): segment is ResourceKind {
  return KIND_FOLDERS.some((kind: ResourceKind): boolean => kind === segment);
}

/** The kind folders a network holds. */
export const NETWORK_FOLDERS: ReadonlyArray<ResourceKind> = ['subnets', 'securitygroups'];
/** The type word a resource of each kind wears in `ls -l` (D5). */
export const RESOURCE_TYPES: Readonly<Record<ResourceKind, string>> = {
  instances: 'instance', networks: 'network', subnets: 'subnet', securitygroups: 'securitygroup',
  loadbalancers: 'loadbalancer', volumes: 'volume', buckets: 'bucket', dns: 'dnszone',
};
/** The largest object `cat` reads through the tree, in bytes. */
export const OBJECT_READ_LIMIT: number = 16 * 1024 * 1024;

/** A file in a folder of fields. */
interface Field {
  readonly name: string;
  readonly text: string;
}

/** What a path under a container's kind folders came to. */
export type ResourceNode =
  | { readonly kind: 'listing'; readonly list: () => Promise<VFSItem[]> }
  | { readonly kind: 'file'; readonly text: string }
  | { readonly kind: 'bytes'; readonly size: number; readonly read: () => Promise<Buffer> }
  | { readonly kind: 'refused'; readonly reason: string; readonly errno?: 'EPERM' | 'EACCES' }
  | { readonly kind: 'missing'; readonly reason?: string };

/** How the resource tree is made. */
export interface ResourceTreeOptions {
  readonly driver: CloudDriver;
  readonly cache: AnswerCache;
  /** The clock for dates the cloud does not give. */
  readonly now: () => string;
}

/** The resources of containers, as folders. */
export class ResourceTree {
  private readonly driver: CloudDriver;
  private readonly cache: AnswerCache;
  private readonly now: () => string;

  constructor(options: ResourceTreeOptions) {
    this.driver = options.driver;
    this.cache = options.cache;
    this.now = options.now;
  }

  // ---- the cloud, cached ----

  private kind_list(kind: ResourceKind, containerId: string, region: string): Promise<CloudResource[]> {
    const driver: CloudDriver = this.driver;
    const asks: Record<ResourceKind, () => Promise<CloudResource[]>> = {
      instances: (): Promise<CloudInstance[]> => driver.instances_list(containerId, region),
      networks: (): Promise<CloudNetwork[]> => driver.networks_list(containerId, region),
      subnets: (): Promise<CloudSubnet[]> => driver.subnets_list(containerId, region),
      securitygroups: (): Promise<CloudSecurityGroup[]> => driver.securitygroups_list(containerId, region),
      loadbalancers: (): Promise<CloudLoadBalancer[]> => driver.loadbalancers_list(containerId, region),
      volumes: (): Promise<CloudVolume[]> => driver.volumes_list(containerId, region),
      buckets: (): Promise<CloudBucket[]> => driver.buckets_list(containerId, region),
      dns: (): Promise<CloudDnsZone[]> => driver.dns_list(containerId, region),
    };
    return this.cache.answer_get(`${kind}/${containerId}/${region}`, asks[kind]);
  }

  private counts_get(containerId: string, region: string): Promise<ResourceCounts> {
    return this.cache.answer_get(`search/${containerId}/${region}`, (): Promise<ResourceCounts> => this.driver.resources_search(containerId, region));
  }

  private objects_list(bucket: string, region: string): Promise<CloudObject[]> {
    return this.cache.answer_get(`objects/${bucket}/${region}`, (): Promise<CloudObject[]> => this.driver.objects_list(bucket, region));
  }

  private links_list(bucket: string, region: string): Promise<CloudLink[]> {
    return this.cache.answer_get(`links/${bucket}/${region}`, (): Promise<CloudLink[]> => this.driver.links_list(bucket, region));
  }

  private records_list(zoneId: string, region: string): Promise<CloudRecord[]> {
    return this.cache.answer_get(`records/${zoneId}`, (): Promise<CloudRecord[]> => this.driver.records_list(zoneId, region));
  }

  // ---- a container level ----

  /**
   * The kind folders of a container level, each counting its resources by
   * one search; a search that fails leaves the counts out, never the folders.
   *
   * @param containerId - The container.
   * @param region - The session's region.
   * @returns One folder item per kind.
   */
  async kindFolders_items(containerId: string, region: string): Promise<VFSItem[]> {
    let counts: ResourceCounts = {};
    let counted: boolean = true;
    try {
      counts = await this.counts_get(containerId, region);
    } catch {
      counted = false;
    }
    return KIND_FOLDERS.map((kind: ResourceKind): VFSItem => this.kindFolder_item(kind, counted ? (counts[kind] ?? 0) : null));
  }

  private kindFolder_item(name: string, count: number | null): VFSItem {
    return { name, type: 'kind', size: count ?? 0, owner: 'cloud', date: this.now(), ...(count === null ? { status: UNCOUNTED } : {}) };
  }

  /**
   * The node a path names below a container level.
   *
   * @param containerId - The container whose level the path starts at.
   * @param region - The session's region.
   * @param segments - The path's segments from the kind folder on.
   * @param owner - Who rows are shown as owned by.
   * @returns The node.
   */
  async node_resolve(containerId: string, region: string, segments: ReadonlyArray<string>, owner: string): Promise<ResourceNode> {
    const [kindName, resourceSegment, ...rest] = segments;
    if (!kindFolder_is(kindName)) return { kind: 'missing' };
    const kind: ResourceKind = kindName;
    const resources: CloudResource[] = await this.kind_list(kind, containerId, region);
    if (resourceSegment === undefined) return { kind: 'listing', list: async (): Promise<VFSItem[]> => this.resources_items(kind, resources, owner) };
    const match: SegmentMatch<CloudResource> = segment_resolve(resources, resourceSegment);
    if (match.kind === 'ambiguous') return { kind: 'missing', reason: ambiguity_words(resourceSegment, match.segments) };
    if (match.kind === 'none') return { kind: 'missing' };
    return this.resourceNode_resolve(kind, match.item, containerId, region, rest, owner);
  }

  /** The node inside one resource. */
  private async resourceNode_resolve(kind: ResourceKind, resource: CloudResource, containerId: string, region: string, segments: ReadonlyArray<string>, owner: string): Promise<ResourceNode> {
    const fields: Field[] = await this.fields_of(kind, resource, containerId, region);
    const folders: string[] = this.innerFolders_of(kind);
    if (segments.length === 0) {
      return {
        kind: 'listing',
        list: async (): Promise<VFSItem[]> => [
          ...fields.map((field: Field): VFSItem => this.file_item(field.name, Buffer.byteLength(field.text), owner)),
          ...(await this.innerFolder_items(kind, resource, containerId, region)),
        ],
      };
    }
    const [head, ...rest] = segments;
    if (folders.includes(head)) return this.innerNode_resolve(kind, head, resource, containerId, region, rest, owner);
    if (rest.length > 0) return { kind: 'missing' };
    const field: Field | undefined = fields.find((entry: Field): boolean => entry.name === head);
    return field === undefined ? { kind: 'missing' } : { kind: 'file', text: field.text };
  }

  /** The folders a resource of a kind holds beside its fields. */
  private innerFolders_of(kind: ResourceKind): string[] {
    if (kind === 'networks') return [...NETWORK_FOLDERS];
    if (kind === 'buckets') return ['objects'];
    if (kind === 'dns') return ['records'];
    return [];
  }

  /** The folder items a resource holds beside its fields, counted. */
  private async innerFolder_items(kind: ResourceKind, resource: CloudResource, containerId: string, region: string): Promise<VFSItem[]> {
    if (kind === 'networks') {
      const items: VFSItem[] = [];
      for (const inner of NETWORK_FOLDERS) items.push(this.kindFolder_item(inner, (await this.networkMembers_list(inner, resource.id, containerId, region)).length));
      return items;
    }
    if (kind === 'buckets') return [this.kindFolder_item('objects', (await this.objects_list(resource.name, region)).length)];
    if (kind === 'dns') return [this.kindFolder_item('records', recordSets_of(await this.records_list(resource.id, region), resource.name).length)];
    return [];
  }

  /** A network's subnets or security groups. */
  private async networkMembers_list(inner: ResourceKind, networkId: string, containerId: string, region: string): Promise<CloudResource[]> {
    const members: CloudResource[] = await this.kind_list(inner, containerId, region);
    return members.filter((member: CloudResource): boolean => (member as CloudSubnet | CloudSecurityGroup).networkId === networkId);
  }

  /** The node inside a resource's own folder (`subnets/`, `objects/`, `records/`). */
  private async innerNode_resolve(kind: ResourceKind, folder: string, resource: CloudResource, containerId: string, region: string, segments: ReadonlyArray<string>, owner: string): Promise<ResourceNode> {
    if (kind === 'networks') {
      const inner: ResourceKind = folder === 'subnets' ? 'subnets' : 'securitygroups';
      const members: CloudResource[] = await this.networkMembers_list(inner, resource.id, containerId, region);
      if (segments.length === 0) return { kind: 'listing', list: async (): Promise<VFSItem[]> => this.resources_items(inner, members, owner) };
      const match: SegmentMatch<CloudResource> = segment_resolve(members, segments[0]);
      if (match.kind === 'ambiguous') return { kind: 'missing', reason: ambiguity_words(segments[0], match.segments) };
      if (match.kind === 'none') return { kind: 'missing' };
      return this.resourceNode_resolve(inner, match.item, containerId, region, segments.slice(1), owner);
    }
    if (kind === 'buckets') return this.objectNode_resolve(resource.name, region, segments, owner);
    return this.recordNode_resolve(resource, region, segments, owner);
  }

  /** A path inside a bucket's `objects/`: a `/` in an object's name is a folder. */
  private async objectNode_resolve(bucket: string, region: string, segments: ReadonlyArray<string>, owner: string): Promise<ResourceNode> {
    const objects: CloudObject[] = await this.objects_list(bucket, region);
    const prefix: string = segments.length === 0 ? '' : `${segments.join('/')}/`;
    const whole: string = segments.join('/');
    const exact: CloudObject | undefined = objects.find((object: CloudObject): boolean => object.name === whole);
    if (exact !== undefined) {
      if (exact.size > OBJECT_READ_LIMIT) {
        return { kind: 'refused', reason: `${exact.size} bytes is past what cat reads through the tree (${OBJECT_READ_LIMIT}); it stays in the bucket` };
      }
      return { kind: 'bytes', size: exact.size, read: (): Promise<Buffer> => this.driver.object_read(bucket, exact.name, region) };
    }
    const inside: CloudObject[] = objects.filter((object: CloudObject): boolean => object.name.startsWith(prefix));
    if (segments.length > 0 && inside.length === 0) return { kind: 'missing' };
    return { kind: 'listing', list: async (): Promise<VFSItem[]> => this.objectLevel_items(inside, prefix, owner) };
  }

  /** One level of a bucket's objects: files, and folders for the next `/`. */
  private objectLevel_items(objects: ReadonlyArray<CloudObject>, prefix: string, owner: string): VFSItem[] {
    const folders: Map<string, number> = new Map();
    const items: VFSItem[] = [];
    for (const object of objects) {
      const rest: string = object.name.slice(prefix.length);
      const slash: number = rest.indexOf('/');
      if (slash === -1) {
        items.push({ name: rest, type: 'object', size: object.size, owner, date: object.modified !== '' ? object.modified : this.now() });
      } else {
        const folder: string = rest.slice(0, slash);
        folders.set(folder, (folders.get(folder) ?? 0) + 1);
      }
    }
    const folderItems: VFSItem[] = [...folders.entries()].map(([name, count]: [string, number]): VFSItem => this.kindFolder_item(name, count));
    return [...folderItems, ...items].sort((a: VFSItem, b: VFSItem): number => a.name.localeCompare(b.name));
  }

  /** A path inside a DNS zone's `records/`. */
  private async recordNode_resolve(zone: CloudResource, region: string, segments: ReadonlyArray<string>, owner: string): Promise<ResourceNode> {
    const sets: RecordSet[] = recordSets_of(await this.records_list(zone.id, region), zone.name);
    if (segments.length === 0) {
      return {
        kind: 'listing',
        list: async (): Promise<VFSItem[]> => sets.map((set: RecordSet): VFSItem => ({
          name: set.name, type: 'record', size: Buffer.byteLength(set.text), owner, date: this.now(), title: set.types.join(' '),
        })),
      };
    }
    if (segments.length !== 1) return { kind: 'missing' };
    const set: RecordSet | undefined = sets.find((entry: RecordSet): boolean => entry.name === segments[0]);
    return set === undefined ? { kind: 'missing' } : { kind: 'file', text: set.text };
  }

  // ---- rows and fields ----

  /** A kind's resources as rows. */
  private resources_items(kind: ResourceKind, resources: ReadonlyArray<CloudResource>, owner: string): VFSItem[] {
    return segments_assign(resources).map((entry: Segment<CloudResource>): VFSItem => {
      const resource: CloudResource = entry.item;
      const title: string = resourceTitle_of(kind, resource);
      return {
        name: entry.segment,
        type: RESOURCE_TYPES[kind],
        size: 0,
        owner,
        date: resource.created !== '' ? resource.created : this.now(),
        status: resource.state,
        ...(title !== '' ? { title } : {}),
        tags: Object.entries(resource.tags).map(([key, value]: [string, string]): string => `${key}=${value}`),
      };
    });
  }

  private file_item(name: string, size: number, owner: string): VFSItem {
    return { name, type: 'file', size, owner, date: this.now() };
  }

  /** Every field a resource of a kind has, in the order a listing shows them. */
  private async fields_of(kind: ResourceKind, resource: CloudResource, containerId: string, region: string): Promise<Field[]> {
    const tagLines: string = Object.entries(resource.tags).map(([key, value]: [string, string]): string => `${key}=${value}\n`).join('');
    const fields: Field[] = [
      { name: 'name', text: `${resource.name}\n` },
      { name: 'id', text: `${resource.id}\n` },
      { name: 'state', text: `${resource.state}\n` },
      { name: 'region', text: `${resource.region}\n` },
      { name: 'created', text: `${resource.created}\n` },
      { name: 'tags', text: tagLines },
    ];
    if (kind === 'instances') {
      const instance: CloudInstance = resource as CloudInstance;
      fields.push({ name: 'shape', text: `${instance.shape}\n` }, { name: 'zone', text: `${instance.zone}\n` }, { name: 'ips', text: lines_of(instance.ips) });
    } else if (kind === 'volumes') {
      const volume: CloudVolume = resource as CloudVolume;
      fields.push({ name: 'size', text: `${volume.sizeGib} GiB\n` }, { name: 'attached', text: `${await this.attachedName_of(volume, containerId, region)}\n` });
    } else if (kind === 'loadbalancers') {
      const balancer: CloudLoadBalancer = resource as CloudLoadBalancer;
      fields.push({ name: 'ip', text: lines_of(balancer.ips) }, { name: 'shape', text: `${balancer.shape}\n` });
    } else if (kind === 'buckets') {
      fields.push({ name: 'links', text: links_text(await this.links_list(resource.name, region)) });
    }
    fields.push({ name: 'info.json', text: `${JSON.stringify(resource.raw, null, 2)}\n` });
    return fields;
  }

  /** What a volume is attached to: the instance's name when it is in the same container, else its id, else `no`. */
  private async attachedName_of(volume: CloudVolume, containerId: string, region: string): Promise<string> {
    if (volume.attachedTo === null) return 'no';
    const instances: CloudResource[] = await this.kind_list('instances', containerId, region);
    return instances.find((instance: CloudResource): boolean => instance.id === volume.attachedTo)?.name ?? volume.attachedTo;
  }
}

/** One record name's set: its file name, its types, its zone-file lines. */
interface RecordSet {
  readonly name: string;
  readonly types: string[];
  readonly text: string;
}

/**
 * A zone's records grouped by name: a file per name, relative to the zone,
 * the apex as `@`, each holding its records as zone-file lines.
 *
 * @param records - The zone's records.
 * @param zone - The zone's name.
 * @returns The sets, sorted by name.
 */
export function recordSets_of(records: ReadonlyArray<CloudRecord>, zone: string): RecordSet[] {
  const byName: Map<string, CloudRecord[]> = new Map();
  for (const record of records) {
    const domain: string = record.domain.replace(/\.$/, '');
    const name: string = domain === zone ? '@' : domain.endsWith(`.${zone}`) ? domain.slice(0, -(zone.length + 1)) : domain;
    byName.set(name, [...(byName.get(name) ?? []), record]);
  }
  return [...byName.entries()]
    .sort(([a]: [string, CloudRecord[]], [b]: [string, CloudRecord[]]): number => a.localeCompare(b))
    .map(([name, set]: [string, CloudRecord[]]): RecordSet => ({
      name,
      types: [...new Set(set.map((record: CloudRecord): string => record.type))],
      text: set.map((record: CloudRecord): string => `${record.domain.replace(/\.$/, '')}. ${record.ttl} IN ${record.type} ${record.data}\n`).join(''),
    }));
}

/** A list as one value per line. */
function lines_of(values: ReadonlyArray<string>): string {
  return values.map((value: string): string => `${value}\n`).join('');
}

/** A bucket's links, one per line: what each opens, its name, what it allows, when it ends. */
function links_text(links: ReadonlyArray<CloudLink>): string {
  return links.map((link: CloudLink): string => `${link.object ?? '(bucket)'}\t${link.name}\t${link.access}\t${link.expires}\n`).join('');
}

/** The short title a resource row carries in a long listing. */
function resourceTitle_of(kind: ResourceKind, resource: CloudResource): string {
  if (kind === 'instances') return (resource as CloudInstance).shape;
  if (kind === 'volumes') return `${(resource as CloudVolume).sizeGib} GiB`;
  if (kind === 'loadbalancers') return (resource as CloudLoadBalancer).ips.join(' ');
  return '';
}
