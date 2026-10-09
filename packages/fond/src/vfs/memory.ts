/**
 * @file A filesystem held in memory: the smallest complete mount.
 *
 * It answers every operation the contract names, with the errno a disk
 * would give, and nothing behind it. It is the reference a backend's mount
 * is held to (`contract.ts`), and a session's whole filesystem when it has
 * no backend of its own.
 *
 * @module
 */
import * as path from 'path';
import { Result, Ok, Err } from '../result.js';
import { errorStack } from '../errorStack.js';
import type { VFSProvider, VFSItem, CpOptions } from './provider.js';
import { vfs_ok, vfs_fail, type VfsOutcome } from './outcome.js';

/** One entry: a folder, or a file and its bytes. */
interface MemoryNode {
  type: 'dir' | 'file';
  content: Buffer;
  date: string;
}

/**
 * What to put in a memory filesystem before it is used: each path with the
 * text of its file, or null for a folder. Parents are made as needed.
 */
export type MemorySeed = Readonly<Record<string, string | null>>;

/** A filesystem held in memory, answering every operation the contract names. */
export class MemoryVfsProvider implements VFSProvider {
  /** The prefix it claims; empty for a session's whole filesystem. */
  prefix: string;

  /** Who owns what it holds, as a listing says. */
  private readonly owner: string;

  /** Every entry, by absolute path; the root always exists. */
  private readonly nodes: Map<string, MemoryNode> = new Map();

  /**
   * Makes an empty filesystem, or one already holding what the seed names.
   *
   * @param prefix - The prefix it claims (`''` for the whole tree).
   * @param seed - Paths to make first.
   * @param owner - The owner its listings show.
   */
  constructor(prefix: string = '', seed: MemorySeed = {}, owner: string = 'user') {
    this.prefix = prefix;
    this.owner = owner;
    this.nodes.set(this.root_get(), { type: 'dir', content: Buffer.alloc(0), date: new Date().toISOString() });
    for (const [where, text] of Object.entries(seed)) this.seed_put(where, text);
  }

  /**
   * Puts one seeded entry, making its parents.
   *
   * @param where - The path.
   * @param text - The file's text, or null for a folder.
   */
  seed_put(where: string, text: string | null): void {
    const at: string = path.posix.normalize(where);
    const parts: string[] = at.split('/').filter((part: string): boolean => part.length > 0);
    let walked: string = '';
    for (let i: number = 0; i < parts.length - 1; i++) {
      walked += `/${parts[i]}`;
      if (!this.nodes.has(walked)) this.nodes.set(walked, { type: 'dir', content: Buffer.alloc(0), date: new Date().toISOString() });
    }
    this.nodes.set(at, text === null
      ? { type: 'dir', content: Buffer.alloc(0), date: new Date().toISOString() }
      : { type: 'file', content: Buffer.from(text, 'utf-8'), date: new Date().toISOString() });
  }

  /** The root of what it holds. */
  private root_get(): string {
    return this.prefix === '' ? '/' : path.posix.normalize(this.prefix);
  }

  /**
   * A path in the form entries are kept under.
   *
   * @param where - The path asked.
   * @returns It, normalised, without a trailing slash.
   */
  private key_of(where: string): string {
    const at: string = path.posix.normalize(where.startsWith('/') ? where : `/${where}`);
    return at.length > 1 && at.endsWith('/') ? at.slice(0, -1) : at;
  }

  /**
   * The entries directly in a folder.
   *
   * @param folder - The folder's key.
   * @returns Their keys.
   */
  private children_of(folder: string): string[] {
    const prefix: string = folder === '/' ? '/' : `${folder}/`;
    return [...this.nodes.keys()].filter((key: string): boolean =>
      key !== folder && key.startsWith(prefix) && !key.slice(prefix.length).includes('/'));
  }

  /**
   * Whether a new entry may be made at a path: its parent is a folder.
   *
   * @param key - The new entry's key.
   * @returns Null when it may, else why not.
   */
  private parent_check(key: string): VfsOutcome | null {
    const parent: MemoryNode | undefined = this.nodes.get(path.posix.dirname(key));
    if (parent === undefined) return vfs_fail('ENOENT');
    if (parent.type !== 'dir') return vfs_fail('ENOTDIR');
    return null;
  }

  async list(where: string): Promise<Result<VFSItem[]>> {
    const key: string = this.key_of(where);
    const node: MemoryNode | undefined = this.nodes.get(key);
    if (node === undefined) {
      errorStack.stack_push('error', `Cannot list ${key}: No such file or directory`);
      return Err();
    }
    if (node.type !== 'dir') {
      errorStack.stack_push('error', `Cannot list ${key}: Not a directory`);
      return Err();
    }
    return Ok(this.children_of(key).sort().map((child: string): VFSItem => {
      const entry: MemoryNode = this.nodes.get(child) as MemoryNode;
      return { name: path.posix.basename(child), type: entry.type, size: entry.content.length, owner: this.owner, date: entry.date };
    }));
  }

  async read(where: string): Promise<VfsOutcome<string>> {
    const bytes: VfsOutcome<Buffer> = await this.readBinary(where);
    return bytes.ok ? vfs_ok(bytes.value.toString('utf-8')) : bytes;
  }

  async readBinary(where: string): Promise<VfsOutcome<Buffer>> {
    const node: MemoryNode | undefined = this.nodes.get(this.key_of(where));
    if (node === undefined) return vfs_fail('ENOENT');
    if (node.type === 'dir') return vfs_fail('EISDIR');
    return vfs_ok(Buffer.from(node.content));
  }

  async write(where: string, content: string | Buffer): Promise<VfsOutcome> {
    const key: string = this.key_of(where);
    const existing: MemoryNode | undefined = this.nodes.get(key);
    if (existing?.type === 'dir') return vfs_fail('EISDIR');
    const refused: VfsOutcome | null = this.parent_check(key);
    if (refused !== null) return refused;
    this.nodes.set(key, { type: 'file', content: Buffer.isBuffer(content) ? Buffer.from(content) : Buffer.from(content, 'utf-8'), date: new Date().toISOString() });
    return vfs_ok(true);
  }

  async mkdir(where: string): Promise<VfsOutcome> {
    const key: string = this.key_of(where);
    if (this.nodes.has(key)) return vfs_fail('EEXIST');
    const refused: VfsOutcome | null = this.parent_check(key);
    if (refused !== null) return refused;
    this.nodes.set(key, { type: 'dir', content: Buffer.alloc(0), date: new Date().toISOString() });
    return vfs_ok(true);
  }

  async rmdir(where: string): Promise<VfsOutcome> {
    const key: string = this.key_of(where);
    const node: MemoryNode | undefined = this.nodes.get(key);
    if (node === undefined) return vfs_fail('ENOENT');
    if (node.type !== 'dir') return vfs_fail('ENOTDIR');
    if (key === this.root_get()) return vfs_fail('EPERM');
    if (this.children_of(key).length > 0) return vfs_fail('ENOTEMPTY');
    this.nodes.delete(key);
    return vfs_ok(true);
  }

  async rename(src: string, dest: string): Promise<VfsOutcome> {
    const from: string = this.key_of(src);
    const to: string = this.key_of(dest);
    const node: MemoryNode | undefined = this.nodes.get(from);
    if (node === undefined) return vfs_fail('ENOENT');
    if (from === this.root_get()) return vfs_fail('EPERM');
    const refused: VfsOutcome | null = this.parent_check(to);
    if (refused !== null) return refused;
    const target: MemoryNode | undefined = this.nodes.get(to);
    if (target !== undefined && (target.type === 'dir') !== (node.type === 'dir')) {
      return vfs_fail(target.type === 'dir' ? 'EISDIR' : 'ENOTDIR');
    }
    if (target?.type === 'dir' && this.children_of(to).length > 0) return vfs_fail('ENOTEMPTY');
    // The entry and, for a folder, everything under it take the new name.
    for (const key of [...this.nodes.keys()]) {
      if (key === from || key.startsWith(`${from}/`)) {
        const moved: MemoryNode = this.nodes.get(key) as MemoryNode;
        this.nodes.delete(key);
        this.nodes.set(to + key.slice(from.length), moved);
      }
    }
    return vfs_ok(true);
  }

  async rm(where: string): Promise<VfsOutcome> {
    const key: string = this.key_of(where);
    const node: MemoryNode | undefined = this.nodes.get(key);
    if (node === undefined) return vfs_fail('ENOENT');
    if (node.type === 'dir') return vfs_fail('EISDIR');
    this.nodes.delete(key);
    return vfs_ok(true);
  }

  async rmTree(where: string): Promise<VfsOutcome> {
    const key: string = this.key_of(where);
    const node: MemoryNode | undefined = this.nodes.get(key);
    if (node === undefined) return vfs_fail('ENOENT');
    if (node.type !== 'dir') return vfs_fail('ENOTDIR');
    if (key === this.root_get()) return vfs_fail('EPERM');
    for (const child of [...this.nodes.keys()]) {
      if (child === key || child.startsWith(`${key}/`)) this.nodes.delete(child);
    }
    return vfs_ok(true);
  }

  async cp(src: string, dest: string, options: CpOptions): Promise<VfsOutcome> {
    const from: string = this.key_of(src);
    const to: string = this.key_of(dest);
    const node: MemoryNode | undefined = this.nodes.get(from);
    if (node === undefined) return vfs_fail('ENOENT');
    if (node.type === 'dir' && !options.recursive) return vfs_fail('EISDIR');
    const refused: VfsOutcome | null = this.parent_check(to);
    if (refused !== null) return refused;
    for (const key of [...this.nodes.keys()]) {
      if (key === from || key.startsWith(`${from}/`)) {
        const copied: MemoryNode = this.nodes.get(key) as MemoryNode;
        this.nodes.set(to + key.slice(from.length), { ...copied, content: Buffer.from(copied.content) });
      }
    }
    return vfs_ok(true);
  }
}
