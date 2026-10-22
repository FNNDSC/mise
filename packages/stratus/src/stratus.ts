#!/usr/bin/env node
/**
 * @file The `stratus` command: hosts a substrate session as a calypso daemon.
 *
 * stratus ships its own launcher (docs/stratus.adoc, D2): it composes the
 * engine with the stratus backend over the OCI driver and hands it to
 * calypso's `daemon_launch`; calypso itself knows nothing of stratus. The
 * daemon runs on the bastion, the host that holds the cloud credential.
 *
 * Usage:
 *   stratus [--profile NAME] [--config FILE] [--region REGION]
 *           [--host-control[=TIERS]] [--expose-host-control]
 *   stratus --fake            a session over the fake cloud, for tests
 *
 * @module
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { engine_create, type BrasaEngine } from '@fnndsc/brasa/core';
import { daemon_launch, daemonConsole_run, hostControl_parseArgv, packageWebRoot_find, type DaemonLaunchInfo, type HostControlPolicy } from '@fnndsc/calypso';
import { stratusBackend_make, type StratusBackend } from './backend.js';
import type { CloudDriver } from './cloud/driver.js';
import { FakeDriver, fakeCloud_sample } from './cloud/fake/driver.js';
import { OciDriver } from './cloud/oci/driver.js';
import { ociApi_make } from './cloud/oci/api.js';
import { stratusArgs_parse } from './args.js';

const USAGE: string = [
  'stratus: a mise session over the cloud substrate a Trusted Domain runs on.',
  '',
  'Usage: stratus [--profile NAME] [--config FILE] [--region REGION]',
  '               [--domain NAME=CHECKOUT]… [--host-control[=shell,files,pipes,tasks]] [--expose-host-control]',
  '       stratus --fake',
  '',
  '  --profile NAME   the ~/.oci/config profile (DEFAULT)',
  '  --config FILE    the OCI configuration file (~/.oci/config)',
  '  --region REGION  the region the session works in (the profile\'s)',
  '  --domain NAME=CHECKOUT',
  '                   a Trusted Domain built by the harbor-oci checkout at CHECKOUT,',
  '                   shown under ~ (domains/NAME); repeat for each',
  '  --host-control=tasks',
  '                   let the session start jobs that change the cloud and bill;',
  '                   never granted by a bare --host-control',
  '  --fake           host a session over the fake cloud, for tests',
].join('\n');

/**
 * Hosts the daemon.
 */
async function stratus_start(): Promise<void> {
  const parsed = stratusArgs_parse(process.argv.slice(2));
  if ('error' in parsed) {
    console.error(`[!] ${parsed.error}`);
    process.exit(1);
  }
  if (parsed.args.help) {
    console.log(USAGE);
    return;
  }
  const driver: CloudDriver = parsed.args.fake
    ? new FakeDriver(fakeCloud_sample())
    : new OciDriver({ api: ociApi_make({ configFile: parsed.args.configFile, profile: parsed.args.profile }) });
  const made: StratusBackend = stratusBackend_make({ driver, region: parsed.args.region, domains: parsed.args.domains });
  const engine: BrasaEngine = await engine_create(made.backend);
  if (made.session.identity === null) {
    console.error(`[!] Not connected to ${driver.cloud}: ${made.session.disconnectedReason ?? 'no credential'}; hosting offline.`);
  } else {
    console.error(`[+] ${made.session.identity.user}@${made.session.identity.tenancy} on ${driver.cloud}, region ${made.session.region}.`);
  }

  const parsedPolicy = hostControl_parseArgv(process.argv, process.env);
  if ('error' in parsedPolicy) {
    console.error(`[!] ${parsedPolicy.error}`);
    process.exit(1);
  }
  const policy: HostControlPolicy = parsedPolicy.policy;
  const info: DaemonLaunchInfo = await daemon_launch(engine, undefined, {
    hostControl: policy,
    webRoot: packageWebRoot_find('@fnndsc/argus'),
  });
  if (process.stdin.isTTY === true && process.stdout.isTTY === true) {
    await daemonConsole_run({ identity: info.identity, url: info.url, token: info.token });
  }
}

const currentFile: string = fileURLToPath(import.meta.url);
let isMain: boolean = false;
try {
  isMain = realpathSync(process.argv[1]) === realpathSync(currentFile);
} catch {
  // Not invoked as a script.
}

if (isMain) {
  stratus_start().catch((error: unknown): void => {
    console.error(`[!] stratus: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
