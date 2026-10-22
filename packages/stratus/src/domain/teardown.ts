/**
 * @file A domain's teardown, its first form (docs/stratus.adoc, D6, decided
 * 2026-10-22): what this daemon built, removed, and nothing else.
 *
 * The stack's own resources go by a destroy job; then the cluster's DNS
 * records, the discovery image and its link, the volumes the cluster's CSI
 * driver made for its claims (which the stack never knew), and the
 * installer's records. The CSI volumes are named by the cluster itself, read
 * from its PersistentVolumes before the destroy: OCI's attribution tag on them
 * is the same for every cluster, so it cannot say whose they are.
 *
 * @module
 */
import type { JobContext, JobRun } from '@fnndsc/brasa/core';
import type { KubeApi } from '../cluster/kube.js';
import type { CloudBuilder } from '../cloud/builder.js';
import type { Installer } from '../installer/installer.js';
import type { DomainRecord, DomainStore } from './state.js';

/** The CSI driver whose volumes are the cloud's block volumes. */
export const OCI_BLOCK_DRIVER: string = 'blockvolume.csi.oraclecloud.com';

/**
 * The block volumes a cluster's claims hold, from its PersistentVolumes.
 *
 * @param kube - The cluster.
 * @returns The volumes' ids.
 */
export async function clusterVolumes_read(kube: KubeApi): Promise<string[]> {
  const answer = await kube.json_get('/api/v1/persistentvolumes') as { items?: Array<{ spec?: { csi?: { driver?: string; volumeHandle?: string } } }> };
  return (answer.items ?? [])
    .filter((volume): boolean => volume.spec?.csi?.driver === OCI_BLOCK_DRIVER && typeof volume.spec.csi.volumeHandle === 'string')
    .map((volume): string => volume.spec?.csi?.volumeHandle as string);
}

/**
 * The job that tears a domain down.
 *
 * @param store - The domains.
 * @param builder - The cloud's build half.
 * @param installer - The installer, or null when none is reachable.
 * @param name - The domain.
 * @param volumeIds - The cluster's own volumes, read before.
 * @returns The job's work.
 */
export function teardownRun_make(store: DomainStore, builder: CloudBuilder, installer: Installer | null, name: string, volumeIds: ReadonlyArray<string>): JobRun {
  return async (context: JobContext): Promise<void> => {
    const record: DomainRecord | null = store.record_read(name);
    if (record === null) throw new Error(`${name}: no such domain`);
    if (builder.teardown_run === undefined) throw new Error(`${builder.id}: this cloud cannot tear a domain down`);
    const gone: string[] = await builder.teardown_run({
      domain: name, region: record.region, compartmentId: record.compartmentId ?? '', baseDomain: record.baseDomain, volumeIds,
      ...(record.ids['stackRef'] !== undefined ? { stackRef: record.ids['stackRef'] } : {}),
      ...(record.ids['isoObject'] !== undefined ? { isoObject: record.ids['isoObject'] } : {}),
      ...(record.ids['isoLinkId'] !== undefined ? { isoLinkId: record.ids['isoLinkId'] } : {}),
    }, { log: (line: string): void => context.log_write(line), signal: context.signal });
    if (context.signal.aborted) return;
    if (installer !== null && record.ids['clusterId'] !== undefined && record.ids['infraEnvId'] !== undefined) {
      await installer.cluster_delete({ clusterId: record.ids['clusterId'], infraEnvId: record.ids['infraEnvId'] });
      gone.push('the installer\'s cluster and infra-env');
    }
    store.record_update(name, (current: DomainRecord): void => { current.gone = new Date().toISOString(); });
    context.log_write(`gone: ${gone.join('; ')}`);
  };
}
