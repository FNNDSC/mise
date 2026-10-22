/**
 * @file OCI's build half: Terraform in Resource Manager (docs/stratus.adoc, D3).
 *
 * The stack is Oracle's own `oci-openshift` `create-cluster` release zip,
 * pinned by its digest, uploaded as a Resource Manager stack. A plan is a plan
 * job read back as JSON; adopting a domain `harbor-oci` built is a stack with
 * that domain's variables and an import-state job carrying its Terraform
 * state. Every wait polls the job and streams its log to the step's; a stop
 * asks Resource Manager to cancel the job without forcing it, and waits for
 * Terraform to finish its current operation.
 *
 * What a new domain's build needs beyond that (preflight, the ISO's bucket,
 * the apply, DNS) comes with the first real build (step 4d); until then
 * those calls refuse by name.
 *
 * @module
 */
import { createHash } from 'node:crypto';
import type { DomainSpec } from '../../domain/spec.js';
import type { PlatformManifest } from '../../installer/installer.js';
import type { BuildCall, CloudBuilder, InfraOutputs, InfraPlan, PreflightCheck } from '../builder.js';
import { planRows_read } from './planRead.js';
import type { RmApi, RmJobRecord, RmOperation } from './rmApi.js';

/** The stack release stratus builds with: Oracle's zip of `create-cluster`, pinned. */
export const STACK_RELEASE = {
  version: 'v1.6.1',
  url: 'https://github.com/oracle-quickstart/oci-openshift/releases/download/v1.6.1/create-cluster-v1.6.1.zip',
  sha256: 'a4c8a52dcc4ffc030e90b94e90553cc9294fbb87ed66fb6ac6fae2c573b14c8b',
} as const;

/** The freeform tag a domain's stack carries, so a fresh bastion finds it (D4). */
export const DOMAIN_TAG: string = 'mise-domain';

/** The job states that will not change again. */
const JOB_OVER: ReadonlyArray<string> = ['SUCCEEDED', 'FAILED', 'CANCELED'];

/** How the OCI builder is made. */
export interface OciBuilderOptions {
  /** Resource Manager in a region. */
  readonly rm: (region: string) => RmApi;
  /** The stack's zip, as fetched; `fetch` of {@link STACK_RELEASE} when absent. */
  readonly zip_fetch?: () => Promise<Buffer>;
  /** How often a job is asked again, in milliseconds. */
  readonly pollMs?: number;
}

/**
 * Fetches the pinned stack zip and checks its digest.
 *
 * @returns The zip.
 * @throws Error - When the download fails or the digest is not the pinned one.
 */
export async function stackZip_fetch(): Promise<Buffer> {
  const response: Response = await fetch(STACK_RELEASE.url);
  if (!response.ok) throw new Error(`stack ${STACK_RELEASE.version}: HTTP ${response.status} from ${STACK_RELEASE.url}`);
  const zip: Buffer = Buffer.from(await response.arrayBuffer());
  return stackZip_check(zip);
}

/**
 * Checks a zip against the pinned digest.
 *
 * @param zip - The zip.
 * @returns It, when it is the pinned one.
 * @throws Error - When it is not.
 */
export function stackZip_check(zip: Buffer): Buffer {
  const digest: string = createHash('sha256').update(zip).digest('hex');
  if (digest !== STACK_RELEASE.sha256) throw new Error(`stack ${STACK_RELEASE.version}: sha256 ${digest} is not the pinned ${STACK_RELEASE.sha256}`);
  return zip;
}

/**
 * Waits a poll, unless stopped.
 *
 * @param ms - How long.
 * @param signal - Stops it.
 */
function poll_wait(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve: () => void): void => {
    const timer: ReturnType<typeof setTimeout> = setTimeout(resolve, ms);
    signal.addEventListener('abort', (): void => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

/** OCI's build half, over Resource Manager. */
export class OciBuilder implements CloudBuilder {
  readonly id: string = 'oci';
  private zip: Buffer | null = null;

  constructor(private readonly options: OciBuilderOptions) {}

  /** The stack's zip, fetched once. */
  private async zip_get(): Promise<Buffer> {
    if (this.zip === null) this.zip = await (this.options.zip_fetch ?? stackZip_fetch)();
    return this.zip;
  }

  /**
   * Runs a job to its end: its log streamed to the step's, a stop passed on
   * as a cancel that is never forced.
   *
   * @param rm - Resource Manager.
   * @param stackId - The stack.
   * @param operation - What the job does.
   * @param name - What the job is called.
   * @param call - The step's log and stop.
   * @returns The job at its end.
   * @throws Error - When it failed or was cancelled.
   */
  async job_run(rm: RmApi, stackId: string, operation: RmOperation, name: string, call: BuildCall): Promise<RmJobRecord> {
    let job: RmJobRecord = await rm.job_create(stackId, operation, name);
    call.log(`Resource Manager ${operation.kind} job ${job.id}`);
    let shown: number = 0;
    let cancelAsked: boolean = false;
    for (;;) {
      if (call.signal.aborted && !cancelAsked) {
        cancelAsked = true;
        call.log(`asking Resource Manager to cancel ${job.id}; Terraform finishes its current operation first`);
        await rm.job_cancel(job.id);
      }
      job = await rm.job_get(job.id);
      shown = await this.log_follow(rm, job.id, shown, call);
      if (JOB_OVER.includes(job.state)) break;
      await poll_wait(this.options.pollMs ?? 10_000, call.signal);
    }
    if (job.state !== 'SUCCEEDED') throw new Error(`Resource Manager ${operation.kind} job ${job.id}: ${job.state}${job.failure !== undefined ? `: ${job.failure}` : ''}`);
    return job;
  }

  /**
   * Passes on the lines of a job's log not yet shown. A log read while the
   * job writes it can fail (Resource Manager pages a log that grows); the
   * log is only ever shown, so a failed read is skipped and read again on
   * the next poll, never the job's failure.
   *
   * @param rm - Resource Manager.
   * @param jobId - The job.
   * @param shown - How many lines were passed on already.
   * @param call - The step's log.
   * @returns How many lines have been passed on now.
   */
  private async log_follow(rm: RmApi, jobId: string, shown: number, call: BuildCall): Promise<number> {
    let lines: string[];
    try {
      lines = await rm.jobLog_read(jobId);
    } catch {
      return shown;
    }
    for (const line of lines.slice(shown)) call.log(line);
    return Math.max(shown, lines.length);
  }

  /**
   * Adopts a domain `harbor-oci` built: a stack of the pinned release with its
   * variables, tagged with the domain's name, and its Terraform state imported.
   *
   * @param request - The domain, where the stack goes, its variables and its state.
   * @param call - The step's log and stop.
   * @returns The stack's id.
   */
  async stack_adopt(request: { domain: string; region: string; compartmentId: string; variables: Record<string, string>; state: Buffer; stackVersion: string }, call: BuildCall): Promise<string> {
    // The state was written by that release's Terraform; another release would plan changes that are not there.
    if (request.stackVersion !== STACK_RELEASE.version) throw new Error(`the domain was built with oci-openshift ${request.stackVersion || '(unpinned)'}; stratus builds with ${STACK_RELEASE.version}`);
    const rm: RmApi = this.options.rm(request.region);
    // A stack already tagged with the domain is the one an earlier adoption made: its state is in, nothing to repeat.
    const found = (await rm.stacks_tagged(request.compartmentId, DOMAIN_TAG)).filter((stack): boolean => stack.tagValue === request.domain && stack.state === 'ACTIVE');
    if (found.length > 1) throw new Error(`${found.length} stacks in ${request.compartmentId} are tagged ${DOMAIN_TAG}=${request.domain}: ${found.map((stack) => stack.id).join(', ')}`);
    if (found.length === 1) {
      call.log(`stack ${found[0]!.id} is already tagged ${DOMAIN_TAG}=${request.domain}: taken as this domain's, its state already in`);
      return found[0]!.id;
    }
    const zip: Buffer = await this.zip_get();
    const stack = await rm.stack_create({
      compartmentId: request.compartmentId,
      displayName: `${request.domain} · a Trusted Domain`,
      description: `The ${request.domain} domain's infrastructure, oci-openshift ${STACK_RELEASE.version}, adopted from harbor-oci by stratus.`,
      zipBase64: zip.toString('base64'),
      variables: request.variables,
      tags: { [DOMAIN_TAG]: request.domain },
    });
    call.log(`stack ${stack.id} made in ${request.compartmentId}`);
    await this.job_run(rm, stack.id, { kind: 'import', stateBase64: request.state.toString('base64') }, `${request.domain}: import the state harbor-oci kept`, call);
    return stack.id;
  }

  async infra_plan(request: { domain: string; spec: DomainSpec; region: string; isoObject: string; stackRef?: string }, call: BuildCall): Promise<InfraPlan> {
    if (request.stackRef === undefined) throw new Error('a new domain\'s stack comes with the first real build (step 4d)');
    const rm: RmApi = this.options.rm(request.region);
    const job: RmJobRecord = await this.job_run(rm, request.stackRef, { kind: 'plan' }, `${request.domain}: plan`, call);
    return { ref: job.id, rows: planRows_read(await rm.jobPlan_read(job.id)) };
  }

  async preflight(_request: { domain: string; spec: DomainSpec; region: string; baseDomain: string }, _call: BuildCall): Promise<PreflightCheck[]> {
    throw new Error('preflight over OCI comes with the first real build (step 4d)');
  }

  async iso_store(_request: { domain: string; url: string; region: string }, _call: BuildCall): Promise<{ object: string; expires: string }> {
    throw new Error('the ISO\'s bucket on OCI comes with the first real build (step 4d)');
  }

  async infra_apply(_request: { domain: string; plan: InfraPlan; region: string }, _call: BuildCall): Promise<InfraOutputs> {
    throw new Error('an apply on OCI comes with the first real build (step 4d)');
  }

  async dns_upsert(_request: { domain: string; baseDomain: string; outputs: InfraOutputs }, _call: BuildCall): Promise<string[]> {
    throw new Error('DNS records on OCI come with the first real build (step 4d)');
  }

  async manifests_of(): Promise<PlatformManifest[]> {
    throw new Error('the platform manifests come with the first real build (step 4d)');
  }
}
