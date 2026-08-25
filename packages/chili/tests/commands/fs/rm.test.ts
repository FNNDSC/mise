/**
 * @file Tests for the rm command core: type resolution, POSIX -f semantics
 * on missing operands, the recursive guard, and parent-anchored deletion.
 */
import { files_rm } from '../../../src/commands/fs/rm';
import * as salsa from '@fnndsc/salsa';

jest.mock('@fnndsc/salsa');
jest.mock('../../../src/utils/cli', () => ({
  ...jest.requireActual('../../../src/utils/cli'),
  path_resolveChrisFs: jest.fn(async (p: string) => p),
}));

const mockListAll: jest.Mock = salsa.files_listAll as unknown as jest.Mock;
const mockDelete: jest.Mock = salsa.files_delete as unknown as jest.Mock;

/** Makes files_listAll answer dirs/files/links pages from one row set. */
function listing_set(rows: { dirs?: object[]; files?: object[]; links?: object[] }): void {
  mockListAll.mockImplementation(async (_opts: unknown, asset: string) => ({
    tableData: (rows as Record<string, object[] | undefined>)[asset] ?? [],
  }));
}

describe('files_rm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listing_set({});
  });

  it('treats a missing operand as an error without force', async () => {
    const result = await files_rm('/home/alice/absent.txt', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('No such file or directory');
  });

  it('treats a missing operand as success with force (POSIX rm -f)', async () => {
    const result = await files_rm('/home/alice/absent.txt', { force: true });
    expect(result.success).toBe(true);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('refuses a directory without the recursive flag', async () => {
    listing_set({ dirs: [{ fname: 'scratch', id: 7 }] });
    const result = await files_rm('/home/alice/scratch', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('is a directory');
  });

  it('deletes a file anchored at its parent folder', async () => {
    listing_set({ files: [{ fname: 'hello.txt', id: 9 }] });
    mockDelete.mockResolvedValue(true);
    const result = await files_rm('/home/alice/scratch/hello.txt', {});
    expect(result.success).toBe(true);
    // The delete must carry the target's parent, not rely on the ambient cwd.
    expect(mockDelete).toHaveBeenCalledWith(9, 'files', '/home/alice/scratch');
  });

  it('deletes a directory recursively through the dirs asset', async () => {
    listing_set({ dirs: [{ fname: 'scratch', id: 7 }] });
    mockDelete.mockResolvedValue(true);
    const result = await files_rm('/home/alice/scratch', { recursive: true });
    expect(result.success).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith(7, 'dirs', '/home/alice');
  });
});
