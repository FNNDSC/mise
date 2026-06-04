/**
 * @file Job (plugin instance) cancel and delete operations.
 *
 * @module
 */

import { chrisConnection, errorStack, Result, Ok, Err } from '@fnndsc/cumin';

/** Statuses that cannot be cancelled — operation is already done. */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'finishedSuccessfully',
  'finishedWithError',
  'cancelled',
]);

/**
 * Plugin instance object returned by chrisapi (minimal shape we need).
 */
interface PluginInstanceObj {
  data: { status?: string; [key: string]: unknown };
  put(data: Record<string, unknown>): Promise<unknown>;
  delete(): Promise<void>;
}

/**
 * Cancels a running or scheduled plugin instance.
 * No-op if already terminal (returns Ok).
 *
 * @param instanceID - The plugin instance ID.
 * @returns Ok(true) on success, Err on failure.
 *
 * @example
 * ```typescript
 * const result = await job_cancel(789);
 * if (!result.ok) console.error('Cancel failed');
 * ```
 */
export async function job_cancel(instanceID: number): Promise<Result<boolean>> {
  try {
    const client = await chrisConnection.client_get();
    if (!client) {
      errorStack.stack_push('error', 'Not connected to ChRIS.');
      return Err();
    }

    const instance = await (client as unknown as {
      getPluginInstance(id: number): Promise<PluginInstanceObj>;
    }).getPluginInstance(instanceID);

    if (!instance) {
      errorStack.stack_push('error', `Plugin instance ${instanceID} not found.`);
      return Err();
    }

    const status: string = (instance.data.status as string) ?? '';
    if (TERMINAL_STATUSES.has(status)) {
      return Ok(true);
    }

    await instance.put({ status: 'cancelled' });
    return Ok(true);
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push('error', `Failed to cancel instance ${instanceID}: ${msg}`);
    return Err();
  }
}

/**
 * Deletes a plugin instance record from ChRIS.
 * Only call on terminal instances — cancels first if non-terminal.
 *
 * @param instanceID - The plugin instance ID.
 * @returns Ok(true) on success, Err on failure.
 *
 * @example
 * ```typescript
 * const result = await job_delete(789);
 * if (!result.ok) console.error('Delete failed');
 * ```
 */
export async function job_delete(instanceID: number): Promise<Result<boolean>> {
  try {
    const client = await chrisConnection.client_get();
    if (!client) {
      errorStack.stack_push('error', 'Not connected to ChRIS.');
      return Err();
    }

    const instance = await (client as unknown as {
      getPluginInstance(id: number): Promise<PluginInstanceObj>;
    }).getPluginInstance(instanceID);

    if (!instance) {
      errorStack.stack_push('error', `Plugin instance ${instanceID} not found.`);
      return Err();
    }

    const status: string = (instance.data.status as string) ?? '';
    if (!TERMINAL_STATUSES.has(status)) {
      await instance.put({ status: 'cancelled' });
    }

    await instance.delete();
    return Ok(true);
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push('error', `Failed to delete instance ${instanceID}: ${msg}`);
    return Err();
  }
}

/**
 * Fetches the current status string for a plugin instance directly from the API.
 *
 * @param instanceID - The plugin instance ID.
 * @returns Ok(statusString) or Err on failure.
 *
 * @example
 * ```typescript
 * const result = await job_statusFetch(789);
 * if (result.ok) console.log(result.value); // 'finishedSuccessfully'
 * ```
 */
export async function job_statusFetch(instanceID: number): Promise<Result<string>> {
  try {
    const client = await chrisConnection.client_get();
    if (!client) {
      errorStack.stack_push('error', 'Not connected to ChRIS.');
      return Err();
    }

    const instance = await (client as unknown as {
      getPluginInstance(id: number): Promise<PluginInstanceObj>;
    }).getPluginInstance(instanceID);

    if (!instance) {
      errorStack.stack_push('error', `Plugin instance ${instanceID} not found.`);
      return Err();
    }

    const status: string = (instance.data.status as string) ?? 'unknown';
    return Ok(status);
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push('error', `Failed to fetch status for instance ${instanceID}: ${msg}`);
    return Err();
  }
}

/**
 * Searches for plugin instances by plugin name (substring match).
 * Returns id, feedID, pluginName, and status for each match.
 *
 * @param pluginName - Plugin name substring to search for.
 * @returns Ok(array of matches) or Err on failure.
 *
 * @example
 * ```typescript
 * const r = await jobs_searchByPluginName('pl-fshack');
 * // r.value = [{ id: 789, feedID: 123, pluginName: 'pl-fshack', status: 'finishedSuccessfully' }, ...]
 * ```
 */
export async function jobs_searchByPluginName(
  pluginName: string
): Promise<Result<Array<{ id: number; feedID: number; pluginName: string; status: string }>>> {
  try {
    const client = await chrisConnection.client_get();
    if (!client) {
      errorStack.stack_push('error', 'Not connected to ChRIS.');
      return Err();
    }

    interface InstListResult {
      data: Array<{ id?: unknown; feed_id?: unknown; plugin_name?: unknown; status?: unknown }> | null;
    }
    const PAGE: number = 100;
    const results: Array<{ id: number; feedID: number; pluginName: string; status: string }> = [];
    let offset: number = 0;

    while (true) {
      const page: InstListResult = await (client as unknown as {
        getPluginInstances(p: Record<string, unknown>): Promise<InstListResult>;
      }).getPluginInstances({ plugin_name: pluginName, limit: PAGE, offset });

      const chunk = page.data ?? [];
      for (const inst of chunk) {
        results.push({
          id: Number(inst.id),
          feedID: Number(inst.feed_id),
          pluginName: String(inst.plugin_name),
          status: String(inst.status),
        });
      }
      if (chunk.length < PAGE) break;
      offset += PAGE;
    }

    return Ok(results);
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push('error', `Failed to search plugin instances: ${msg}`);
    return Err();
  }
}

/**
 * Looks up which feed a plugin instance belongs to.
 *
 * @param instanceID - The plugin instance ID.
 * @returns Ok(feedID) or Err if not found.
 *
 * @example
 * ```typescript
 * const r = await job_feedID_get(64306);
 * if (r.ok) console.log(r.value); // 1107
 * ```
 */
export async function job_feedID_get(instanceID: number): Promise<Result<number>> {
  try {
    const client = await chrisConnection.client_get();
    if (!client) {
      errorStack.stack_push('error', 'Not connected to ChRIS.');
      return Err();
    }

    interface InstListResult {
      data: Array<{ feed_id?: unknown; id?: unknown }> | null;
    }
    const result: InstListResult = await (client as unknown as {
      getPluginInstances(p: Record<string, unknown>): Promise<InstListResult>;
    }).getPluginInstances({ id: instanceID, limit: 1 });

    const hit: { feed_id?: unknown } | undefined = result.data?.[0];
    if (!hit || hit.feed_id === undefined || hit.feed_id === null) {
      errorStack.stack_push('error', `Instance ${instanceID} not found.`);
      return Err();
    }

    return Ok(Number(hit.feed_id));
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push('error', `Failed to find feed for instance ${instanceID}: ${msg}`);
    return Err();
  }
}

/**
 * Fetches the log output for a plugin instance from the API.
 *
 * @param instanceID - The plugin instance ID.
 * @returns Ok(logString) or Err on failure.
 */
export async function job_logFetch(instanceID: number): Promise<Result<string>> {
  try {
    const client = await chrisConnection.client_get();
    if (!client) {
      errorStack.stack_push('error', 'Not connected to ChRIS.');
      return Err();
    }

    const instance = await (client as unknown as {
      getPluginInstance(id: number): Promise<PluginInstanceObj & {
        getLogs?(): Promise<{ data: { log?: string }[] }>;
      }>;
    }).getPluginInstance(instanceID);

    if (!instance) {
      errorStack.stack_push('error', `Plugin instance ${instanceID} not found.`);
      return Err();
    }

    if (!instance.getLogs) {
      return Ok('(log not available for this instance)');
    }

    const logsResult = await instance.getLogs();
    const logText: string = logsResult.data
      .map((entry: { log?: string }) => entry.log ?? '')
      .join('\n');
    return Ok(logText || '(no log output yet)');
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push('error', `Failed to fetch log for instance ${instanceID}: ${msg}`);
    return Err();
  }
}
