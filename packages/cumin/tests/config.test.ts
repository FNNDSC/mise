import * as path from 'path';
import { IStorageProvider } from '../src/io/io';
import {
  ConnectionConfig,
  SessionConfig,
  config_init,
  connectionConfig,
  sessionConfig,
} from '../src/config/config';
import { errorStack } from '../src/error/errorStack';

/** Minimal in-memory IStorageProvider for deterministic, hermetic config tests. */
class FakeStorage implements IStorageProvider {
  files = new Map<string, string>();
  dirs = new Set<string>();

  async read(p: string): Promise<string | null> {
    return this.files.has(p) ? (this.files.get(p) as string) : null;
  }
  async readBinary(): Promise<ArrayBuffer | null> {
    return null;
  }
  async write(p: string, data: string): Promise<void> {
    this.files.set(p, data);
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
  async readdir(): Promise<string[]> {
    return [];
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

const XDG = '/tmp/cumin-config-test';
const CONFIG_DIR = path.join(XDG, '@fnndsc/cumin');

let store: FakeStorage;
let conn: ConnectionConfig;

beforeAll(async () => {
  process.env.XDG_CONFIG_HOME = XDG;
  store = new FakeStorage();
  // First construction wins (singleton). Provider is empty -> init() takes the
  // "no last user" early-return path.
  conn = await ConnectionConfig.instance_get(store);
});

beforeEach(() => {
  errorStack.stack_clear();
});

describe('ConnectionConfig — construction', () => {
  it('derives configDir from XDG_CONFIG_HOME', () => {
    expect(conn.configDir).toBe(CONFIG_DIR);
    expect(conn.userFilepath).toBe(path.join(CONFIG_DIR, 'lastUser.txt'));
  });

  it('creates the config dir on init', () => {
    expect(store.dirs.has(CONFIG_DIR)).toBe(true);
  });

  it('is a singleton', async () => {
    expect(await ConnectionConfig.instance_get(store)).toBe(conn);
  });
});

describe('ConnectionConfig — uri_toDir / dir_toUri round trip', () => {
  it('encodes a URL into a directory-safe string', () => {
    expect(conn.uri_toDir('http://localhost:8000/api/v1/')).toBe(
      'http___localhost===8000_api_v1_'
    );
  });

  it('round-trips a simple URL', () => {
    const uri = 'http://example.com/api';
    expect(conn.dir_toUri(conn.uri_toDir(uri))).toBe(uri);
  });

  it('throws on a directory name with no protocol separator', () => {
    expect(() => conn.dir_toUri('not-a-valid-dir')).toThrow('Invalid directory name');
  });
});

describe('ConnectionConfig — init() branches', () => {
  it('populates context dirs when a last user and URL are present', async () => {
    const user = 'chris';
    const url = 'http://localhost:8000/api/v1/';
    const userDir = path.join(CONFIG_DIR, user);
    const urlDir = path.join(userDir, conn.uri_toDir(url));

    store.files.set(conn.userFilepath, user);
    store.files.set(path.join(userDir, 'chrisurl.txt'), url);

    await conn.init();

    expect(conn.userContextDir).toBe(userDir);
    expect(conn.userChRISContextDir).toBe(urlDir);
    expect(conn.tokenFilepath).toBe(path.join(urlDir, conn.tokenFile));
  });

  it('stops at the user dir when a last user exists but no URL', async () => {
    store.files.set(conn.userFilepath, 'bob');
    store.files.delete(path.join(CONFIG_DIR, 'bob', 'chrisurl.txt'));

    await conn.init();

    expect(conn.userContextDir).toBe(path.join(CONFIG_DIR, 'bob'));
    // chrisURL absent -> userChRISContextDir left from prior; assert URL path unset here
    expect(conn.chrisURLfilepath).toBe(path.join(CONFIG_DIR, 'bob', 'chrisurl.txt'));
  });
});

describe('ConnectionConfig — save/load', () => {
  it('lastUser_save writes when the user folder exists', async () => {
    const user = 'alice';
    store.dirs.add(path.join(path.dirname(conn.userFilepath), user));

    expect(await conn.lastUser_save(user)).toBe(true);
    expect(await conn.lastUser_load()).toBe(user);
  });

  it('lastUser_save fails and records an error when the folder is absent', async () => {
    const ok = await conn.lastUser_save('ghost');
    expect(ok).toBe(false);
    expect(errorStack.stack_search('has not logged in').length).toBeGreaterThan(0);
  });

  it('chrisURL_save writes when the URL folder exists', async () => {
    const url = 'http://cube.local/api/v1/';
    conn.chrisURLfilepath = path.join(CONFIG_DIR, 'alice', 'chrisurl.txt');
    store.dirs.add(path.join(path.dirname(conn.chrisURLfilepath), conn.uri_toDir(url)));

    expect(await conn.chrisURL_save(url)).toBe(true);
    expect(await conn.chrisURL_load()).toBe(url);
  });

  it('chrisURL_save fails when the URL folder is absent', async () => {
    conn.chrisURLfilepath = path.join(CONFIG_DIR, 'alice', 'chrisurl.txt');
    expect(await conn.chrisURL_save('http://never.seen/api/')).toBe(false);
  });

  it('context_set persists the user and creates its dir', async () => {
    const user = 'dave';
    store.dirs.add(path.join(path.dirname(conn.userFilepath), user));

    await conn.context_set(user);

    expect(await conn.lastUser_load()).toBe(user);
    expect(conn.userContextDir).toBe(path.join(CONFIG_DIR, user));
    expect(store.dirs.has(path.join(CONFIG_DIR, user))).toBe(true);
  });

  it('context_set with a URL creates the URL context dir', async () => {
    const user = 'erin';
    const url = 'http://h.local/api/v1/';
    store.dirs.add(path.join(path.dirname(conn.userFilepath), user));

    await conn.context_set(user, url);

    const urlDir = path.join(CONFIG_DIR, user, conn.uri_toDir(url));
    expect(conn.userChRISContextDir).toBe(urlDir);
    expect(store.dirs.has(urlDir)).toBe(true);
  });
});

describe('SessionConfig', () => {
  let session: SessionConfig;

  beforeAll(async () => {
    session = await SessionConfig.instance_get(store);
  });

  it('exposes its connection config', () => {
    expect(session.connection).toBeInstanceOf(ConnectionConfig);
  });

  it('is a singleton', async () => {
    expect(await SessionConfig.instance_get(store)).toBe(session);
  });

  it.each([
    ['pathContext', 'cwdFilename', '/home/chris/uploads'],
    ['feedContext', 'feedFilename', '42'],
    ['pluginContext', 'pluginFilename', '7'],
    ['pacsserverContext', 'pacsserverFilename', 'MYPACS'],
  ])('round-trips %s', async (ctx, _field, value) => {
    const set = (session as unknown as Record<string, (v: string) => Promise<boolean>>)[
      `${ctx}_set`
    ];
    const get = (session as unknown as Record<string, () => Promise<string | null>>)[
      `${ctx}_get`
    ];
    expect(await set.call(session, value)).toBe(true);
    expect(await get.call(session)).toBe(value);
  });
});

describe('config_init', () => {
  it('populates the exported globals', async () => {
    await config_init(store);
    expect(connectionConfig).toBeInstanceOf(ConnectionConfig);
    expect(sessionConfig).toBeInstanceOf(SessionConfig);
  });
});
