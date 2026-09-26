/**
 * Unit tests for kept layouts: where a surface laid the space out, held for
 * the session and kept beside the index, so a second surface draws at once;
 * a name or a set of places that is not a layout's is refused, and a file
 * from another identity or a damaged one is none.
 */
import { mkdtemp, readFile, writeFile, stat } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { procCheckpointDir_get, procLayout_get, procLayout_set, procLayoutHome_set, procLayoutName_check, procLayoutPositions_check, PROC_LAYOUT_NODES_MAX } from '../src/cache/procCheckpoint';

const identity: string = 'chris@http://cube.test/api/v1/';
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'layout-'));
  procLayoutHome_set({ identity, root });
});
afterAll(() => procLayoutHome_set(null));

describe('kept layouts', () => {
  it('keeps a layout for the session and beside the index, private to the user', async () => {
    await procLayout_set('galaxy', { 'feed:1:0': [1, 2, 3], 'shape:x': [0, 0, 0] });
    expect((await procLayout_get('galaxy'))?.positions['feed:1:0']).toEqual([1, 2, 3]);
    const path = join(procCheckpointDir_get(identity, root), 'layout-galaxy.json');
    expect(JSON.parse(await readFile(path, 'utf8')).identity).toBe(identity);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('reads a kept layout back in a new session', async () => {
    await procLayout_set('accretion', { a: [4, 5, 6] });
    procLayoutHome_set({ identity, root });
    expect((await procLayout_get('accretion'))?.positions).toEqual({ a: [4, 5, 6] });
    expect(await procLayout_get('spokes')).toBeNull();
  });

  it('takes a file from another identity, a damaged one, or a bad name as none', async () => {
    await procLayout_set('clumps', { a: [1, 1, 1] });
    const path = join(procCheckpointDir_get(identity, root), 'layout-clumps.json');
    const file = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify({ ...file, identity: 'other@x' }));
    procLayoutHome_set({ identity, root });
    expect(await procLayout_get('clumps')).toBeNull();
    await writeFile(path, '{not json');
    expect(await procLayout_get('clumps')).toBeNull();
    expect(await procLayout_get('../etc')).toBeNull();
  });

  it('refuses a name or a set of places that is not a layout\'s', async () => {
    expect(procLayoutName_check('constellations')).toBe(true);
    expect(procLayoutName_check('Galaxy')).toBe(false);
    expect(procLayoutName_check('a/b')).toBe(false);
    expect(procLayoutPositions_check({ a: [1, 2, Number.NaN] })).toBe(false);
    expect(procLayoutPositions_check({ a: [1, 2] })).toBe(false);
    // A shape's hub is named by its whole pipeline: long, and still a node.
    expect(procLayoutPositions_check({ [`shape:r:${'pl-dircopy>0:'.repeat(40)}`]: [0, 0, 0] })).toBe(true);
    expect(procLayoutPositions_check({ ['x'.repeat(5000)]: [0, 0, 0] })).toBe(false);
    expect(procLayoutPositions_check([[1, 2, 3]])).toBe(false);
    expect(PROC_LAYOUT_NODES_MAX).toBe(250_000);
    await expect(procLayout_set('BAD', { a: [1, 2, 3] })).rejects.toThrow('not a layout name');
    await expect(procLayout_set('galaxy', { a: 'x' } as never)).rejects.toThrow('not a set of places');
  });

  it('holds a layout in memory when the index has no home', async () => {
    procLayoutHome_set(null);
    await procLayout_set('galaxy', { a: [7, 8, 9] });
    expect((await procLayout_get('galaxy'))?.positions).toEqual({ a: [7, 8, 9] });
  });
});
