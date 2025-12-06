/**
 * @file Builtin pwd command.
 * Prints the current working directory.
 */
import { session } from '../../session/index.js';
import { chrisConnection } from '@fnndsc/cumin';
import { feeds_list } from '@fnndsc/salsa';

/**
 * Prints the current working directory in the ChRIS filesystem context.
 *
 * @param args - Command arguments (--title flag supported).
 * @returns A Promise that resolves when the directory is printed.
 */
export async function builtin_pwd(args: string[] = []): Promise<void> {
  const showTitles: boolean = args.includes('--title');
  const cwd: string = await session.getCWD();

  if (!showTitles) {
    console.log(cwd);
    return;
  }

  // Replace feed and plugin patterns with titles
  const titlePath: string = await path_withTitles(cwd);
  console.log(titlePath);
}

/**
 * Replaces feed_XXXX and pl-<name>_XXXX patterns in a path with their titles.
 *
 * @param path - The path to process.
 * @returns The path with titles replacing directory names.
 */
async function path_withTitles(path: string): Promise<string> {
  const parts: string[] = path.split('/');
  const replacedParts: string[] = await Promise.all(
    parts.map(async (part: string): Promise<string> => {
      // Pattern 1: feed_XXXX
      const feedMatch: RegExpMatchArray | null = part.match(/^feed_(\d+)$/);
      if (feedMatch) {
        const feedId: number = parseInt(feedMatch[1], 10);
        try {
          const feedData: any = await feeds_list({ id: feedId, limit: 1 });
          if (feedData && feedData.tableData && feedData.tableData.length > 0) {
            const feed: any = feedData.tableData[0];
            if (feed && feed.name) {
              return feed.name;
            }
          }
        } catch (e: unknown) {
          // Silently ignore errors
        }
        return part;
      }

      // Pattern 2: pl-<name>_XXXX
      const pluginMatch: RegExpMatchArray | null = part.match(/^(pl-.+)_(\d+)$/);
      if (pluginMatch) {
        const pluginInstanceId: number = parseInt(pluginMatch[2], 10);
        try {
          const client: any = await chrisConnection.client_get();
          if (client) {
            const instance: any = await client.getPluginInstance(pluginInstanceId);
            if (instance && instance.data) {
              const pluginName: string = instance.data.plugin_name || '';
              const pluginVersion: string = instance.data.plugin_version || '';
              return pluginVersion ? `${pluginName} v${pluginVersion}` : pluginName;
            }
          }
        } catch (e: unknown) {
          // Silently ignore errors
        }
        return part;
      }

      return part; // Return unchanged if no match
    })
  );

  return replacedParts.join('/');
}
