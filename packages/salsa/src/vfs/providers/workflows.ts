/**
 * @file `/proc/workflows` — instantiated pipelines, beside the jobs they own.
 *
 * A CUBE workflow is a pipeline that was run: it names the pipeline and owns
 * the plugin instances the run created. That is runtime state, which is why it
 * lives under `/proc` alongside `/proc/jobs` rather than under `/bin` with the
 * pipeline definitions.
 *
 * A workflow is a relation, so it projects as a directory of links — the
 * `pipeline` entry points into `/bin`, and each entry under `jobs/` points into
 * `/proc/jobs`. Nothing here duplicates a job's own representation; following a
 * link arrives at the one `/proc/jobs` already provides.
 *
 * Links are lazy: a listing states that a link exists without paying to resolve
 * it, and `linkTarget_resolve` is called only when something actually follows
 * one.
 *
 * @module
 */

import {
  Err,
  Ok,
  errorStack,
  type FilteredResourceData,
  type Result,
} from '@fnndsc/cumin';
import type { CpOptions, VFSItem, VFSProvider } from '../provider.js';
import { workflows_listAll } from '../../workflows/index.js';

/** The prefix this provider answers for. */
const PREFIX: string = '/proc/workflows';

/** Entries every workflow directory carries. */
const WORKFLOW_ENTRIES: readonly string[] = ['pipeline', 'jobs', 'title'];

/**
 * Reads a field from a workflow row, tolerating the shapes CUBE reports.
 *
 * @param row - One workflow row.
 * @param field - The field to read.
 * @returns The value as a string, or an empty string when absent.
 */
function field_text(row: Record<string, unknown>, field: string): string {
  const value: unknown = row[field];
  return value === undefined || value === null ? '' : String(value);
}

/**
 * Splits a path below this provider's prefix into its segments.
 *
 * @param path - An absolute path under `/proc/workflows`.
 * @returns The segments after the prefix, empty at the root.
 */
function segments_below(path: string): string[] {
  return path.slice(PREFIX.length).split('/').filter(Boolean);
}

/**
 * Projects CUBE workflows as `/proc/workflows`.
 */
export class WorkflowsVfsProvider implements VFSProvider {
  /** @inheritdoc */
  public prefix: string = PREFIX;

  /** @inheritdoc */
  public async list(path: string): Promise<Result<VFSItem[]>> {
    const parts: string[] = segments_below(path);

    if (parts.length === 0) {
      return this.workflows_list();
    }
    if (parts.length === 1) {
      return Ok(WORKFLOW_ENTRIES.map((name: string): VFSItem => ({
        name,
        type: name === 'jobs' ? 'dir' : (name === 'pipeline' ? 'link' : 'file'),
        size: 0,
        owner: '',
        date: '',
      })));
    }
    if (parts.length === 2 && parts[1] === 'jobs') {
      return this.jobs_list(Number(parts[0]));
    }

    errorStack.stack_push('error', `${path} is not a workflow path.`);
    return Err();
  }

  /** @inheritdoc */
  public async cp(_src: string, _dest: string, _options: CpOptions): Promise<boolean> {
    // A workflow is a record of a run. Copying one would assert that a
    // computation happened twice.
    errorStack.stack_push('error', 'A workflow records a run; it cannot be copied.');
    return false;
  }

  /** @inheritdoc */
  public async read(path: string): Promise<Result<string>> {
    const parts: string[] = segments_below(path);
    if (parts.length !== 2 || parts[1] !== 'title') {
      errorStack.stack_push('error', `${path} is not a readable workflow file.`);
      return Err();
    }
    const rows: Record<string, unknown>[] = await this.rows_get();
    const row: Record<string, unknown> | undefined =
      rows.find((entry: Record<string, unknown>): boolean => field_text(entry, 'id') === parts[0]);
    if (!row) {
      errorStack.stack_push('error', `No workflow ${parts[0]}.`);
      return Err();
    }
    return Ok(`${field_text(row, 'title')}\n`);
  }

  /**
   * Resolves a workflow's `pipeline` link to its definition under `/bin`.
   *
   * @param path - The link's absolute path.
   * @returns The target path, or an error when the workflow is unknown.
   */
  public async linkTarget_resolve(path: string): Promise<Result<string>> {
    const parts: string[] = segments_below(path);
    if (parts.length !== 2 || parts[1] !== 'pipeline') {
      errorStack.stack_push('error', `${path} is not a workflow link.`);
      return Err();
    }
    const rows: Record<string, unknown>[] = await this.rows_get();
    const row: Record<string, unknown> | undefined =
      rows.find((entry: Record<string, unknown>): boolean => field_text(entry, 'id') === parts[0]);
    if (!row) {
      errorStack.stack_push('error', `No workflow ${parts[0]}.`);
      return Err();
    }
    return Ok(`/bin/${field_text(row, 'pipeline_name')}`);
  }

  /**
   * Fetches every workflow visible to this session.
   *
   * @returns The workflow rows, empty when the fetch failed.
   */
  private async rows_get(): Promise<Record<string, unknown>[]> {
    const data: FilteredResourceData | null = await workflows_listAll();
    return data?.tableData ?? [];
  }

  /**
   * Lists the workflows themselves, one directory each.
   *
   * @returns The listing.
   */
  private async workflows_list(): Promise<Result<VFSItem[]>> {
    const rows: Record<string, unknown>[] = await this.rows_get();
    return Ok(rows.map((row: Record<string, unknown>): VFSItem => ({
      name: field_text(row, 'id'),
      type: 'dir',
      size: 0,
      owner: field_text(row, 'owner_username'),
      date: field_text(row, 'creation_date'),
      title: field_text(row, 'title'),
      id: Number(field_text(row, 'id')),
    })));
  }

  /**
   * Lists one workflow's plugin instances as links into `/proc/jobs`.
   *
   * @param workflowId - The workflow whose instances to list.
   * @returns The listing.
   */
  private async jobs_list(workflowId: number): Promise<Result<VFSItem[]>> {
    const rows: Record<string, unknown>[] = await this.rows_get();
    const row: Record<string, unknown> | undefined =
      rows.find((entry: Record<string, unknown>): boolean => Number(field_text(entry, 'id')) === workflowId);
    if (!row) {
      errorStack.stack_push('error', `No workflow ${workflowId}.`);
      return Err();
    }
    const ids: number[] = Array.isArray(row['plugin_instances'])
      ? (row['plugin_instances'] as unknown[]).map(Number).filter((id: number): boolean => !Number.isNaN(id))
      : [];
    return Ok(ids.map((id: number): VFSItem => ({
      name: String(id),
      type: 'link',
      size: 0,
      owner: field_text(row, 'owner_username'),
      date: '',
      target: `/proc/jobs/${id}`,
      id,
    })));
  }
}
