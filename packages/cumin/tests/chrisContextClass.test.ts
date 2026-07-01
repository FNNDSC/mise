// chrisContext imports ChRISPlugin -> chrisPlugins extends ChRISResourceGroup;
// factory-mock it to break the import cycle (same as chrisContext.test.ts).
jest.mock('../src/plugins/chrisPlugins', () => ({
  ChRISPlugin: jest.fn(),
  ChRISPluginGroup: jest.fn(),
  ChRISPluginInstanceGroup: jest.fn(),
  plugin_registerDirect: jest.fn(),
}));

import * as path from 'path';
import { IStorageProvider } from '../src/io/io';
import { ChrisContext, Context } from '../src/context/chrisContext';
import { config_init, connectionConfig } from '../src/config/config';

class FakeStorage implements IStorageProvider {
  files = new Map<string, string>();
  dirs = new Set<string>();
  async read(p: string): Promise<string | null> {
    return this.files.has(p) ? (this.files.get(p) as string) : null;
  }
  async readBinary(): Promise<ArrayBuffer | null> {
    return null;
  }
  async write(p: string, d: string): Promise<void> {
    this.files.set(p, d);
  }
  async remove(p: string): Promise<void> {
    this.files.delete(p);
  }
  async mkdir(p: string): Promise<void> {
    this.dirs.add(p);
  }
  async exists(p: string): Promise<boolean> {
    return this.files.has(p) || this.dirs.has(p);
  }
  async readdir(p: string): Promise<string[]> {
    const prefix = p.endsWith('/') ? p : p + '/';
    const names = new Set<string>();
    for (const key of [...this.files.keys(), ...this.dirs]) {
      if (key.startsWith(prefix)) {
        names.add(key.slice(prefix.length).split('/')[0]);
      }
    }
    return [...names];
  }
  async isDirectory(p: string): Promise<boolean> {
    return this.dirs.has(p);
  }
  join(...parts: string[]): string {
    return path.join(...parts);
  }
  basename(p: string): string {
    return path.basename(p);
  }
}

const XDG = '/tmp/cumin-ctx-test';
const CONFIG_DIR = path.join(XDG, '@fnndsc/cumin');

let store: FakeStorage;
let ctx: ChrisContext;

beforeAll(async () => {
  process.env.XDG_CONFIG_HOME = XDG;
  store = new FakeStorage();
  store.dirs.add(CONFIG_DIR);
  await config_init(store);
  ctx = new ChrisContext();
});

describe('ChrisContext — delegating getters/setters', () => {
  it('round-trips folder / feed / plugin / pacsserver context', async () => {
    expect(await ctx.ChRISfolder_set('/home/chris/uploads')).toBe(true);
    expect(await ctx.ChRISfolder_get()).toBe('/home/chris/uploads');
    expect(await ctx.folderpath_get()).toBe('/home/chris/uploads');

    expect(await ctx.ChRISfeed_set('42')).toBe(true);
    expect(await ctx.ChRISfeed_get()).toBe('42');

    expect(await ctx.ChRISplugin_set('7')).toBe(true);
    expect(await ctx.ChRISplugin_get()).toBe('7');

    expect(await ctx.PACSserver_set('MYPACS')).toBe(true);
    expect(await ctx.PACSserver_get()).toBe('MYPACS');
  });

  it('exposes the mutable single/full context objects', () => {
    expect(ctx.singleContext).toHaveProperty('URL');
    expect(ctx.fullContext_get()).toHaveProperty('users');
  });

  it('currentContext_update snapshots all sub-contexts', async () => {
    await ctx.ChRISfolder_set('/x');
    await ctx.ChRISfeed_set('9');
    const snap = await ctx.currentContext_update();
    expect(snap.folder).toBe('/x');
    expect(snap.feed).toBe('9');
  });
});

describe('ChrisContext — current_get switch', () => {
  beforeAll(async () => {
    await ctx.ChRISfolder_set('/home/chris');
    await ctx.ChRISfeed_set('100');
    await ctx.ChRISplugin_set('200');
    await ctx.PACSserver_set('PACS1');
  });

  it.each([
    [Context.ChRISfolder, '/home/chris'],
    [Context.ChRISfeed, '100'],
    [Context.ChRISplugin, '200'],
    [Context.PACSserver, 'PACS1'],
  ])('returns the value for %s', async (context, expected) => {
    expect(await ctx.current_get(context)).toBe(expected);
  });

  it('returns ChRISuser and ChRISURL loaded from storage', async () => {
    connectionConfig.chrisURLfilepath = path.join(CONFIG_DIR, 'chrisurl.txt');
    store.files.set(connectionConfig.userFilepath, 'ada');
    store.files.set(connectionConfig.chrisURLfilepath, 'http://z/api/');
    expect(await ctx.current_get(Context.ChRISuser)).toBe('ada');
    expect(await ctx.current_get(Context.ChRISURL)).toBe('http://z/api/');
  });

  it('returns null for an unrecognised context', async () => {
    expect(await ctx.current_get(999 as unknown as Context)).toBeNull();
  });
});

describe('ChrisContext — current_set switch', () => {
  it('sets folder context and invalidates the listing cache', async () => {
    expect(await ctx.current_set(Context.ChRISfolder, '/new/cwd')).toBe(true);
    expect(await ctx.ChRISfolder_get()).toBe('/new/cwd');
  });

  it('sets feed / plugin / pacsserver context', async () => {
    expect(await ctx.current_set(Context.ChRISfeed, '55')).toBe(true);
    expect(await ctx.current_set(Context.ChRISplugin, '66')).toBe(true);
    expect(await ctx.current_set(Context.PACSserver, 'PX')).toBe(true);
    expect(await ctx.ChRISfeed_get()).toBe('55');
  });

  it('saves user context when the user folder exists (else fails)', async () => {
    expect(await ctx.current_set(Context.ChRISuser, 'nouser')).toBe(false);

    store.dirs.add(path.join(CONFIG_DIR, 'chris'));
    expect(await ctx.current_set(Context.ChRISuser, 'chris')).toBe(true);
  });

  it('saves URL context when the URL folder exists', async () => {
    // context_set on the user wires chrisURLfilepath under the user dir
    await ctx.current_set(Context.ChRISuser, 'chris');
    const urlDir = path.join(
      path.dirname(connectionConfig.chrisURLfilepath),
      connectionConfig.uri_toDir('http://c/api/')
    );
    store.dirs.add(urlDir);
    expect(await ctx.current_set(Context.ChRISURL, 'http://c/api/')).toBe(true);
  });
});

describe('ChrisContext — init()', () => {
  it('returns early when the config dir does not exist', async () => {
    store.dirs.delete(CONFIG_DIR);
    const c = new ChrisContext();
    await expect(c.init()).resolves.toBeUndefined();
    expect(c.fullContext_get().users).toEqual({});
    store.dirs.add(CONFIG_DIR); // restore
  });

  it('builds the full context tree from stored users/urls', async () => {
    const user = 'zoe';
    const url = 'http://cube.local/api/v1/';
    const userDir = path.join(CONFIG_DIR, user);
    const urlDirName = connectionConfig.uri_toDir(url);
    const urlDir = path.join(userDir, urlDirName);

    store.dirs.add(userDir);
    store.dirs.add(urlDir);
    store.files.set(path.join(userDir, 'chrisurl.txt'), url);
    store.files.set(path.join(urlDir, 'cwd.txt'), '/home/zoe');
    store.files.set(path.join(urlDir, 'feed.txt'), '3');

    const c = new ChrisContext();
    await c.init();

    const full = c.fullContext_get();
    expect(full.users[user]).toBeDefined();
    expect(full.users[user].currentURL).toBe(url);
    expect(full.users[user].urls[url].folder).toBe('/home/zoe');
    expect(full.users[user].urls[url].feed).toBe('3');
  });
});
