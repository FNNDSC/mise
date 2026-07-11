/**
 * @file Engine store configuration: which ChRIS peer store the engine targets.
 *
 * This is engine state, not a surface preference: the `store` builtin reads and
 * mutates it. The value lives here, but where it is persisted is the host's
 * concern — a CLI writes it to a settings file, a daemon may hold it per
 * session, a headless host keeps it in memory. The host installs a persistence
 * callback via {@link storeConfigPersist_install}; with none installed the
 * value simply lives for the process, so the engine carries no file or path
 * knowledge of its own.
 *
 * @module
 */

/** Built-in peer store used when the operator has set no override. */
export const DEFAULT_STORE_URL: string = 'https://cube.chrisproject.org/api/v1/';

/** The operator's override, or undefined to use {@link DEFAULT_STORE_URL}. */
let storeUrl: string | undefined;

/** Host-installed persistence hook; the default keeps the value in memory. */
let persist: () => Promise<void> = async (): Promise<void> => {
  // Headless default: the override lives for the process and is not persisted.
};

/**
 * Returns the peer store URL in effect, falling back to the built-in default.
 *
 * @returns The store URL to use.
 */
export function storeUrl_get(): string {
  return storeUrl ?? DEFAULT_STORE_URL;
}

/**
 * Reports whether the effective store URL is the built-in default.
 *
 * @returns True when no override is set.
 */
export function storeUrl_isDefault(): boolean {
  return storeUrl === undefined;
}

/**
 * Returns the operator's override without applying the default.
 *
 * The persistence layer uses this so it writes only an explicit override.
 *
 * @returns The override URL, or undefined when none is set.
 */
export function storeUrlOverride_get(): string | undefined {
  return storeUrl;
}

/**
 * Sets the peer store override.
 *
 * @param url - The store URL to use.
 */
export function storeUrl_set(url: string): void {
  storeUrl = url;
}

/**
 * Clears the peer store override, restoring the built-in default.
 */
export function storeUrl_clear(): void {
  storeUrl = undefined;
}

/**
 * Installs the host's persistence hook.
 *
 * @param fn - Callback invoked to persist the current store configuration.
 */
export function storeConfigPersist_install(fn: () => Promise<void>): void {
  persist = fn;
}

/**
 * Persists the current store configuration through the installed hook.
 *
 * @returns A promise resolving once persistence completes.
 */
export async function storeConfig_persist(): Promise<void> {
  await persist();
}
