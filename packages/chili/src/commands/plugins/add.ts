/**
 * @file Implements the logic for adding (registering) new ChRIS plugins.
 *
 * This module orchestrates a three-phase plugin registration strategy:
 * 1. Check if plugin exists in current CUBE → assign to compute resources
 * 2. Search peer stores → import from store if found
 * 3. Docker extraction → pull image, extract JSON, register
 *
 * @module
 */

import { CLIoptions } from '../../utils/cli.js';
import {
  docker_checkAvailability,
  shellCommand_run,
  shellCommand_runWithDetails,
  docker_pullImage,
  docker_getImageCmd,
} from '../../utils/docker.js';
import {
  plugin_registerWithAdmin,
  plugin_checkExists,
  plugin_assignToComputeResources,
  plugins_searchPeers,
  plugin_importFromStore,
  PluginRegistrationData,
  PeerStorePlugin,
  PluginImportResult,
  PluginRegistrationResponse,
} from '@fnndsc/salsa';
import {
  computeResources_validate,
  computeResourceNames_parse,
  computeResources_getAll,
  ComputeResource,
  errorStack,
  Result,
} from '@fnndsc/cumin';
import path from 'path';
import {
  input_detectFormat,
  PluginInputFormat,
  DetectedFormat,
} from '../../utils/input_format.js';
import {
  adminCredentials_prompt,
  AdminCredentials,
} from '../../utils/admin_prompt.js';
import { chiliErrLog, chiliLog } from "../../screen/output.js";

/**
 * Describes the shape of the JSON object returned by a ChRIS plugin's
 * `chris_plugin_info` or `--json` entrypoint.
 */
interface PluginInfo {
  name: string;
  dock_image: string;
  public_repo?: string;
  [key: string]: unknown;
}

/**
 * Options specific to plugin add command.
 */
interface PluginAddOptions extends CLIoptions {
  compute?: string;
  store?: string;
  adminUser?: string;
  adminPassword?: string;
  public_repo?: string;
}

/**
 * Outcome of a plugin add operation.
 */
export type PluginAddOutcome = 'installed' | 'already_exists' | 'failed';

async function computeResources_resolve(
  options: PluginAddOptions
): Promise<Result<string[]>> {
  if (options.compute) {
    const names: string[] = computeResourceNames_parse(options.compute);
    const validationResult: Result<string[]> = await computeResources_validate(names);
    if (!validationResult.ok) {
      const errors: string[] = errorStack.allOfType_get('error');
      errors.forEach((err: string) => chiliErrLog(err));
      return { ok: false };
    }
    return { ok: true, value: names };
  }
  const allResult: Result<ComputeResource[]> = await computeResources_getAll();
  if (allResult.ok && allResult.value.length > 0) {
    const names: string[] = allResult.value.map((r: ComputeResource) => r.name);
    chiliLog(`Using compute resources: ${names.join(', ')}`);
    return { ok: true, value: names };
  }
  return { ok: true, value: ['host'] };
}

/**
 * Adds a plugin to the ChRIS store from the given input.
 *
 * @param input - Plugin source (image, URL, or path).
 * @param options - Plugin add options.
 * @returns The add outcome.
 */
export async function plugin_add(
  input: string,
  options: PluginAddOptions
): Promise<PluginAddOutcome> {
  const detected: DetectedFormat = input_detectFormat(input);
  chiliLog(`Detected input format: ${detected.format}`);

  const resourcesResult: Result<string[]> = await computeResources_resolve(options);
  if (!resourcesResult.ok) return 'failed';
  const computeResources: string[] = resourcesResult.value;

  // Phase 1: Check if plugin exists in current CUBE
  chiliLog('\n=== Phase 1: Checking current CUBE ===');
  const searchTerm: string = detected.format === PluginInputFormat.DOCKER_IMAGE
    ? detected.pluginName || detected.value
    : detected.value;

  const existingPlugin: PluginRegistrationResponse | null = await plugin_checkExists(searchTerm);
  if (existingPlugin) {
    return 'already_exists';
  }

  chiliLog('Plugin not found in current CUBE.');

  // Phase 2: Search peer stores (skip if input is store URL)
  if (detected.format !== PluginInputFormat.STORE_URL) {
    chiliLog('\n=== Phase 2: Searching peer stores ===');
    const peerStoreUrls: string[] = options.store
      ? [options.store]
      : ['https://cube.chrisproject.org/api/v1/'];

    const searchName: string = detected.format === PluginInputFormat.DOCKER_IMAGE
      ? detected.pluginName! // Should be present for docker images
      : detected.value;
    
    const searchVersion: string | undefined = detected.format === PluginInputFormat.DOCKER_IMAGE
      ? detected.version
      : undefined;

    const peerResult: PeerStorePlugin | null = await plugins_searchPeers(searchName, searchVersion, peerStoreUrls);
    if (peerResult) {
      chiliLog(`Found plugin in peer store: ${peerResult.storeName}`);
      const ok: boolean = await pluginFromStore_register(
        peerResult.plugin,
        computeResources,
        options
      );
      return ok ? 'installed' : 'failed';
    }

    chiliLog('Plugin not found in peer stores.');
  }

  // Phase 3: Docker extraction (only for Docker images or plugin names)
  if (detected.format !== PluginInputFormat.STORE_URL) {
    chiliLog('\n=== Phase 3: Docker extraction ===');
    const dockerImage: string = detected.format === PluginInputFormat.DOCKER_IMAGE
      ? detected.value
      : `${detected.value}:latest`;  // Assume latest tag for plugin names

    const ok: boolean = await pluginFromDocker_register(dockerImage, computeResources, options);
    return ok ? 'installed' : 'failed';
  }

  // If we get here with a store URL, we couldn't process it
  chiliErrLog('Store URL import not yet fully supported.');
  return 'failed';
}

/**
 * Registers a plugin from peer store data.
 *
 * Handles admin authentication with retry logic (up to 3 attempts).
 *
 * @param pluginData - Plugin data from peer store.
 * @param computeResources - Compute resources to assign plugin to.
 * @param options - CLI options including admin credentials.
 * @returns Promise resolving to success boolean.
 */
async function pluginFromStore_register(
  pluginData: Record<string, unknown>,
  computeResources: string[],
  options: PluginAddOptions
): Promise<boolean> {
  chiliLog('Importing plugin from peer store...');

  const initialCreds: AdminCredentials | undefined = 
    options.adminUser && options.adminPassword 
      ? { username: options.adminUser, password: options.adminPassword } 
      : undefined;

  // Try with provided credentials (or current user)
  const result: PluginImportResult = await plugin_importFromStore(
    '', // Store URL not needed when we have plugin data
    pluginData,
    computeResources,
    initialCreds
  );

  if (result.success) {
    chiliLog(`Plugin '${result.plugin?.name}' registered successfully.`);
    return true;
  }

  if (!result.requiresAuth) {
    chiliErrLog(result.errorMessage || 'Failed to import plugin from store.');
    return false;
  }

  // Admin auth required - try with interactive credentials
  const retrySuccess: boolean = await registrationWithAuth_retry(
    async (creds: AdminCredentials) => {
      const retryResult: PluginImportResult = await plugin_importFromStore('', pluginData, computeResources, creds);
      return retryResult.success;
    },
    options
  );

  if (!retrySuccess) {
    chiliErrLog('Failed to import plugin from store (authentication failed or rejected).');
    const errors: string[] = errorStack.allOfType_get('error');
    if (errors.length > 0) {
      chiliErrLog('Errors:');
      errors.forEach((e: string) => chiliErrLog(`- ${e}`));
    }

    const warnings: string[] = errorStack.allOfType_get('warning');
    if (warnings.length > 0) {
      chiliErrLog('Warnings:');
      warnings.forEach((e: string) => chiliErrLog(`- ${e}`));
    }
  }

  return retrySuccess;
}

/**
 * Registers a plugin from Docker image.
 *
 * Pulls image (or uses local), extracts JSON descriptor, and registers with admin API.
 *
 * @param image - Docker image name/tag.
 * @param computeResources - Compute resources to assign plugin to.
 * @param options - CLI options including admin credentials.
 * @returns Promise resolving to success boolean.
 */
async function pluginFromDocker_register(
  image: string,
  computeResources: string[],
  options: PluginAddOptions
): Promise<boolean> {
  if (!await docker_checkAvailability()) {
    return false;
  }

  // Pull Docker image (checks local first)
  const pulled: boolean = await docker_pullImage(image);
  if (!pulled) {
    return false;
  }

  chiliLog('Extracting plugin descriptor from image...');
  const pluginData: PluginInfo | null = await pluginJSON_extractFromImage(image, options);
  if (!pluginData) {
    const msg: string = 'Failed to extract plugin descriptor from image.';
    chiliErrLog(msg);
    errorStack.stack_push('error', msg);
    return false;
  }

  // Infer missing fields
  pluginData_inferMissingFields(pluginData, image, options);

  const initialCreds: AdminCredentials | undefined = 
    options.adminUser && options.adminPassword 
      ? { username: options.adminUser, password: options.adminPassword } 
      : undefined;

  // Register with admin API
  chiliLog('Registering plugin with ChRIS CUBE...');
  const registered: PluginRegistrationResponse | null = await plugin_registerWithAdmin(
    pluginData as unknown as PluginRegistrationData, 
    computeResources,
    initialCreds
  );

  if (registered) {
    chiliLog(`Plugin '${registered.name}' registered successfully.`);
    return true;
  }

  // Check if failure was due to admin auth
  const errors: string[] = errorStack.allOfType_get('error');
  const authError: boolean = errors.some((e: string) => {
    const lowerE: string = e.toLowerCase();
    return lowerE.includes('unauthorized') ||
           lowerE.includes('forbidden') ||
           lowerE.includes('permission denied') ||
           lowerE.includes('401') ||
           lowerE.includes('403') ||
           lowerE.includes('admin credentials required');
  });

  if (!authError) {
    chiliErrLog('Failed to register plugin.');
    return false;
  }

  // Retry with admin credentials
  return await registrationWithAuth_retry(
    async (creds: AdminCredentials) => {
      const retryResult: PluginRegistrationResponse | null = await plugin_registerWithAdmin(
          pluginData as unknown as PluginRegistrationData,
          computeResources, 
          creds
      );
      return retryResult !== null;
    },
    options
  );
}

/**
 * Extracts plugin JSON descriptor from a Docker image.
 *
 * Tries three methods in order (matching chrisomatic behavior):
 * 1. chris_plugin_info with arguments (post 0.3.0)
 * 2. chris_plugin_info without arguments (pre 0.3.0)
 * 3. <CMD> --json where CMD is extracted from image (old chrisapp)
 *
 * @param image - Docker image name/tag.
 * @param options - Plugin add options (for inferring name/repo).
 * @returns Promise resolving to plugin data or null.
 */
async function pluginJSON_extractFromImage(
  image: string,
  options: PluginAddOptions
): Promise<PluginInfo | null> {
  const methods: Array<{
    name: string;
    fn: () => Promise<string | null>;
  }> = [
    {
      name: 'chris_plugin_info (post v0.3.0)',
      fn: async () => await pluginJSON_tryChrisPluginInfoWithArgs(image, options),
    },
    {
      name: 'chris_plugin_info (pre v0.3.0)',
      fn: async () => await pluginJSON_tryChrisPluginInfo(image),
    },
    {
      name: 'CMD --json (old chrisapp)',
      fn: async () => await pluginJSON_tryOldChrisapp(image),
    },
  ];

  for (const method of methods) {
    chiliLog(`Trying ${method.name}...`);
    const jsonString: string | null = await method.fn();

    if (jsonString && jsonString.trim() !== '') {
      try {
        const parsed: PluginInfo = JSON.parse(jsonString) as PluginInfo;
        chiliLog(`Successfully extracted plugin descriptor using ${method.name}`);
        return parsed;
      } catch (e: unknown) {
        const msg: string = `Failed to parse JSON from ${method.name}`;
        chiliErrLog(msg);
        errorStack.stack_push('error', msg);
      }
    }
  }

  const msg: string = 'All plugin descriptor extraction methods failed';
  errorStack.stack_push('error', msg);
  errorStack.stack_push(
    'error',
    'This plugin may not be a ChRIS plugin, or uses an unsupported format'
  );
  return null;
}

/**
 * Tries chris_plugin_info with arguments (post 0.3.0 format).
 *
 * @param image - Docker image name/tag.
 * @param options - Plugin options for inferring name/repo.
 * @returns Promise resolving to JSON string or null.
 */
async function pluginJSON_tryChrisPluginInfoWithArgs(
  image: string,
  options: PluginAddOptions
): Promise<string | null> {
  const args: string[] = ['chris_plugin_info', '--dock-image', image];

  if (options.public_repo) {
    args.push('--public-repo', options.public_repo);
  }

  const command: string = `docker run --rm ${image} ${args.join(' ')}`;
  const result: { stdout: string; stderr: string; success: boolean; error?: string } = await shellCommand_runWithDetails(command);

  if (!result.success || !result.stdout || result.stdout.trim() === '') {
    if (result.error || result.stderr) {
      errorStack.stack_push(
        'warning',
        `chris_plugin_info (with args) failed: ${result.error || result.stderr}`
      );
    }
    return null;
  }

  return result.stdout;
}

/**
 * Tries chris_plugin_info without arguments (pre 0.3.0 format).
 *
 * @param image - Docker image name/tag.
 * @returns Promise resolving to JSON string or null.
 */
async function pluginJSON_tryChrisPluginInfo(image: string): Promise<string | null> {
  const command: string = `docker run --rm ${image} chris_plugin_info`;
  const result: { stdout: string; stderr: string; success: boolean; error?: string } = await shellCommand_runWithDetails(command);

  if (!result.success || !result.stdout || result.stdout.trim() === '') {
    if (result.error || result.stderr) {
      errorStack.stack_push(
        'warning',
        `chris_plugin_info failed: ${result.error || result.stderr}`
      );
    }
    return null;
  }

  return result.stdout;
}

/**
 * Tries old chrisapp format by extracting CMD and running with --json.
 *
 * @param image - Docker image name/tag.
 * @returns Promise resolving to JSON string or null.
 */
async function pluginJSON_tryOldChrisapp(image: string): Promise<string | null> {
  const cmd: string[] = await docker_getImageCmd(image);

  if (cmd.length === 0) {
    errorStack.stack_push(
      'warning',
      'Could not extract CMD from Docker image'
    );
    return null;
  }

  const command: string = `docker run --rm ${image} ${cmd[0]} --json`;
  chiliLog(`  Running: ${cmd[0]} --json`);
  const result: { stdout: string; stderr: string; success: boolean; error?: string } = await shellCommand_runWithDetails(command);

  if (!result.success || !result.stdout || result.stdout.trim() === '') {
    if (result.error || result.stderr) {
      errorStack.stack_push(
        'warning',
        `${cmd[0]} --json failed: ${result.error || result.stderr}`
      );
    }
    return null;
  }

  return result.stdout;
}

/**
 * Infers missing fields in plugin data from image name and options.
 *
 * Modifies pluginData in place.
 *
 * @param pluginData - Plugin data object to modify.
 * @param image - Docker image name/tag.
 * @param options - CLI options.
 */
function pluginData_inferMissingFields(
  pluginData: PluginInfo,
  image: string,
  options: PluginAddOptions
): void {
  if (!pluginData.name) {
    const imageNameWithoutTag: string = image.split(':')[0];
    pluginData.name = path.basename(imageNameWithoutTag);
    chiliLog(`Inferred plugin name: ${pluginData.name}`);
  }

  if (!pluginData.dock_image) {
    pluginData.dock_image = image;
    chiliLog(`Inferred dock_image: ${pluginData.dock_image}`);
  }

  if (!pluginData.public_repo && options.public_repo) {
    pluginData.public_repo = options.public_repo;
    chiliLog(`Using provided public_repo: ${pluginData.public_repo}`);
  } else if (!pluginData.public_repo && image.includes('/')) {
    const repoGuess: string = image.split('/')[0] + '/' + path.basename(image.split(':')[0]);
    pluginData.public_repo = `https://github.com/${repoGuess}`;
    chiliLog(`Inferred public_repo: ${pluginData.public_repo}`);
  }
}

/**
 * Retries a registration operation with admin credential prompting.
 *
 * Allows up to 3 attempts. Uses provided credentials or prompts interactively.
 *
 * @param registrationFn - Function that attempts registration with credentials.
 * @param options - CLI options including admin credentials.
 * @returns Promise resolving to success boolean.
 */
async function registrationWithAuth_retry(
  registrationFn: (creds: AdminCredentials) => Promise<boolean>,
  options: PluginAddOptions
): Promise<boolean> {
  const MAX_ATTEMPTS: number = 3;

  // If credentials provided via flags, try once
  if (options.adminUser && options.adminPassword) {
    const creds: AdminCredentials = {
      username: options.adminUser,
      password: options.adminPassword,
    };
    return await registrationFn(creds);
  }

  // Interactive prompting with retry
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const creds: AdminCredentials | null = await adminCredentials_prompt(attempt, MAX_ATTEMPTS);

    if (!creds) {
      chiliLog('Authentication cancelled.');
      return false;
    }

    const success: boolean = await registrationFn(creds);
    if (success) {
      return true;
    }

    if (attempt < MAX_ATTEMPTS) {
      chiliLog('Authentication failed.');
    }
  }

  chiliErrLog(`Authentication failed after ${MAX_ATTEMPTS} attempts.`);
  return false;
}
