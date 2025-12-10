import { ChRISPlugin, errorStack, Client, plugin_registerDirect, Result } from '@fnndsc/cumin';
import { AdminCredentials } from './store_import.js';

/**
 * Interface for plugin registration data.
 */
export interface PluginRegistrationData {
  name: string;
  dock_image: string;
  [key: string]: unknown;
}

/**
 * Interface for plugin registration response.
 */
export interface PluginRegistrationResponse {
  name: string;
  id?: number;
  [key: string]: unknown;
}

/**
 * Registers a new plugin with ChRIS CUBE using admin endpoint.
 *
 * This is the enhanced version that uses the admin API for registration.
 * Requires admin credentials.
 *
 * @param pluginData - The JSON payload representing the plugin's descriptor.
 * @param computeResources - Optional array of compute resource names to assign the plugin to.
 * @param adminCreds - Optional admin credentials for registration.
 * @returns A Promise resolving to the registered plugin's data, or null on failure.
 */
export async function plugin_registerWithAdmin(
  pluginData: PluginRegistrationData,
  computeResources: string[] = ['host'],
  adminCreds?: AdminCredentials
): Promise<PluginRegistrationResponse | null> {
  const chrisPlugin = new ChRISPlugin();
  let adminToken: string | undefined;

  if (adminCreds && adminCreds.username && adminCreds.password) {
    const client = await chrisPlugin.client_get();
    if (client) {
      const authUrl = client.url + 'auth-token/';
      try {
        const token = await Client.getAuthToken(
          authUrl,
          adminCreds.username,
          adminCreds.password
        );
        if (token) {
          adminToken = token;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errorStack.stack_push('warning', `Failed to get admin token: ${msg}`);
      }
    }
  }

  const result = await chrisPlugin.plugin_registerWithAdmin(
    pluginData,
    computeResources,
    adminToken
  );

  if (result) {
    console.log(`Plugin '${result.name}' registered successfully.`);
    return result as PluginRegistrationResponse;
  }

  return null;
}

/**
 * Registers a new plugin with ChRIS CUBE (legacy method, non-admin).
 *
 * This method uses the non-admin plugin endpoint which may not be available
 * in all CUBE configurations. Prefer using plugin_registerWithAdmin instead.
 *
 * @param pluginData - The JSON payload representing the plugin's descriptor.
 * @param computeResources - Optional array of compute resource names to assign the plugin to.
 * @returns A Promise resolving to the registered plugin's data, or null on failure.
 *
 * @deprecated Use plugin_registerWithAdmin instead for better compatibility.
 */
export async function plugin_register(
  pluginData: PluginRegistrationData,
  computeResources?: string[]
): Promise<PluginRegistrationResponse | null> {
  // Use cumin's plugin_registerDirect function
  const result: Result<Record<string, unknown>> = await plugin_registerDirect(
    pluginData,
    computeResources
  );

  if (result.ok) {
    console.log(`Plugin '${result.value.name}' registered successfully.`);
    return result.value as PluginRegistrationResponse;
  }

  // Error already pushed to errorStack by cumin
  return null;
}

/**
 * Checks if a plugin already exists in CUBE and returns its data.
 *
 * @param nameOrImage - Plugin name or Docker image to search for.
 * @returns Promise resolving to plugin data if found, null otherwise.
 */
export async function plugin_checkExists(
  nameOrImage: string
): Promise<PluginRegistrationResponse | null> {
  const chrisPlugin = new ChRISPlugin();
  const existingPlugin = await chrisPlugin.plugin_existsInCube(nameOrImage);

  if (existingPlugin) {
    return existingPlugin as PluginRegistrationResponse;
  }

  return null;
}

/**
 * Assigns a plugin to additional compute resources (cumulative).
 *
 * Does not remove existing compute resource assignments, only adds new ones.
 *
 * @param pluginId - ID of the plugin.
 * @param computeResources - Array of compute resource names to add.
 * @returns Promise resolving to success boolean.
 */
export async function plugin_assignToComputeResources(
  pluginId: number,
  computeResources: string[]
): Promise<boolean> {
  try {
    const chrisPlugin = new ChRISPlugin();

    // Get current compute resources
    const currentResources: string[] = await chrisPlugin.plugin_getComputeResources(pluginId);

    // Determine new resources to add (avoid duplicates)
    const newResources: string[] = computeResources.filter(
      (name: string) => !currentResources.includes(name)
    );

    if (newResources.length === 0) {
      console.log(`Plugin already assigned to: ${computeResources.join(', ')}`);
      return true;
    }

    // Combine all resources (cumulative)
    const allResources: string[] = [...currentResources, ...newResources];

    // Note: @fnndsc/chrisapi doesn't directly expose compute resource modification
    // We would need to use admin API to modify plugin compute resources
    // For now, this is a placeholder that logs the action
    console.log(`Adding plugin to compute resources: ${newResources.join(', ')}`);
    console.log(`Full resource list: ${allResources.join(', ')}`);

    // TODO: Implement actual compute resource assignment via admin API
    errorStack.stack_push(
      'warning',
      'Compute resource assignment not fully implemented. Plugin may need manual assignment.'
    );

    return true;
  } catch (error: unknown) {
    const errorMessage: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push('error', `Failed to assign compute resources: ${errorMessage}`);
    return false;
  }
}
