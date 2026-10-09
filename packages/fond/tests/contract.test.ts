import { MemoryVfsProvider } from '../src/vfs/memory';
import { VFS_CONTRACT, type VfsContractDriver } from '../src/vfs/contract';
import { vfsRefusal_text, errno_words, vfs_fail } from '../src/vfs/outcome';

const memoryDriver: VfsContractDriver = {
  mount_make: async (seed) => new MemoryVfsProvider('', seed),
};

describe('the filesystem contract, held by the memory mount', () => {
  for (const contractCase of VFS_CONTRACT) {
    it(contractCase.name, async () => {
      await expect(contractCase.run(memoryDriver)).resolves.toBeUndefined();
    });
  }
});

describe('the contract catches a mount that breaks it', () => {
  it('fails a mount whose rm answers the wrong errno', async () => {
    const lying: VfsContractDriver = {
      mount_make: async (seed) => {
        const mount = new MemoryVfsProvider('', seed);
        mount.rm = async () => vfs_fail('EIO');
        return mount;
      },
    };
    const rmCase = VFS_CONTRACT.find((c) => c.name.startsWith('removes a file'));
    await expect(rmCase!.run(lying)).rejects.toThrow('contract breach');
  });
});

describe('what an operator reads', () => {
  it('words each operation\'s refusal as the shell has always said it', () => {
    expect(vfsRefusal_text('mkdir', { errno: 'EROFS' }, '/x')).toBe("mkdir: cannot create directory '/x': Read-only file system");
    expect(vfsRefusal_text('rmdir', { errno: 'EROFS' }, '/x')).toBe("rmdir: failed to remove '/x': Read-only file system");
    expect(vfsRefusal_text('rename', { errno: 'EXDEV' }, '/a', '/b')).toBe("mv: cannot move '/a' to '/b': Invalid cross-device link");
    expect(vfsRefusal_text('rename', { errno: 'EROFS' }, '/a', '/b')).toBe("mv: cannot move '/a': Read-only file system");
    expect(vfsRefusal_text('read', { errno: 'EROFS' }, '/x')).toBe('File read not supported for path: /x');
    expect(vfsRefusal_text('readBinary', { errno: 'EROFS' }, '/x')).toBe('Binary file read not supported for path: /x');
    expect(vfsRefusal_text('write', { errno: 'EROFS' }, '/x')).toBe('File write not supported for path: /x');
    expect(vfsRefusal_text('read', { errno: 'ENOENT' }, '/x')).toBe('/x: No such file or directory');
    expect(vfsRefusal_text('rm', { errno: 'EISDIR' }, '/x')).toBe("rm: cannot remove '/x': Is a directory");
    expect(vfsRefusal_text('cp', { errno: 'ENOENT' }, '/a', '/b')).toBe("cp: cannot copy '/a' to '/b': No such file or directory");
  });

  it('reads the mount\'s own reason instead when it gave one', () => {
    expect(vfsRefusal_text('rename', { errno: 'EEXIST', reason: 'mise cannot overwrite a file' }, '/a', '/b')).toBe('mise cannot overwrite a file');
    expect(errno_words('ENOTEMPTY')).toBe('Directory not empty');
  });
});
