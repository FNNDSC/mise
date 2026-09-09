/**
 * @file The name this host is advertised under.
 *
 * A daemon bound to every interface prints addresses meant to be pasted
 * from another machine, and a bare hostname resolves only inside its own
 * search domain. The fully qualified name resolves from anywhere the
 * network reaches.
 *
 * @module
 */
import { promises as dns } from 'node:dns';
import { hostname } from 'node:os';

/** The resolvers the lookup runs on, replaceable under test. */
export interface HostResolvers {
  hostname: () => string;
  lookup: (host: string) => Promise<{ address: string }>;
  reverse: (address: string) => Promise<string[]>;
}

/** The live resolvers: the OS hostname and the system resolver. */
const SYSTEM_RESOLVERS: HostResolvers = {
  hostname,
  lookup: (host: string): Promise<{ address: string }> => dns.lookup(host, { family: 4 }),
  reverse: (address: string): Promise<string[]> => dns.reverse(address),
};

/**
 * Resolves this host's fully qualified name.
 *
 * The hostname's own address is looked up and reversed; the first name
 * carrying a domain is the answer. Anything short of that — no address,
 * no reverse record, a bare name back — falls back to the hostname, which
 * is what was advertised before and still resolves locally.
 *
 * @param resolvers - The resolvers to consult; defaults to the system's.
 * @returns The fully qualified name, or the bare hostname.
 */
export async function hostFqdn_get(resolvers: HostResolvers = SYSTEM_RESOLVERS): Promise<string> {
  const short: string = resolvers.hostname();
  try {
    const { address }: { address: string } = await resolvers.lookup(short);
    const names: string[] = await resolvers.reverse(address);
    const qualified: string | undefined = names.find((name: string): boolean => name.includes('.'));
    return qualified ?? short;
  } catch {
    return short;
  }
}
