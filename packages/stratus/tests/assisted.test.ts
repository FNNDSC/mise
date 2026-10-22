/**
 * @file The Assisted Installer over a recorded Red Hat: the token without a
 * scope, the cluster and infra-env as harbor-oci made them, manifests
 * replaced, hosts read, roles, the install's states, credentials, deletion.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { AssistedInstaller, ASSISTED_API, InstallerError, OCM_API, RED_HAT_SSO_URL, serviceAccount_read, type InstallerFetch } from '../src/installer/assisted.js';

/** One call made. */
interface Call { method: string; url: string; body?: string; auth?: string }

/** A Red Hat that answers from a table, keyed `METHOD url`. */
function redHat_make(answers: Record<string, { status: number; body: unknown } | Array<{ status: number; body: unknown }>>, calls: Call[]): InstallerFetch {
  return async (url, init) => {
    const key: string = `${init?.method ?? 'GET'} ${url}`;
    calls.push({ method: init?.method ?? 'GET', url, ...(init?.body !== undefined ? { body: init.body } : {}), ...(init?.headers?.['authorization'] !== undefined ? { auth: init.headers['authorization'] } : {}) });
    const entry = answers[key];
    const answer = Array.isArray(entry) ? entry.shift() : entry;
    if (answer === undefined) return { status: 404, text: async () => JSON.stringify({ reason: `no answer for ${key}` }) };
    return { status: answer.status, text: async () => (typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body)) };
  };
}

const IDS = { clusterId: 'c-1', infraEnvId: 'ie-1' };

describe('the Assisted Installer', () => {
  let calls: Call[];
  let answers: Record<string, { status: number; body: unknown } | Array<{ status: number; body: unknown }>>;
  let installer: AssistedInstaller;

  beforeEach(() => {
    calls = [];
    answers = {
      [`POST ${RED_HAT_SSO_URL}`]: { status: 200, body: { access_token: 'tok', expires_in: 900 } },
      [`GET ${ASSISTED_API}/clusters`]: { status: 200, body: [{ id: 'other', name: 'lab', base_dns_domain: 'x.org' }] },
      [`POST ${OCM_API}/api/accounts_mgmt/v1/access_token`]: { status: 200, body: { auths: { 'quay.io': { auth: 'a' } } } },
      [`POST ${ASSISTED_API}/clusters`]: { status: 201, body: { id: 'c-1' } },
      [`POST ${ASSISTED_API}/infra-envs`]: { status: 201, body: { id: 'ie-1' } },
    };
    installer = new AssistedInstaller({ account: () => ({ clientId: 'id', clientSecret: 'secret' }), sshPublicKey: () => 'ssh-ed25519 AAAA key\n', fetch: redHat_make(answers, calls) });
  });

  it('reads a service account file, and refuses one that lacks a part', () => {
    expect(serviceAccount_read('# Red Hat\nexport RH_CLIENT_ID="abc"\nRH_CLIENT_SECRET=\'s3\'\n')).toEqual({ clientId: 'abc', clientSecret: 's3' });
    expect(() => serviceAccount_read('RH_CLIENT_ID=abc\n')).toThrow('lacks RH_CLIENT_ID or RH_CLIENT_SECRET');
  });

  it('makes the cluster and its infra-env as harbor-oci did, with a token asked for without a scope', async () => {
    expect(await installer.cluster_create({ name: 'trial', baseDomain: 'oci.example.org', version: '4.22', controlPlaneCount: 3 })).toEqual(IDS);
    const token: Call = calls[0] as Call;
    expect(token.body).toBe('grant_type=client_credentials&client_id=id&client_secret=secret');
    expect(token.body).not.toContain('scope');
    const cluster = JSON.parse(calls.find((call) => call.method === 'POST' && call.url === `${ASSISTED_API}/clusters`)?.body ?? '{}');
    expect(cluster).toMatchObject({
      name: 'trial', base_dns_domain: 'oci.example.org', openshift_version: '4.22', cpu_architecture: 'x86_64', high_availability_mode: 'Full', control_plane_count: 3,
      user_managed_networking: true, platform: { type: 'external', external: { platform_name: 'oci', cloud_controller_manager: 'External' } }, ssh_public_key: 'ssh-ed25519 AAAA key',
    });
    expect(JSON.parse(cluster.pull_secret)).toEqual({ auths: { 'quay.io': { auth: 'a' } } });
    const infraEnv = JSON.parse(calls.find((call) => call.url === `${ASSISTED_API}/infra-envs`)?.body ?? '{}');
    expect(infraEnv).toMatchObject({ name: 'trial-infra-env', cluster_id: 'c-1', image_type: 'minimal-iso', ssh_authorized_key: 'ssh-ed25519 AAAA key' });
    expect(calls.filter((call) => call.url === RED_HAT_SSO_URL)).toHaveLength(1);
    expect(calls.every((call) => call.url === RED_HAT_SSO_URL || call.auth === 'Bearer tok')).toBe(true);
  });

  it('refuses a cluster of that name it did not record, and an account with no pull secret', async () => {
    answers[`GET ${ASSISTED_API}/clusters`] = { status: 200, body: [{ id: 'x', name: 'trial', base_dns_domain: 'oci.example.org' }] };
    await expect(installer.cluster_create({ name: 'trial', baseDomain: 'oci.example.org', version: '4.22', controlPlaneCount: 3 })).rejects.toThrow('already exists at Red Hat');
    answers[`GET ${ASSISTED_API}/clusters`] = { status: 200, body: [] };
    answers[`POST ${OCM_API}/api/accounts_mgmt/v1/access_token`] = { status: 200, body: { auths: {} } };
    await expect(installer.cluster_create({ name: 'trial', baseDomain: 'oci.example.org', version: '4.22', controlPlaneCount: 3 })).rejects.toThrow('no pull secret');
  });

  it('reads the image, replaces a manifest, lists hosts and gives them roles', async () => {
    answers[`GET ${ASSISTED_API}/infra-envs/ie-1/downloads/image-url`] = { status: 200, body: { url: 'https://img/iso', expires_at: '2026-10-29T00:00:00Z' } };
    expect(await installer.isoUrl_get(IDS)).toEqual({ url: 'https://img/iso', expires: '2026-10-29T00:00:00Z' });
    answers[`GET ${ASSISTED_API}/clusters/c-1/manifests`] = { status: 200, body: [{ folder: 'manifests', file_name: 'm.yml' }] };
    answers[`DELETE ${ASSISTED_API}/clusters/c-1/manifests?folder=manifests&file_name=m.yml`] = { status: 204, body: '' };
    answers[`POST ${ASSISTED_API}/clusters/c-1/manifests`] = { status: 201, body: {} };
    await installer.manifests_upload(IDS, [{ name: 'm.yml', content: 'kind: X\n' }]);
    expect(JSON.parse(calls.at(-1)?.body ?? '{}')).toEqual({ folder: 'manifests', file_name: 'm.yml', content: Buffer.from('kind: X\n').toString('base64') });
    answers[`GET ${ASSISTED_API}/infra-envs/ie-1/hosts`] = { status: 200, body: [
      { id: 'h2', requested_hostname: 'trial-cp-1.local', status: 'insufficient', role: 'auto-assign', created_at: 't2' },
      { id: 'h1', requested_hostname: 'trial-cp-0', status: 'known', role: 'master', created_at: 't1' },
    ] };
    const hosts = await installer.hosts_list(IDS);
    expect(hosts).toEqual([
      { id: 'h1', name: 'trial-cp-0', zone: '', role: 'master', registered: 't1', ready: true },
      { id: 'h2', name: 'trial-cp-1', zone: '', role: 'auto', registered: 't2', ready: false },
    ]);
    answers[`PATCH ${ASSISTED_API}/infra-envs/ie-1/hosts/h2`] = { status: 200, body: {} };
    await installer.role_set(IDS, hosts[1]!, 'master');
    expect(JSON.parse(calls.at(-1)?.body ?? '{}')).toEqual({ host_role: 'master' });
  });

  it('starts the install and reads its states, then the credentials; deleting what is gone is no error', async () => {
    answers[`POST ${ASSISTED_API}/clusters/c-1/actions/install`] = { status: 202, body: '' };
    await installer.install_start(IDS);
    answers[`GET ${ASSISTED_API}/clusters/c-1`] = [
      { status: 200, body: { status: 'ready', status_info: 'Cluster ready to be installed' } },
      { status: 200, body: { status: 'installing', status_info: 'Installation in progress', progress: { total_percentage: 42 } } },
      { status: 200, body: { status: 'insufficient', status_info: 'hosts missing' } },
      { status: 200, body: { status: 'error', status_info: 'bootkube failed' } },
      { status: 200, body: { status: 'installed', status_info: 'Cluster is installed' } },
    ];
    expect(await installer.install_status(IDS)).toEqual({ state: 'ready', percent: 0, note: 'Cluster ready to be installed' });
    expect(await installer.install_status(IDS)).toEqual({ state: 'installing', percent: 42, note: 'Installation in progress' });
    expect((await installer.install_status(IDS)).state).toBe('pending');
    expect(await installer.install_status(IDS)).toMatchObject({ state: 'error', note: 'error: bootkube failed' });
    expect(await installer.install_status(IDS)).toMatchObject({ state: 'installed', percent: 100 });
    answers[`GET ${ASSISTED_API}/clusters/c-1/downloads/credentials?file_name=kubeconfig`] = { status: 200, body: 'apiVersion: v1\n' };
    expect(await installer.kubeconfig_get(IDS)).toBe('apiVersion: v1\n');
    answers[`GET ${ASSISTED_API}/clusters/c-1/credentials`] = { status: 200, body: { username: 'kubeadmin', password: 'pw', console_url: 'https://console' } };
    expect(await installer.credentials_get(IDS)).toEqual({ username: 'kubeadmin', password: 'pw', consoleUrl: 'https://console' });
    await installer.cluster_delete(IDS);
    expect(calls.slice(-2).map((call) => `${call.method} ${call.url.replace(ASSISTED_API, '')}`)).toEqual(['DELETE /infra-envs/ie-1', 'DELETE /clusters/c-1']);
  });

  it('says what Red Hat refused, and fails a token it cannot get', async () => {
    const failing: InstallerError = await installer.install_start(IDS).catch((error: InstallerError) => error) as InstallerError;
    expect(failing).toBeInstanceOf(InstallerError);
    expect(failing.message).toBe('POST /clusters/c-1/actions/install: HTTP 404: no answer for POST https://api.openshift.com/api/assisted-install/v2/clusters/c-1/actions/install');
    answers[`POST ${RED_HAT_SSO_URL}`] = { status: 401, body: { error: 'unauthorized_client' } };
    const fresh: AssistedInstaller = new AssistedInstaller({ account: () => ({ clientId: 'id', clientSecret: 'bad' }), sshPublicKey: () => 'k', fetch: redHat_make(answers, calls) });
    await expect(fresh.isoUrl_get(IDS)).rejects.toThrow('Red Hat token: HTTP 401');
  });
});
