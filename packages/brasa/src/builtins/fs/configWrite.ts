/**
 * @file `config write <cfs-path> <base64>` — writes small configuration
 * documents into the user's CUBE home.
 *
 * The durable layer (AEGIS: config-in-CFS) stores per-user surface state —
 * argus desktops, prompt choices — as files under `~/.config/...` on CFS.
 * Surfaces hold no upload credentials of their own, so the write travels
 * the session: content arrives base64-encoded, lands in a host temp file,
 * and rides the same upload path the edit-in-place flow already uses.
 *
 * @module
 */
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import chalk from 'chalk';
import { files_uploadPath } from '@fnndsc/salsa';
import { file_replaceContent, type EditResult } from '@fnndsc/chili/commands/fs/edit.js';
import { path_resolve } from '../utils.js';
import { envelope_error, envelope_ok, type CommandEnvelope } from '@fnndsc/cumin';

/** A config document is a note, not a dataset. */
const CONFIG_WRITE_LIMIT: number = 256 * 1024;

/**
 * Handles `config write <path> <base64>`.
 *
 * @param args - Full command args (`config`, `write`, path, base64).
 * @returns An envelope reporting the written path.
 */
export async function configWrite_handle(args: string[]): Promise<CommandEnvelope> {
  const rawPath: string | undefined = args[2];
  const encoded: string | undefined = args[3];
  if (rawPath === undefined || encoded === undefined) {
    process.exitCode = 1;
    return envelope_error('', undefined, 'usage: config write <cfs-path> <base64-content>\n');
  }
  let content: Buffer;
  try {
    content = Buffer.from(encoded, 'base64');
  } catch {
    process.exitCode = 1;
    return envelope_error('', undefined, 'config write: the content is not valid base64.\n');
  }
  if (content.length > CONFIG_WRITE_LIMIT) {
    process.exitCode = 1;
    return envelope_error('', undefined, 'config write: a config document is a note, not a dataset (256KB limit).\n');
  }

  const remotePath: string = rawPath.startsWith('/') ? rawPath : await path_resolve(rawPath);
  const tmpPath: string = join(tmpdir(), `chell-config-${Date.now()}.tmp`);
  try {
    writeFileSync(tmpPath, content);
    // A fresh document uploads; an existing one is replaced in place (the
    // edit idiom: CFS files are immutable, so replace = delete + upload).
    let uploaded: boolean = await files_uploadPath(tmpPath, remotePath);
    if (!uploaded) {
      const replaced: EditResult = await file_replaceContent(remotePath, tmpPath);
      uploaded = replaced.success;
    }
    if (!uploaded) {
      process.exitCode = 1;
      return envelope_error('', undefined, `config write: upload to ${remotePath} failed.\n`);
    }
    return envelope_ok(`${chalk.green('[+]')} wrote ${remotePath} (${content.length} bytes)\n`);
  } finally {
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
  }
}

/**
 * Routes the `config` command family. `write` is its only member today;
 * reads travel the ordinary `cat`.
 *
 * @param args - Full command args.
 * @returns The subcommand's envelope.
 */
export async function builtin_config(args: string[]): Promise<CommandEnvelope> {
  if (args[1] === 'write') return configWrite_handle(args);
  process.exitCode = 1;
  return envelope_error('', undefined, 'usage: config write <cfs-path> <base64-content>\n');
}
