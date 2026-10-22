/**
 * @file The fake cloud's build half and the fake installer, over one small
 * world they share: an apply boots the machines, which register with the
 * installer a moment later, and the install runs on a clock. Every wait is a
 * tick (none in tests), so `stratus --fake` shows a build moving.
 *
 * @module
 */
import type { DomainSpec } from '../../domain/spec.js';
import { specNodes_of, type SpecNode } from '../../domain/spec.js';
import type { Installer, InstallerCredentials, InstallerHost, InstallerIds, InstallStatus, PlatformManifest } from '../../installer/installer.js';
import type { BuildCall, CloudBuilder, InfraOutputs, InfraPlan, PlanRow, PreflightCheck, TeardownRequest } from '../builder.js';

/** The zones the fake region has, as the fake driver names them. */
const FAKE_ZONES: ReadonlyArray<string> = ['AD-1', 'AD-2', 'AD-3'];

/** What the fake world keeps of one cluster. */
interface FakeCluster {
  name: string;
  hosts: InstallerHost[];
  /** When each booted machine registers, epoch ms. */
  pending: Array<{ host: InstallerHost; at: number }>;
  installStarted?: number;
}

/**
 * The world the fake builder and installer share.
 *
 * @property tickMs - How long one tick of fake work takes.
 */
export class FakeBuildWorld {
  private readonly clusters: Map<string, FakeCluster> = new Map();
  private serial: number = 0;

  constructor(readonly tickMs: number = 0) {}

  /**
   * Waits one tick, or several, unless stopped.
   *
   * @param ticks - How many.
   * @param signal - Stops the wait early.
   */
  async tick(ticks: number = 1, signal?: AbortSignal): Promise<void> {
    if (this.tickMs <= 0 || signal?.aborted === true) return;
    await new Promise<void>((resolve: () => void): void => {
      const timer: ReturnType<typeof setTimeout> = setTimeout(resolve, this.tickMs * ticks);
      signal?.addEventListener('abort', (): void => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }

  /** A new id of a kind. */
  id_next(kind: string): string {
    this.serial++;
    return `fake-${kind}-${this.serial}`;
  }

  /** A cluster by name, made when first asked for. */
  cluster_of(name: string): FakeCluster {
    let cluster: FakeCluster | undefined = this.clusters.get(name);
    if (cluster === undefined) {
      cluster = { name, hosts: [], pending: [] };
      this.clusters.set(name, cluster);
    }
    return cluster;
  }

  /**
   * Boots a domain's machines: each registers with the installer a few ticks apart.
   *
   * @param domain - The domain.
   * @param nodes - Its machines.
   */
  machines_boot(domain: string, nodes: ReadonlyArray<SpecNode>): void {
    const cluster: FakeCluster = this.cluster_of(domain);
    const now: number = Date.now();
    cluster.pending = nodes.map((node: SpecNode, index: number): { host: InstallerHost; at: number } => ({
      host: { id: `host-${node.name}`, name: node.name, zone: FAKE_ZONES[node.zoneIndex] ?? 'AD-1', role: 'auto', registered: '', ready: true },
      at: now + this.tickMs * (2 + index),
    }));
  }

  /**
   * The hosts registered by now.
   *
   * @param domain - The domain.
   * @returns The hosts.
   */
  hosts_now(domain: string): InstallerHost[] {
    const cluster: FakeCluster = this.cluster_of(domain);
    const now: number = Date.now();
    for (const entry of cluster.pending.filter((p): boolean => p.at <= now)) {
      cluster.hosts.push({ ...entry.host, registered: new Date(entry.at).toISOString() });
    }
    cluster.pending = cluster.pending.filter((p): boolean => p.at > now);
    return cluster.hosts.map((host: InstallerHost): InstallerHost => ({ ...host }));
  }
}

/** The fake cloud's build half. */
export class FakeCloudBuilder implements CloudBuilder {
  readonly id: string = 'fake';

  constructor(private readonly world: FakeBuildWorld) {}

  async preflight(request: { domain: string; spec: DomainSpec; region: string; baseDomain: string; compartmentId: string }, call: BuildCall): Promise<PreflightCheck[]> {
    await this.world.tick(1, call.signal);
    const checks: PreflightCheck[] = [
      { name: 'credential', ok: true, note: 'the fake key answers' },
      { name: 'tag namespace', ok: true, note: 'mise-domain exists' },
      { name: 'load balancers', ok: true, note: '3 needed, 7 free' },
      { name: 'zone', ok: true, note: `${request.baseDomain} answers` },
    ];
    for (const check of checks) call.log(`${check.ok ? 'ok' : 'NO'}  ${check.name}: ${check.note}`);
    return checks;
  }

  async iso_store(request: { domain: string; url: string; region: string; compartmentId: string }, call: BuildCall): Promise<{ object: string; expires: string; link: string; linkId: string }> {
    await this.world.tick(2, call.signal);
    const object: string = `${request.domain}-discovery.iso`;
    call.log(`stored ${object} in stratus-iso, linked for 7 days`);
    return { object, expires: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(), link: `https://objectstorage.example/p/fake/${object}`, linkId: this.world.id_next('link') };
  }

  async infra_plan(request: { domain: string; spec: DomainSpec; region: string; isoObject: string; stackRef?: string; compartmentId?: string; baseDomain?: string; isoLink?: string }, call: BuildCall): Promise<InfraPlan> {
    await this.world.tick(3, call.signal);
    if (request.stackRef !== undefined) {
      // A built stack re-planned: nothing to make, OCI's own tags to strip.
      const drift: PlanRow[] = specNodes_of(request.domain, request.spec, FAKE_ZONES.length).map((node: SpecNode): PlanRow => ({ action: 'change', kind: 'instances', name: node.name, drift: true }));
      call.log(`plan job done: 0 to create, ${drift.length} to change, 0 to destroy`);
      return { ref: this.world.id_next('plan'), rows: drift };
    }
    const nodes: SpecNode[] = specNodes_of(request.domain, request.spec, FAKE_ZONES.length);
    const create = (kind: string, name: string): PlanRow => ({ action: 'create', kind, name });
    const rows: PlanRow[] = [
      ...nodes.map((node: SpecNode): PlanRow => create('instances', node.name)),
      ...nodes.map((node: SpecNode): PlanRow => create('volumes', `${node.name}-boot`)),
      create('loadbalancers', `${request.domain}-api`), create('loadbalancers', `${request.domain}-api-int`), create('loadbalancers', `${request.domain}-apps`),
      create('networks', `${request.domain}-vcn`),
      create('subnets', 'private'), create('subnets', 'private-ocp'), create('subnets', 'public'),
      create('securitygroups', 'cluster-lb'), create('securitygroups', 'cluster-controlplane'), create('securitygroups', 'cluster-compute'),
      create('image', `${request.domain}-discovery`),
    ];
    call.log(`plan job done: ${rows.length} to create, 0 to change, 0 to destroy`);
    return { ref: this.world.id_next('plan'), rows, stackRef: this.world.id_next('stack') };
  }

  async infra_apply(request: { domain: string; plan: InfraPlan; region: string; stackRef?: string }, call: BuildCall): Promise<InfraOutputs> {
    for (let i: number = 0; i < 4 && call.signal.aborted !== true; i++) {
      await this.world.tick(1, call.signal);
      call.log(`apply job: ${Math.round(((i + 1) / 4) * request.plan.rows.length)} of ${request.plan.rows.length} created`);
    }
    const nodes: SpecNode[] = request.plan.rows
      .filter((row: PlanRow): boolean => row.kind === 'instances')
      .map((row: PlanRow, index: number): SpecNode => ({ name: row.name, role: row.name.includes('-cp-') ? 'plane' : 'worker', vcpu: 0, ramGib: 0, zoneIndex: index % FAKE_ZONES.length }));
    this.world.machines_boot(request.domain, nodes);
    return {
      apiIp: '10.0.0.10', apiIntIp: '10.0.0.11', appsIp: '10.0.0.12', stackRef: request.stackRef ?? request.plan.stackRef ?? this.world.id_next('stack'),
      manifests: [{ name: 'oci-dynamic-custom-manifest.yml', content: '# the fake cloud controller and CSI driver\n' }],
    };
  }

  async dns_upsert(request: { domain: string; baseDomain: string; outputs: InfraOutputs; compartmentId: string; region: string }, call: BuildCall): Promise<string[]> {
    await this.world.tick(1, call.signal);
    const names: string[] = [`api.${request.domain}.${request.baseDomain}`, `api-int.${request.domain}.${request.baseDomain}`, `*.apps.${request.domain}.${request.baseDomain}`];
    call.log(`upserted ${names.join(', ')}`);
    return names;
  }

  async stackResources_count(_request: { region: string; stackRef: string }): Promise<number> {
    return 17;
  }

  async teardown_run(request: TeardownRequest, call: BuildCall): Promise<string[]> {
    await this.world.tick(4, call.signal);
    const gone: string[] = [];
    if (request.stackRef !== undefined) gone.push(`the stack's resources (${request.stackRef})`);
    gone.push('3 DNS records');
    if (request.isoObject !== undefined) gone.push(`the image ${request.isoObject} and its link`);
    if (request.volumeIds.length > 0) gone.push(`${request.volumeIds.length} volumes the cluster made`);
    for (const line of gone) call.log(`removed ${line}`);
    return gone;
  }

  async stack_adopt(request: { domain: string; region: string; compartmentId: string; variables: Record<string, string>; state: Buffer; stackVersion: string }, call: BuildCall): Promise<string> {
    await this.world.tick(2, call.signal);
    call.log(`stack made for ${request.domain} with ${Object.keys(request.variables).length} variables; ${request.state.length} bytes of state imported`);
    return this.world.id_next('stack');
  }
}

/** The fake installer. */
export class FakeInstaller implements Installer {
  readonly id: string = 'fake';
  private readonly roles: Map<string, 'master' | 'worker'> = new Map();
  readonly deleted: string[] = [];

  constructor(private readonly world: FakeBuildWorld, private readonly installTicks: number = 6) {}

  async cluster_create(request: { name: string; baseDomain: string; version: string; controlPlaneCount: number }): Promise<InstallerIds> {
    await this.world.tick(1);
    this.world.cluster_of(request.name);
    return { clusterId: `cluster-${request.name}`, infraEnvId: `infraenv-${request.name}` };
  }

  async isoUrl_get(ids: InstallerIds): Promise<{ url: string; expires: string }> {
    return { url: `https://installer.example/${ids.infraEnvId}/discovery.iso`, expires: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString() };
  }

  async manifests_upload(_ids: InstallerIds, _manifests: ReadonlyArray<PlatformManifest>): Promise<void> {
    await this.world.tick(1);
  }

  async hosts_list(ids: InstallerIds): Promise<InstallerHost[]> {
    return this.world.hosts_now(ids.clusterId.replace(/^cluster-/, '')).map((host: InstallerHost): InstallerHost => ({ ...host, role: this.roles.get(host.name) ?? host.role }));
  }

  async role_set(_ids: InstallerIds, host: InstallerHost, role: 'master' | 'worker'): Promise<void> {
    this.roles.set(host.name, role);
  }

  async install_start(ids: InstallerIds): Promise<void> {
    this.world.cluster_of(ids.clusterId.replace(/^cluster-/, '')).installStarted = Date.now();
  }

  async install_status(ids: InstallerIds): Promise<InstallStatus> {
    const started: number | undefined = this.world.cluster_of(ids.clusterId.replace(/^cluster-/, '')).installStarted;
    if (started === undefined) return { state: 'ready', percent: 0, note: 'ready to install' };
    const span: number = Math.max(this.world.tickMs * this.installTicks, 1);
    const percent: number = this.world.tickMs <= 0 ? 100 : Math.min(100, Math.round(((Date.now() - started) / span) * 100));
    return percent >= 100 ? { state: 'installed', percent: 100, note: 'installed' } : { state: 'installing', percent, note: percent < 50 ? 'writing the image to disk' : 'waiting for the control plane' };
  }

  async kubeconfig_get(ids: InstallerIds): Promise<string> {
    return `# the fake cluster ${ids.clusterId}'s kubeconfig\napiVersion: v1\nkind: Config\n`;
  }

  async credentials_get(ids: InstallerIds): Promise<InstallerCredentials> {
    return { username: 'kubeadmin', password: 'fake-password', consoleUrl: `https://console.apps.${ids.clusterId}.fake.example` };
  }

  async cluster_delete(ids: InstallerIds): Promise<void> {
    this.deleted.push(ids.clusterId);
  }
}
