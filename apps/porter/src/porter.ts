#!/usr/bin/env node
/**
 * @file The `porter` entry: the mise display manager.
 *
 * Reads its configuration from the environment, stands a process host on
 * this machine, and listens. `porter --status` lists the sessions a running
 * porter's state directory holds.
 *
 * @module
 */
import { porterConfig_resolve, type PorterConfig } from './config.js';
import { ProcessHost } from './host/processHost.js';
import { porterApp_build, type PorterApp } from './app.js';

async function porter_start(): Promise<void> {
  let config: PorterConfig;
  try {
    config = porterConfig_resolve(process.env);
  } catch (error: unknown) {
    console.error(`[!] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  const host: ProcessHost = new ProcessHost({ stateDir: config.stateDir, chellEntry: config.chellEntry });
  const built: PorterApp = await porterApp_build({ config, host, logger: false });
  await built.app.listen({ host: config.host, port: config.port });
  console.log(`[+] PORTER at http://${config.host}:${config.port}/ for ${config.cubeUrl}`);
  console.log(`    state:  ${config.stateDir}`);
  console.log(`    chell:  ${config.chellEntry}`);
  const stop = async (): Promise<void> => {
    await built.app.close();
    process.exit(0);
  };
  process.once('SIGINT', (): void => { void stop(); });
  process.once('SIGTERM', (): void => { void stop(); });
}

void porter_start();
