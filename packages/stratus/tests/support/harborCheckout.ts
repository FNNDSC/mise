/**
 * @file A `harbor-oci` checkout in a temporary folder, as a build leaves it:
 * a spec, settings (a credential among them), the state document with its
 * secret link, a staged stack with Terraform state, and credentials.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** What the checkout holds; a field set to false leaves that part out. */
export interface CheckoutParts {
  readonly spec?: boolean;
  readonly state?: boolean;
  readonly stack?: 'applied' | 'planned' | false;
  readonly kubeconfig?: boolean;
  readonly parExpiresAt?: string;
}

/**
 * Writes a checkout.
 *
 * @param parts - What it holds; everything by default.
 * @returns The checkout's root.
 */
export function harborCheckout_make(parts: CheckoutParts = {}): string {
  const root: string = mkdtempSync(join(tmpdir(), 'harbor-oci-'));
  const stackDir: string = join(root, 'state', 'stack', 'oci-openshift-1.6.1', 'terraform-stacks', 'create-cluster');
  if (parts.spec !== false) writeFileSync(join(root, 'spec.yaml'), 'family: E5\ncontrolPlane:\n  count: 3\n  vcpu: 8\n  ramGib: 24\n');
  writeFileSync(join(root, 'config.env'), '# defaults\nCLUSTER_NAME=harbor\nBASE_DOMAIN=oci.example.org\nOCI_REGION=us-ashburn-1\nRH_AUTH=service-account\n');
  writeFileSync(join(root, 'config.local.env'), 'export OCI_COMPARTMENT_OCID="ocid1.compartment.oc1..harbor"\nRH_CLIENT_SECRET=\'s3cret\'\nBASE_DOMAIN=oci.chrisproject.org\n\nnot a setting\n');
  if (parts.state !== false) {
    mkdirSync(join(root, 'state'), { recursive: true });
    writeFileSync(join(root, 'state', 'harbor.json'), JSON.stringify({
      assistedClusterId: 'cluster-1', assistedInfraEnvId: 'infra-1', isoObjectName: 'harbor-discovery.iso', parId: 'par-1',
      parUrl: 'https://objectstorage.example/p/SECRET/n/ns/b/iso/o/harbor-discovery.iso', parExpiresAt: parts.parExpiresAt ?? '2099-01-01T00:00:00Z',
      ...(parts.stack !== false ? { stackDir } : {}),
    }));
  }
  if (parts.stack !== false) {
    mkdirSync(stackDir, { recursive: true });
    writeFileSync(join(stackDir, 'harbor.auto.tfvars.json'), '{}');
    if (parts.stack !== 'planned') writeFileSync(join(stackDir, 'terraform.tfstate'), JSON.stringify({ resources: [{ type: 'oci_core_instance', instances: [{ attributes: { secret: 'never shown' } }] }, { type: 'oci_core_vcn' }] }));
  }
  if (parts.kubeconfig !== false) {
    mkdirSync(join(root, 'state', 'auth'), { recursive: true });
    writeFileSync(join(root, 'state', 'auth', 'kubeconfig'), 'apiVersion: v1\n# a credential\n');
    writeFileSync(join(root, 'state', 'auth', 'kubeadmin-password'), 'hunter2\n');
  }
  return root;
}
