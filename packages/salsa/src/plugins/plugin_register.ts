import { chrisConnection } from '@fnndsc/cumin';
import { PluginList } from '@fnndsc/chrisapi';

/**
 * Registers a new plugin with ChRIS CUBE.
 *
 * @param pluginData - The JSON payload representing the plugin's descriptor.
 * @param computeResources - Optional array of compute resource names to assign the plugin to.
 * @returns A Promise resolving to the registered plugin's data, or null on failure.
 */
export async function plugin_register(
  pluginData: any,
  computeResources?: string[]
): Promise<any | null> {
  try {
    const client = await chrisConnection.client_get();
    if (!client) {
      console.error('Error: Not connected to ChRIS. Please log in.');
      return null;
    }

    const pluginList: PluginList = await client.getPlugins();

    // Prepare data for POST request
    const data: any = {
      ...pluginData,
    };

    if (computeResources && computeResources.length > 0) {
      data.compute_resources = computeResources;
    }

    // Call the internal _post method directly.
    // The chrisapi library does not expose a public 'create' method on PluginList
    // but ListResource (its base class) provides _post.
    const response = await (pluginList as any)._post(data);

    if (response && response.data) {
      console.log(`Plugin '${response.data.name}' registered successfully.`);
      return response.data;
    } else {
      console.error('Error: Failed to register plugin. No data in response.');
      return null;
    }
  } catch (error: any) {
    console.error(`Error registering plugin: ${error.message}`);
    return null;
  }
}
