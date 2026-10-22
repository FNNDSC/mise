/**
 * @file The installer driver: what turns machines into a cluster, the same on
 * every cloud (docs/stratus.adoc, D3). Red Hat's Assisted Installer is the
 * first; a hub's Hive or a Cluster API provider would be another.
 *
 * The build's steps call it for the cluster record, the discovery image,
 * the platform manifests, the hosts as they register, the install, and the
 * kubeconfig at the end. Every call is a request and an answer; a wait is
 * the step's own polling, so a step can be picked up again after a restart
 * from the ids it recorded.
 *
 * @module
 */

/** One machine as the installer sees it. */
export interface InstallerHost {
  /** Its name (the instance's). */
  name: string;
  /** The availability domain it runs in. */
  zone: string;
  /** Its role, once assigned. */
  role: 'master' | 'worker' | 'auto';
  /** When it registered, ISO 8601. */
  registered: string;
  /** Whether the installer's checks on it pass. */
  ready: boolean;
}

/** How far the install has come. */
export interface InstallStatus {
  state: 'pending' | 'installing' | 'installed' | 'error';
  percent: number;
  /** The installer's own words on where it is. */
  note: string;
}

/** A platform manifest the cloud asks the installer to apply (OCI: its cloud controller and CSI driver). */
export interface PlatformManifest {
  name: string;
  content: string;
}

/** The installer, as the build's steps call it. */
export interface Installer {
  /** Its id (`assisted`, `fake`). */
  readonly id: string;
  /** Makes the cluster record and its infra-env. */
  cluster_create(request: { name: string; baseDomain: string; version: string }): Promise<{ clusterId: string; infraEnvId: string }>;
  /** The discovery image's address and how long it holds. */
  isoUrl_get(infraEnvId: string): Promise<{ url: string; expires: string }>;
  /** Sends the platform's manifests. */
  manifests_upload(clusterId: string, manifests: ReadonlyArray<PlatformManifest>): Promise<void>;
  /** The hosts registered so far. */
  hosts_list(clusterId: string): Promise<InstallerHost[]>;
  /** Gives a host its role. */
  role_set(clusterId: string, host: string, role: 'master' | 'worker'): Promise<void>;
  /** Starts the install. */
  install_start(clusterId: string): Promise<void>;
  /** Where the install stands. */
  install_status(clusterId: string): Promise<InstallStatus>;
  /** The cluster's kubeconfig, once installed. */
  kubeconfig_get(clusterId: string): Promise<string>;
}
