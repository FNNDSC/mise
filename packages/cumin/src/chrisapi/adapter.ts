/**
 * @file ChRIS API adapter — the single seam between cumin and `@fnndsc/chrisapi`.
 *
 * This module is the only place in cumin that imports `@fnndsc/chrisapi` and
 * the only place allowed to cast against its objects. The chrisapi typings
 * lag the real API surface (missing methods, untyped `data` payloads), so
 * every other module works through the small set of generics exported here:
 * lifecycle (`authToken_get`, `client_create`), payload extractors
 * (`listData_get`, `itemData_get`, `items_get`, `collectionItems_get`),
 * dynamic dispatch for methods absent from the typings (`resource_call`),
 * and client-shape helpers (`client_authGet`, `client_adminUrlEnsure`).
 *
 * Domain modules pass their own target type `T`; the adapter performs the
 * cast. This keeps the unsafe surface auditable in one file and gives tests
 * a single boundary to stub.
 *
 * @module
 */

import Client, { ListResource, PACSRetrieve } from '@fnndsc/chrisapi';

/**
 * The chrisapi Client class, re-exported as a value.
 *
 * Kept as a value (not `export type`) because downstream packages call
 * static methods such as `Client.getAuthToken` through cumin's public API.
 */
export { Client };

export type {
  ListResource,
  Resource,
  ItemResource,
  GroupList,
  ComputeResourceList,
  PluginInstance,
  PluginList,
  Feed,
  CommentList,
  Note,
  Comment,
  FileBrowserFolder,
  UserFile,
  PACSFile,
  PipelineSourceFile,
  PipelineSourceFileList,
} from '@fnndsc/chrisapi';

/**
 * Authentication slice of a connected chrisapi Client.
 *
 * The chrisapi typings omit the `auth` property although it exists at
 * runtime on every connected client.
 *
 * @property cubeUrl - Base URL of the CUBE instance, when present.
 * @property token - The bearer token for the current session.
 */
export interface ClientAuth {
  cubeUrl?: string;
  token: string;
  [key: string]: unknown;
}

/**
 * Requests an authentication token from a CUBE auth endpoint.
 *
 * @param authUrl - Full URL of the CUBE `auth-token/` endpoint.
 * @param user - Username to authenticate as.
 * @param password - Password for the user.
 * @returns The bearer token string.
 * @throws {Error} Propagates chrisapi/network errors (e.g. bad credentials).
 */
export async function authToken_get(
  authUrl: string,
  user: string,
  password: string,
): Promise<string> {
  return Client.getAuthToken(authUrl, user, password);
}

/**
 * Creates a chrisapi Client bound to a CUBE URL and bearer token.
 *
 * @param url - Base URL of the CUBE API (e.g. `https://cube/api/v1/`).
 * @param token - Bearer token obtained from `authToken_get`.
 * @returns A connected Client instance.
 */
export function client_create(url: string, token: string): Client {
  return new Client(url, { token });
}

/**
 * Reads the runtime `auth` slice of a connected client.
 *
 * @param client - A connected chrisapi Client.
 * @returns The client's auth object (token and, when present, cubeUrl).
 */
export function client_authGet(client: Client): ClientAuth {
  return (client as unknown as { auth: ClientAuth }).auth;
}

/**
 * Resolves the admin URL of a client, populating client URLs if needed.
 *
 * Non-admin users have no admin link; for them this resolves to null.
 *
 * @param client - A connected chrisapi Client.
 * @returns The admin URL string, or null when the user has no admin access.
 */
export async function client_adminUrlEnsure(client: Client): Promise<string | null> {
  const slice: { adminUrl?: string; setUrls?: () => Promise<void> } =
    client as unknown as { adminUrl?: string; setUrls?: () => Promise<void> };
  if (!slice.adminUrl && typeof slice.setUrls === 'function') {
    await slice.setUrls().catch(() => undefined);
  }
  return slice.adminUrl ?? null;
}

/**
 * Narrows an arbitrary resource to a chrisapi ListResource.
 *
 * @param resource - Any value to test.
 * @returns True when the value is a ListResource instance.
 */
export function resource_isList(resource: unknown): resource is ListResource {
  return resource instanceof ListResource;
}

/**
 * Extracts the `data` payload of a list resource as a typed array.
 *
 * @param list - A chrisapi list resource (or anything carrying `data`).
 * @returns The `data` array as `T[]`, or an empty array when absent.
 */
export function listData_get<T>(list: { data?: unknown } | null | undefined): T[] {
  const data: unknown = list?.data;
  return Array.isArray(data) ? (data as T[]) : [];
}

/**
 * Extracts the `data` payload of an item resource as a typed object.
 *
 * @param item - A chrisapi item resource (or anything carrying `data`).
 * @returns The `data` object as `T`, or null when absent.
 */
export function itemData_get<T>(item: { data?: unknown } | null | undefined): T | null {
  const data: unknown = item?.data;
  return data === undefined || data === null ? null : (data as T);
}

/**
 * Returns the items of a list resource as a typed array.
 *
 * @param list - A chrisapi list resource exposing `getItems()`.
 * @returns The items as `T[]`, or an empty array when absent.
 */
export function items_get<T>(list: { getItems(): unknown } | null | undefined): T[] {
  const items: unknown = list?.getItems();
  return Array.isArray(items) ? (items as T[]) : [];
}

/**
 * Returns the collection+json items embedded in a resource as a typed array.
 *
 * @param resource - A chrisapi resource carrying a `collection` document.
 * @returns The collection items as `T[]`, or an empty array when absent.
 */
export function collectionItems_get<T>(
  resource: { collection?: unknown } | null | undefined,
): T[] {
  const items: unknown = (resource?.collection as { items?: unknown } | undefined)?.items;
  return Array.isArray(items) ? (items as T[]) : [];
}

/**
 * Invokes a method on a chrisapi object that its typings do not declare.
 *
 * Used for client/resource methods that exist at runtime but are missing or
 * mistyped in `@fnndsc/chrisapi` (e.g. `createWorkflow`,
 * `getPipelineSourceFiles`, `_post`, `put` with a `path` body).
 *
 * @param obj - The chrisapi object to dispatch on.
 * @param methodName - Name of the runtime method to invoke.
 * @param args - Arguments forwarded to the method.
 * @returns The method's resolved value as `T`.
 * @throws {Error} When the named method does not exist on the object.
 */
export async function resource_call<T>(
  obj: object,
  methodName: string,
  ...args: unknown[]
): Promise<T> {
  const method: unknown = (obj as Record<string, unknown>)[methodName];
  if (typeof method !== 'function') {
    throw new Error(`chrisapi object has no method '${methodName}'`);
  }
  return (method as (...callArgs: unknown[]) => Promise<T>).apply(obj, args);
}

/**
 * Deletes a PACS retrieve resource addressed by URL.
 *
 * The chrisapi Client offers no delete-by-id for retrieves, so the resource
 * is constructed directly from its REST URL and the client's auth.
 *
 * @param retrieveUrl - Full REST URL of the retrieve resource.
 * @param auth - Auth slice of the connected client (from `client_authGet`).
 */
export async function pacsRetrieve_deleteByUrl(
  retrieveUrl: string,
  auth: ClientAuth,
): Promise<void> {
  const retrieve: PACSRetrieve = new PACSRetrieve(retrieveUrl, auth);
  await retrieve.delete();
}
