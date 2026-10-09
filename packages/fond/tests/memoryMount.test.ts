import { errorStack } from '../src/errorStack';
import { MemoryVfsProvider } from '../src/vfs/memory';
import { VFS_CONTRACT, type VfsContractDriver } from '../src/vfs/contract';
import { vfs_ok, vfs_fail } from '../src/vfs/outcome';
import { Ok, Err } from '../src/result';
import type { VFSProvider } from '../src/vfs/provider';

beforeEach(() => errorStack.stack_clear());

describe('the memory mount, beyond the contract', () => {
  it('refuses to list nothing there, or a file', async () => {
    const mount = new MemoryVfsProvider('', { '/home/a.txt': 'alpha' });
    expect((await mount.list('/home/missing')).ok).toBe(false);
    expect(errorStack.stack_pop()?.message).toContain('Cannot list /home/missing: No such file or directory');
    expect((await mount.list('/home/a.txt')).ok).toBe(false);
    expect(errorStack.stack_pop()?.message).toContain('Cannot list /home/a.txt: Not a directory');
  });

  it('renames as a disk does: a folder onto a file or a full folder refused, the root never moved', async () => {
    const mount = new MemoryVfsProvider('', { '/home/a.txt': 'alpha', '/home/d': null, '/home/full/x': 'x', '/home/e': null });
    expect(await mount.rename('/home/d', '/home/a.txt')).toEqual(vfs_fail('ENOTDIR'));
    expect(await mount.rename('/home/a.txt', '/home/d')).toEqual(vfs_fail('EISDIR'));
    expect(await mount.rename('/home/e', '/home/full')).toEqual(vfs_fail('ENOTEMPTY'));
    expect(await mount.rename('/home/e', '/home/nowhere/e')).toEqual(vfs_fail('ENOENT'));
    expect(await mount.rename('/', '/x')).toEqual(vfs_fail('EPERM'));
    expect(await mount.rename('/home/full', '/home/moved')).toEqual(vfs_ok(true));
    expect((await mount.read('/home/moved/x'))).toEqual(vfs_ok('x'));
  });

  it('copies a file, and a folder only when asked to recurse, leaving the source as it was', async () => {
    const mount = new MemoryVfsProvider('', { '/home/a.txt': 'alpha', '/home/docs/b.txt': 'beta' });
    expect(await mount.cp('/home/a.txt', '/home/c.txt', {})).toEqual(vfs_ok(true));
    expect(await mount.read('/home/c.txt')).toEqual(vfs_ok('alpha'));
    expect(await mount.cp('/home/docs', '/home/copy', {})).toEqual(vfs_fail('EISDIR'));
    expect(await mount.cp('/home/docs', '/home/copy', { recursive: true })).toEqual(vfs_ok(true));
    expect(await mount.read('/home/copy/b.txt')).toEqual(vfs_ok('beta'));
    expect(await mount.cp('/home/missing', '/home/x', {})).toEqual(vfs_fail('ENOENT'));
    expect(await mount.cp('/home/a.txt', '/home/nowhere/a.txt', {})).toEqual(vfs_fail('ENOENT'));
    expect(await mount.cp('/home/a.txt', '/home/a.txt/inside', {})).toEqual(vfs_fail('ENOTDIR'));
  });

  it('never removes its root, and removes a folder whole', async () => {
    const mount = new MemoryVfsProvider('', { '/home/docs/b.txt': 'beta', '/home/a.txt': 'alpha' });
    expect(await mount.rmTree('/')).toEqual(vfs_fail('EPERM'));
    expect(await mount.rmTree('/home/a.txt')).toEqual(vfs_fail('ENOTDIR'));
    expect(await mount.rmTree('/home/docs')).toEqual(vfs_ok(true));
    expect(await mount.read('/home/docs/b.txt')).toEqual(vfs_fail('ENOENT'));
  });

  it('holds a prefix of its own as its root', async () => {
    const mount = new MemoryVfsProvider('/scratch', { '/scratch/a.txt': 'alpha' });
    expect(mount.prefix).toBe('/scratch');
    const listed = await mount.list('/scratch/');
    expect(listed.ok && listed.value.map((item) => item.name)).toEqual(['a.txt']);
  });
});

/**
 * A mount that answers every operation the same way, to show the contract
 * fails it: a contract a broken mount can pass proves nothing.
 */
function mount_answering(succeeds: boolean): VfsContractDriver {
  return {
    mount_make: async (): Promise<VFSProvider> => ({
      prefix: '',
      list: async () => (succeeds ? Ok([]) : Err()),
      read: async () => (succeeds ? vfs_ok('') : vfs_fail('EIO')),
      readBinary: async () => (succeeds ? vfs_ok(Buffer.alloc(0)) : vfs_fail('EIO')),
      write: async () => (succeeds ? vfs_ok(true) : vfs_fail('EIO', 'the store failed')),
      mkdir: async () => (succeeds ? vfs_ok(true) : vfs_fail('EIO')),
      rmdir: async () => (succeeds ? vfs_ok(true) : vfs_fail('EIO')),
      rename: async () => (succeeds ? vfs_ok(true) : vfs_fail('EIO')),
      rm: async () => (succeeds ? vfs_ok(true) : vfs_fail('EIO')),
      rmTree: async () => (succeeds ? vfs_ok(true) : vfs_fail('EIO')),
    }) as unknown as VFSProvider,
  };
}

describe('the contract fails a mount that answers without looking', () => {
  for (const contractCase of VFS_CONTRACT) {
    it(`always failing: ${contractCase.name}`, async () => {
      await expect(contractCase.run(mount_answering(false))).rejects.toThrow('contract breach');
    });
    it(`always succeeding: ${contractCase.name}`, async () => {
      await expect(contractCase.run(mount_answering(true))).rejects.toThrow('contract breach');
    });
  }

  it('skips what a mount does not offer: a read-only mount is a mount', async () => {
    const readOnly: VfsContractDriver = { mount_make: async () => ({ prefix: '', list: async () => Ok([]) }) as unknown as VFSProvider };
    const skipped = VFS_CONTRACT.filter((c) => !c.name.startsWith('lists'));
    for (const contractCase of skipped) await expect(contractCase.run(readOnly)).resolves.toBeUndefined();
  });
});
