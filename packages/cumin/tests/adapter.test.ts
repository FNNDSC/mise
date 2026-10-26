/**
 * @file Tests for the chrisapi adapter seam.
 *
 * chrisapi itself is mocked: these tests verify that the adapter routes
 * lifecycle calls, extracts payloads, guards resource kinds, and dispatches
 * untyped methods exactly as the domain modules rely on.
 */

const mockGetAuthToken = jest.fn();
const mockRetrieveDelete = jest.fn();
const clientConstructorArgs: Array<[string, { token: string }]> = [];
const retrieveConstructorArgs: Array<[string, Record<string, unknown>]> = [];
const mockRequestGet = jest.fn();
const requestConstructorArgs: Array<[Record<string, unknown>, string, number]> = [];

jest.mock('@fnndsc/chrisapi', () => {
  class MockClient {
    static getAuthToken = mockGetAuthToken;
    url: string;
    auth: { token: string };
    constructor(url: string, auth: { token: string }) {
      this.url = url;
      this.auth = auth;
      clientConstructorArgs.push([url, auth]);
    }
  }
  class MockListResource {}
  class MockPACSRetrieve {
    delete = mockRetrieveDelete;
    constructor(url: string, auth: Record<string, unknown>) {
      retrieveConstructorArgs.push([url, auth]);
    }
  }
  class MockRequest {
    get = mockRequestGet;
    constructor(auth: Record<string, unknown>, contentType: string, timeout: number) {
      requestConstructorArgs.push([auth, contentType, timeout]);
    }
  }
  return {
    __esModule: true,
    default: MockClient,
    ListResource: MockListResource,
    PACSRetrieve: MockPACSRetrieve,
    Request: MockRequest,
  };
});

import { ListResource } from '@fnndsc/chrisapi';
import {
  Client,
  ClientAuth,
  authToken_get,
  client_create,
  client_authGet,
  client_adminUrlEnsure,
  resource_isList,
  listData_get,
  itemData_get,
  items_get,
  collectionItems_get,
  resource_call,
  pacsRetrieve_deleteByUrl,
  rootLinks_share,
  token_verify,
  FEED_LIST_TIMEOUT_MS,
  TOKEN_CHECK_TIMEOUT_MS,
} from '../src/chrisapi/adapter';

beforeEach(() => {
  jest.clearAllMocks();
  clientConstructorArgs.length = 0;
  retrieveConstructorArgs.length = 0;
  requestConstructorArgs.length = 0;
});

describe('lifecycle', () => {
  it('authToken_get delegates to Client.getAuthToken', async () => {
    mockGetAuthToken.mockResolvedValue('TOKEN');
    const token: string = await authToken_get('https://cube/api/v1/auth-token/', 'chris', 'pw');
    expect(token).toBe('TOKEN');
    expect(mockGetAuthToken).toHaveBeenCalledWith('https://cube/api/v1/auth-token/', 'chris', 'pw');
  });

  it('client_create constructs a Client with url and token', () => {
    const client: Client = client_create('https://cube/api/v1/', 'TOKEN');
    expect(client).toBeInstanceOf(Client);
    expect(clientConstructorArgs).toEqual([['https://cube/api/v1/', { token: 'TOKEN' }]]);
  });

  it('client_authGet reads the runtime auth slice', () => {
    const client: Client = client_create('https://cube/api/v1/', 'TOKEN');
    const auth: ClientAuth = client_authGet(client);
    expect(auth).toEqual({ token: 'TOKEN' });
  });
});

describe('client_adminUrlEnsure', () => {
  it('returns an already-present admin URL without calling setUrls', async () => {
    const setUrls = jest.fn();
    const client = { adminUrl: 'https://cube/chris-admin/api/v1/', setUrls } as unknown as Client;
    expect(await client_adminUrlEnsure(client)).toBe('https://cube/chris-admin/api/v1/');
    expect(setUrls).not.toHaveBeenCalled();
  });

  it('populates URLs when the admin URL is missing', async () => {
    const client = {
      adminUrl: undefined as string | undefined,
      setUrls: jest.fn(async function (this: { adminUrl?: string }) {
        this.adminUrl = 'https://cube/chris-admin/api/v1/';
      }),
    };
    expect(await client_adminUrlEnsure(client as unknown as Client)).toBe('https://cube/chris-admin/api/v1/');
    expect(client.setUrls).toHaveBeenCalled();
  });

  it('returns null when setUrls fails to produce an admin URL', async () => {
    const client = { setUrls: jest.fn(async () => { throw new Error('403'); }) };
    expect(await client_adminUrlEnsure(client as unknown as Client)).toBeNull();
  });

  it('returns null when the client has no setUrls at all', async () => {
    expect(await client_adminUrlEnsure({} as unknown as Client)).toBeNull();
  });
});

describe('resource_isList', () => {
  it('accepts a ListResource instance', () => {
    const list: ListResource = new (ListResource as unknown as new () => ListResource)();
    expect(resource_isList(list)).toBe(true);
  });

  it('rejects plain objects and null', () => {
    expect(resource_isList({})).toBe(false);
    expect(resource_isList(null)).toBe(false);
  });
});

interface Row { id: number; name: string }

describe('payload extractors', () => {
  it('listData_get returns the data array typed', () => {
    const rows: Row[] = listData_get<Row>({ data: [{ id: 1, name: 'a' }] });
    expect(rows).toEqual([{ id: 1, name: 'a' }]);
  });

  it('listData_get returns [] for missing or non-array data', () => {
    expect(listData_get<Row>({ data: undefined })).toEqual([]);
    expect(listData_get<Row>({ data: { id: 1 } })).toEqual([]);
    expect(listData_get<Row>(null)).toEqual([]);
  });

  it('itemData_get returns the data object typed', () => {
    expect(itemData_get<Row>({ data: { id: 2, name: 'b' } })).toEqual({ id: 2, name: 'b' });
  });

  it('itemData_get returns null for missing data or item', () => {
    expect(itemData_get<Row>({})).toBeNull();
    expect(itemData_get<Row>(null)).toBeNull();
  });

  it('items_get returns getItems() results typed', () => {
    const list = { getItems: (): Row[] => [{ id: 3, name: 'c' }] };
    expect(items_get<Row>(list)).toEqual([{ id: 3, name: 'c' }]);
  });

  it('items_get returns [] when getItems yields null or the list is absent', () => {
    expect(items_get<Row>({ getItems: (): null => null })).toEqual([]);
    expect(items_get<Row>(null)).toEqual([]);
  });

  it('collectionItems_get returns embedded collection items typed', () => {
    const resource = { collection: { items: [{ id: 4, name: 'd' }] } };
    expect(collectionItems_get<Row>(resource)).toEqual([{ id: 4, name: 'd' }]);
  });

  it('collectionItems_get returns [] when the collection is missing', () => {
    expect(collectionItems_get<Row>({})).toEqual([]);
    expect(collectionItems_get<Row>({ collection: {} })).toEqual([]);
    expect(collectionItems_get<Row>(null)).toEqual([]);
  });
});

describe('resource_call', () => {
  it('dispatches an untyped method with arguments and this-binding', async () => {
    const obj = {
      base: 10,
      shift: async function (this: { base: number }, n: number): Promise<number> {
        return this.base + n;
      },
    };
    expect(await resource_call<number>(obj, 'shift', 5)).toBe(15);
  });

  it('throws a descriptive error for a missing method', async () => {
    await expect(resource_call<void>({}, 'nope')).rejects.toThrow("no method 'nope'");
  });
});

describe('pacsRetrieve_deleteByUrl', () => {
  it('constructs the retrieve from URL and auth, then deletes it', async () => {
    const auth: ClientAuth = { token: 'TOKEN', cubeUrl: 'https://cube/' };
    await pacsRetrieve_deleteByUrl('https://cube/api/v1/pacsfiles/retrieves/7/', auth);
    expect(retrieveConstructorArgs).toEqual([['https://cube/api/v1/pacsfiles/retrieves/7/', auth]]);
    expect(mockRetrieveDelete).toHaveBeenCalled();
  });
});

describe('rootLinks_share', () => {
  const client_with = (setUrls: jest.Mock): { setUrls: (timeout?: number) => Promise<unknown> } =>
    rootLinks_share({ setUrls } as unknown as Client) as unknown as { setUrls: (timeout?: number) => Promise<unknown> };

  it('reads the root once for callers that arrive together, at the feed list timeout', async () => {
    const setUrls: jest.Mock = jest.fn(async () => 'root');
    const client = client_with(setUrls);
    await Promise.all([client.setUrls(), client.setUrls(), client.setUrls(30000)]);
    expect(setUrls).toHaveBeenCalledTimes(1);
    expect(setUrls).toHaveBeenCalledWith(FEED_LIST_TIMEOUT_MS);
    await client.setUrls();
    expect(setUrls).toHaveBeenCalledTimes(1);
  });

  it('keeps no failed read: the next caller asks again', async () => {
    const setUrls: jest.Mock = jest.fn()
      .mockRejectedValueOnce(new Error('No server response!'))
      .mockResolvedValueOnce('root');
    const client = client_with(setUrls);
    await expect(client.setUrls()).rejects.toThrow('No server response!');
    await expect(client.setUrls()).resolves.toBe('root');
    expect(setUrls).toHaveBeenCalledTimes(2);
  });

  it('wraps a client once, and leaves one without setUrls as it is', () => {
    const setUrls: jest.Mock = jest.fn(async () => 'root');
    const target = { setUrls } as unknown as Client;
    const wrapped = rootLinks_share(target) as unknown as { setUrls: unknown };
    const shared: unknown = wrapped.setUrls;
    rootLinks_share(target);
    expect(wrapped.setUrls).toBe(shared);
    const bare = {} as Client;
    expect(rootLinks_share(bare)).toBe(bare);
  });
});

describe('token_verify', () => {
  it('asks users/ with the token, not the API root', async () => {
    mockRequestGet.mockResolvedValue({ data: {} });
    await token_verify('https://cube/api/v1/', 'TOKEN');
    expect(requestConstructorArgs).toEqual([[{ token: 'TOKEN' }, 'application/vnd.collection+json', TOKEN_CHECK_TIMEOUT_MS]]);
    expect(mockRequestGet).toHaveBeenCalledWith('https://cube/api/v1/users/');
  });

  it('passes CUBE\'s refusal through', async () => {
    mockRequestGet.mockRejectedValue(Object.assign(new Error('Invalid token.'), { response: { status: 401 } }));
    await expect(token_verify('https://cube/api/v1/', 'BAD')).rejects.toThrow('Invalid token.');
  });
});
