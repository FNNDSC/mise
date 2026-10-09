/**
 * @file The mounts a ChRIS session adds to salsa's dispatcher beyond CUBE's
 * own: `/bin`, and the hook that maps a logical path to the one CUBE stores.
 *
 * @module
 */
import { vfsDispatcher } from '@fnndsc/salsa';
import { logical_toPhysical } from '@fnndsc/chili/utils';
import type { Result } from '@fnndsc/fond';
import { session } from '../session/index.js';
import { BinVfsProvider } from './binMount.js';

let mounted: boolean = false;

/**
 * Adds `/bin` to the dispatcher, and the hook that maps a logical path to
 * the one CUBE stores (following `.chrislink` folders) unless the session is
 * in physical mode. Once; before the core adds its own mounts, so `/` lists
 * `/bin` where it always has.
 */
export function chrisMounts_register(): void {
  if (mounted) return;
  mounted = true;
  vfsDispatcher.provider_register(new BinVfsProvider());
  vfsDispatcher.pathResolver_register(async (logicalPath: string): Promise<string> => {
    if (session.physicalMode_get()) {
      return logicalPath;
    }
    const res: Result<string> = await logical_toPhysical(logicalPath);
    if (res.ok) {
      return res.value;
    }
    throw new Error(`Logical-to-physical resolution failed for path: ${logicalPath}`);
  });
}

