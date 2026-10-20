/**
 * @file The cloud driver: what stratus asks of a cloud, and nothing a cloud
 * asks of stratus.
 *
 * One substrate backend, clouds as drivers (docs/stratus.adoc, D1). The tree,
 * the verbs and the composition are written once against this interface; a
 * cloud implements it (`oci/`), and the fake implements it for tests and the
 * boot proof. Every driver passes the same contract suite
 * (`tests/support/driverContract.ts`).
 *
 * Names are the cloud's own words where the cloud has them (a shape, a
 * limit's service) and neutral where every cloud has the thing (a container,
 * a zone, a region).
 *
 * @module
 */

/** Who the session is, as the cloud knows it. */
export interface CloudIdentity {
  /** The user's name, as the cloud shows it (an IAM user's name). */
  readonly user: string;
  /** The root container's display name: the tenancy, the account, the organization. */
  readonly tenancy: string;
  /** The root container's id. */
  readonly tenancyId: string;
  /** The region the credential names as home. */
  readonly homeRegion: string;
}

/** A container of resources: a compartment, an account, a project, a resource group. */
export interface CloudContainer {
  /** Its display name; the path segment. */
  readonly name: string;
  /** Its id (an OCID). */
  readonly id: string;
  /** The container holding it, or null for the root. */
  readonly parentId: string | null;
  /** Its lifecycle state, lower case (`active`, `deleting`). */
  readonly state: string;
  /** When it was made, ISO 8601. */
  readonly created: string;
  /** What the cloud says it is for. */
  readonly description: string;
  /** Its tags, flattened: freeform as `key`, defined as `namespace.key`. */
  readonly tags: Readonly<Record<string, string>>;
  /** What the cloud calls this kind of container: `compartment`, `project`, `account`. */
  readonly noun: string;
  /** The whole record, for `info.json`. */
  readonly raw: unknown;
}

/** A zone inside a region: an availability domain, an availability zone. */
export interface CloudZone {
  /** Its name, as the cloud's API wants it back (`Uocm:US-ASHBURN-AD-1`). */
  readonly name: string;
}

/** One service limit, at the scope the cloud keeps it. */
export interface CloudLimit {
  /** The service it belongs to (`compute`). */
  readonly service: string;
  /** The limit's name (`standard-e5-core-count`). */
  readonly name: string;
  /** Where it applies. */
  readonly scope: 'global' | 'region' | 'zone';
  /** The zone, when the scope is a zone. */
  readonly zone?: string;
  /** The permitted amount. */
  readonly value: number;
}

/** How much of a limit is spent and left. */
export interface CloudAvailability {
  readonly used: number;
  readonly available: number;
}

/** A machine shape the region offers. */
export interface CloudShape {
  /** The cloud's name for it (`VM.Standard.E5.Flex`). */
  readonly name: string;
  /** A neutral family name (`E5`). */
  readonly family: string;
  /** Whether cores and memory are chosen per instance. */
  readonly flexible: boolean;
  /** vCPU per core unit the cloud bills (OCI: per OCPU). */
  readonly vcpuPerCore: number;
  /** Cores a fixed shape has, or the range a flexible one allows. */
  readonly cores: { readonly min: number; readonly max: number };
  /** Memory in GiB a fixed shape has, or the range a flexible one allows. */
  readonly memoryGib: { readonly min: number; readonly max: number };
  /** The processor, in the cloud's words. */
  readonly processor: string;
  /** GPUs, when the shape has them. */
  readonly gpus: number;
  /** The limit names the shape draws on. */
  readonly quotaNames: ReadonlyArray<string>;
  /** The whole record, for `info.json`. */
  readonly raw: unknown;
}

/** What a shape's family costs, per hour, at list price. */
export interface CloudPrice {
  /** The shape it prices. */
  readonly shape: string;
  /** Per vCPU-hour. */
  readonly vcpuHour: number;
  /** Per GiB-hour of memory. */
  readonly gibHour: number;
  /** The currency code. */
  readonly currency: string;
}

/**
 * A cloud, as stratus sees it. Every method answers for the region it is
 * given: the region is the session's, not the driver's (docs/stratus.adoc,
 * D4), so a driver holds no current region.
 */
export interface CloudDriver {
  /** The cloud's short name; the mount under `/net` (`oci`). */
  readonly cloud: string;
  /** Who the credential is, and its home region. Throws when the credential does not work. */
  identity_get(): Promise<CloudIdentity>;
  /** The root container. */
  root_get(): Promise<CloudContainer>;
  /** The containers directly inside one. */
  containers_list(parentId: string): Promise<CloudContainer[]>;
  /** The regions the tenancy is subscribed to. */
  regions_list(): Promise<string[]>;
  /** The zones of a region. */
  zones_list(region: string): Promise<CloudZone[]>;
  /** The services that have limits. */
  limitServices_list(region: string): Promise<string[]>;
  /** One service's limits in a region, at every scope. */
  limits_list(region: string, service: string): Promise<CloudLimit[]>;
  /** How much of one limit is spent and left; null when the cloud does not say. */
  limitAvailability_get(region: string, service: string, name: string, zone?: string): Promise<CloudAvailability | null>;
  /** The shapes a region offers. */
  shapes_list(region: string): Promise<CloudShape[]>;
  /** List prices for the shapes, per hour. */
  prices_list(): Promise<CloudPrice[]>;
}
