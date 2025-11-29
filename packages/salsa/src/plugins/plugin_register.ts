import { chrisConnection } from '@fnndsc/cumin';
import { PluginList } from '@fnndsc/chrisapi';

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
  [key: string]: unknown;
}

/**
 * Registers a new plugin with ChRIS CUBE.
 *
 * @param pluginData - The JSON payload representing the plugin's descriptor.
 * @param computeResources - Optional array of compute resource names to assign the plugin to.
 * @returns A Promise resolving to the registered plugin's data, or null on failure.
 */
export async function plugin_register(
  pluginData: PluginRegistrationData,
  computeResources?: string[]
): Promise<PluginRegistrationResponse | null> {
  try {
    const client = await chrisConnection.client_get();
    if (!client) {
      console.error('Error: Not connected to ChRIS. Please log in.');
      return null;
    }

    const pluginList: PluginList = await client.getPlugins();

    // Prepare data for POST request
    const data: Record<string, unknown> = {
      ...pluginData,
    };

    if (computeResources && computeResources.length > 0) {
      data.compute_resources = computeResources;
    }

    // Call the internal _post method directly.
    // The chrisapi library does not expose a public 'create' method on PluginList
    // but ListResource (its base class) provides _post.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (pluginList as any)._post(data);

    if (response && response.data) {
      console.log(`Plugin '${response.data.name}' registered successfully.`);
      return response.data;
    } else {
      console.error('Error: Failed to register plugin. No data in response.');
      return null;
    }
  } catch (error: unknown) {
    const errorMessage: string = error instanceof Error ? error.message : String(error);
    console.error(`Error registering plugin: ${errorMessage}`);
    return null;
  }
}
