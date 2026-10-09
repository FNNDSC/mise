/**
 * @file The filesystem contract every mount is held to, as cases a test runs.
 *
 * A backend's mount answers the operations fond names with the errno a disk
 * would give: what the core's tools say is decided from that errno, so a
 * mount that answers differently makes them say something untrue. Each case
 * here builds a fresh mount through the driver it is given, seeds it, and
 * throws when the mount breaks the contract. An operation the mount does not
 * offer is skipped, not failed: a read-only mount is a mount.
 *
 * @module
 */
import type { VFSProvider, VFSItem } from './provider.js';
import type { VfsErrno, VfsOutcome } from './outcome.js';
import type { MemorySeed } from './memory.js';
import type { Result } from '../result.js';

/** What a test hands the contract: how to make a fresh, seeded mount. */
export interface VfsContractDriver {
  /** A fresh mount holding exactly what the seed names (parents made as needed), its root at `/`. */
  mount_make(seed: MemorySeed): Promise<VFSProvider>;
}

/** One case: its name, and a run that throws on a breach. */
export interface VfsContractCase {
  name: string;
  run(driver: VfsContractDriver): Promise<void>;
}

/**
 * Fails a case.
 *
 * @param what - What was wrong.
 */
function breach(what: string): never {
  throw new Error(`contract breach: ${what}`);
}

/**
 * Requires a success.
 *
 * @param outcome - The answer.
 * @param what - The operation, for the breach.
 * @returns Its value.
 */
function done<T>(outcome: VfsOutcome<T>, what: string): T {
  if (!outcome.ok) breach(`${what} failed with ${outcome.errno}${outcome.reason ? ` (${outcome.reason})` : ''}`);
  return outcome.value;
}

/**
 * Requires a failure with one of the errnos named.
 *
 * @param outcome - The answer.
 * @param errnos - The errnos allowed.
 * @param what - The operation, for the breach.
 */
function refused<T>(outcome: VfsOutcome<T>, errnos: ReadonlyArray<VfsErrno>, what: string): void {
  if (outcome.ok) breach(`${what} succeeded; expected ${errnos.join(' or ')}`);
  if (!errnos.includes(outcome.errno)) breach(`${what} failed with ${outcome.errno}; expected ${errnos.join(' or ')}`);
}

/**
 * The names a folder lists, sorted.
 *
 * @param mount - The mount.
 * @param folder - The folder.
 * @returns Its entries' names and types, as `name:type`.
 */
async function names_of(mount: VFSProvider, folder: string): Promise<string[]> {
  const listed: Result<VFSItem[]> = await mount.list(folder);
  if (!listed.ok) breach(`list ${folder} failed`);
  return listed.value.map((item: VFSItem): string => `${item.name}:${item.type}`).sort();
}

/** The seed every case starts from. */
const SEED: MemorySeed = {
  '/home/a.txt': 'alpha',
  '/home/docs/b.txt': 'beta',
  '/home/empty': null,
};

/** The contract, case by case. */
export const VFS_CONTRACT: ReadonlyArray<VfsContractCase> = [
  {
    name: 'lists a folder: its files and folders, each with its type',
    run: async (driver: VfsContractDriver): Promise<void> => {
      const mount: VFSProvider = await driver.mount_make(SEED);
      const names: string[] = await names_of(mount, '/home');
      for (const expected of ['a.txt:file', 'docs:dir', 'empty:dir']) {
        if (!names.includes(expected)) breach(`list /home lacks ${expected} (got ${names.join(', ')})`);
      }
    },
  },
  {
    name: 'reads a file whole, as text and as bytes; ENOENT for nothing there, EISDIR for a folder',
    run: async (driver: VfsContractDriver): Promise<void> => {
      const mount: VFSProvider = await driver.mount_make(SEED);
      if (mount.read) {
        if (done(await mount.read('/home/a.txt'), 'read /home/a.txt') !== 'alpha') breach('read /home/a.txt did not give its content');
        refused(await mount.read('/home/missing.txt'), ['ENOENT'], 'read of a missing file');
        refused(await mount.read('/home/docs'), ['EISDIR'], 'read of a folder');
      }
      if (mount.readBinary) {
        const bytes: Buffer = done(await mount.readBinary('/home/docs/b.txt'), 'readBinary /home/docs/b.txt');
        if (bytes.toString('utf-8') !== 'beta') breach('readBinary did not give the file\'s bytes');
        refused(await mount.readBinary('/home/missing.txt'), ['ENOENT'], 'readBinary of a missing file');
      }
    },
  },
  {
    name: 'writes a file whole: a new file, then its content replaced; ENOENT where the folder is missing',
    run: async (driver: VfsContractDriver): Promise<void> => {
      const mount: VFSProvider = await driver.mount_make(SEED);
      if (!mount.write) return;
      done(await mount.write('/home/new.txt', 'first'), 'write of a new file');
      done(await mount.write('/home/new.txt', 'second'), 'write over an existing file');
      if (mount.read && done(await mount.read('/home/new.txt'), 'read after write') !== 'second') {
        breach('a write did not replace the file\'s content');
      }
      done(await mount.write('/home/a.txt', 'replaced'), 'write over a seeded file');
      if (mount.read && done(await mount.read('/home/a.txt'), 'read after write') !== 'replaced') {
        breach('a write did not replace a seeded file\'s content');
      }
      refused(await mount.write('/home/nowhere/c.txt', 'x'), ['ENOENT'], 'write into a missing folder');
    },
  },
  {
    name: 'makes a folder; EEXIST for anything already there, ENOENT for a missing parent, ENOTDIR beneath a file',
    run: async (driver: VfsContractDriver): Promise<void> => {
      const mount: VFSProvider = await driver.mount_make(SEED);
      if (!mount.mkdir) return;
      done(await mount.mkdir('/home/made'), 'mkdir /home/made');
      if (!(await names_of(mount, '/home')).includes('made:dir')) breach('mkdir did not make the folder');
      refused(await mount.mkdir('/home/docs'), ['EEXIST'], 'mkdir of an existing folder');
      refused(await mount.mkdir('/home/nowhere/deeper'), ['ENOENT'], 'mkdir under a missing parent');
      refused(await mount.mkdir('/home/a.txt'), ['EEXIST'], 'mkdir where a file is');
      refused(await mount.mkdir('/home/a.txt/under'), ['ENOTDIR'], 'mkdir beneath a file');
    },
  },
  {
    name: 'makes a folder and its missing parents in one step where it offers to; EEXIST for anything already there, ENOTDIR beneath a file',
    run: async (driver: VfsContractDriver): Promise<void> => {
      const mount: VFSProvider = await driver.mount_make(SEED);
      if (!mount.mkdirTree) return;
      done(await mount.mkdirTree('/home/new/deeper/still'), 'mkdirTree under missing parents');
      if (!(await names_of(mount, '/home/new/deeper')).includes('still:dir')) breach('mkdirTree did not make the folder');
      refused(await mount.mkdirTree('/home/docs'), ['EEXIST'], 'mkdirTree of an existing folder');
      refused(await mount.mkdirTree('/home/a.txt'), ['EEXIST'], 'mkdirTree where a file is');
      refused(await mount.mkdirTree('/home/a.txt/under/deeper'), ['ENOTDIR'], 'mkdirTree beneath a file');
      if ((await names_of(mount, '/home')).includes('a.txt:dir')) breach('mkdirTree made a folder over a file');
    },
  },
  {
    name: 'removes an empty folder; ENOTEMPTY, ENOENT and ENOTDIR as a disk says them',
    run: async (driver: VfsContractDriver): Promise<void> => {
      const mount: VFSProvider = await driver.mount_make(SEED);
      if (!mount.rmdir) return;
      done(await mount.rmdir('/home/empty'), 'rmdir of an empty folder');
      if ((await names_of(mount, '/home')).includes('empty:dir')) breach('rmdir did not remove the folder');
      refused(await mount.rmdir('/home/docs'), ['ENOTEMPTY'], 'rmdir of a folder that holds something');
      refused(await mount.rmdir('/home/missing'), ['ENOENT'], 'rmdir of nothing there');
      refused(await mount.rmdir('/home/a.txt'), ['ENOTDIR'], 'rmdir of a file');
    },
  },
  {
    name: 'renames a file; ENOENT for nothing there; onto an existing file it replaces it or refuses with EEXIST',
    run: async (driver: VfsContractDriver): Promise<void> => {
      const mount: VFSProvider = await driver.mount_make(SEED);
      if (!mount.rename) return;
      done(await mount.rename('/home/a.txt', '/home/docs/a.txt'), 'rename into a folder');
      const home: string[] = await names_of(mount, '/home');
      const docs: string[] = await names_of(mount, '/home/docs');
      if (home.includes('a.txt:file') || !docs.includes('a.txt:file')) breach('rename did not move the file');
      if (mount.read && done(await mount.read('/home/docs/a.txt'), 'read after rename') !== 'alpha') breach('rename lost the file\'s content');
      refused(await mount.rename('/home/missing.txt', '/home/x.txt'), ['ENOENT'], 'rename of nothing there');
      const onto: VfsOutcome = await mount.rename('/home/docs/a.txt', '/home/docs/b.txt');
      if (!onto.ok) refused(onto, ['EEXIST'], 'rename onto an existing file');
    },
  },
  {
    name: 'removes a file; EISDIR for a folder, ENOENT for nothing there',
    run: async (driver: VfsContractDriver): Promise<void> => {
      const mount: VFSProvider = await driver.mount_make(SEED);
      if (!mount.rm) return;
      done(await mount.rm('/home/a.txt'), 'rm of a file');
      if ((await names_of(mount, '/home')).includes('a.txt:file')) breach('rm did not remove the file');
      refused(await mount.rm('/home/docs'), ['EISDIR'], 'rm of a folder');
      refused(await mount.rm('/home/missing.txt'), ['ENOENT'], 'rm of nothing there');
    },
  },
  {
    name: 'removes a folder whole where it offers to; ENOENT for nothing there',
    run: async (driver: VfsContractDriver): Promise<void> => {
      const mount: VFSProvider = await driver.mount_make(SEED);
      if (!mount.rmTree) return;
      done(await mount.rmTree('/home/docs'), 'rmTree of a folder with a file in it');
      if ((await names_of(mount, '/home')).includes('docs:dir')) breach('rmTree did not remove the folder');
      refused(await mount.rmTree('/home/missing'), ['ENOENT'], 'rmTree of nothing there');
    },
  },
];
