/**
 * @file `/bin` in a ChRIS session: CUBE's plugins and pipelines, as executables.
 *
 * Listing it reads the plugins and pipelines CUBE holds; reading an entry
 * gives a plugin's manual or a pipeline's summary. Nothing here writes or
 * copies.
 *
 * @module
 */
import { vfs_fail, vfsOutcome_ofBoolean, vfsOutcome_ofResult, type VfsOutcome } from '@fnndsc/fond';
import { plugins_listAll, pipelines_getAll, type PipelineRecord } from '@fnndsc/salsa';
import { Result, Ok, Err, errorStack, vfsItems_sort, type VFSProvider, type VFSItem, type CpOptions } from '@fnndsc/fond';
import type { PluginInfoModel } from '@fnndsc/menu';
import {
  pluginInfo_build,
  pluginInfoText_render,
  pluginSpecifier_parse,
  type PluginSpecifier,
} from '../builtins/res/plugin.info.js';
import { binPipelineSummary_render, binPipelineSummary_try, type BinPipelineSummary } from './binEntry.js';

/** `/bin`: CUBE's plugins and pipelines. */
export class BinVfsProvider implements VFSProvider {
  /** The prefix this provider handles. */
  prefix: string = '/bin';

  /**
   * Lists the plugins (as `name-vVERSION`) and the pipelines (by slug).
   *
   * @param pathStr - The absolute path.
   * @param options - Sort controls.
   * @returns The executables.
   */
  async list(
    pathStr: string,
    options?: { sort?: "name" | "size" | "date" | "owner"; reverse?: boolean }
  ): Promise<Result<VFSItem[]>> {
    try {
      let effectivePath: string = pathStr.startsWith("/") ? pathStr : "/" + pathStr;
      if (effectivePath.length > 1 && effectivePath.endsWith("/")) {
        effectivePath = effectivePath.slice(0, -1);
      }
      if (effectivePath !== "/bin") return Ok([]);

      const [plugins, pipelinesResult] = await Promise.all([
        plugins_listAll({}),
        pipelines_getAll(),
      ]);
      const items: VFSItem[] = [];

      if (plugins && plugins.tableData) {
        plugins.tableData.forEach((plugin: Record<string, unknown>) => {
          const pluginName: string = typeof plugin.name === 'string' ? plugin.name : String(plugin.name);
          const pluginVersion: string = typeof plugin.version === 'string' ? plugin.version : String(plugin.version || '');
          const displayName: string = pluginVersion ? `${pluginName}-v${pluginVersion}` : pluginName;
          items.push({
            name: displayName,
            type: "plugin",
            size: 0,
            owner: "system",
            date: typeof plugin.creation_date === 'string' ? plugin.creation_date : '',
          });
        });
      }

      if (pipelinesResult.ok) {
        pipelinesResult.value.forEach((pipeline: PipelineRecord) => {
          const slug: string = typeof pipeline.slug === 'string' ? pipeline.slug : pipeline.name.replace(/\s+/g, '_');
          items.push({
            name: slug,
            type: "pipeline",
            size: 0,
            owner: typeof pipeline.authors === 'string' ? pipeline.authors : 'system',
            date: '',
            title: pipeline.name,
            id: pipeline.id,
          });
        });
      }

      const sorted: VFSItem[] = vfsItems_sort(items, options?.sort, options?.reverse);
      return Ok(sorted);
    } catch (error: unknown) {
      const msg: string = error instanceof Error ? error.message : String(error);
      errorStack.stack_push("error", `Static VFS list failed for prefix ${this.prefix}: ${msg}`);
      return Err();
    }
  }

  /** @inheritdoc */
  async cp(src: string, dest: string, options: CpOptions): Promise<VfsOutcome> {
    return vfsOutcome_ofBoolean(await this.copy_run(src, dest, options), 'EROFS');
  }

  /**
   * Refuses to copy from `/bin`.
   *
   * @param src - Source path.
   * @param dest - Destination path.
   * @param options - Copy options.
   * @returns False, always.
   */
  private async copy_run(src: string, dest: string, options: CpOptions): Promise<boolean> {
    errorStack.stack_push("error", `cp: Copying from static VFS path '${src}' is not supported.`);
    return false;
  }

  /** @inheritdoc */
  async rm(): Promise<VfsOutcome> {
    return vfs_fail('EROFS', 'virtual /bin directory');
  }

  /** @inheritdoc */
  async rmTree(): Promise<VfsOutcome> {
    return vfs_fail('EROFS', 'virtual /bin directory');
  }

  /** @inheritdoc */
  async read(pathStr: string): Promise<VfsOutcome<string>> {
    return vfsOutcome_ofResult(await this.text_read(pathStr), 'ENOENT');
  }

  /**
   * Reads an entry: a pipeline's summary, or a plugin's manual.
   *
   * @param pathStr - The absolute path of the entry.
   * @returns The text.
   */
  private async text_read(pathStr: string): Promise<Result<string>> {
    try {
      let effectivePath: string = pathStr.startsWith("/") ? pathStr : "/" + pathStr;
      if (effectivePath.length > 1 && effectivePath.endsWith("/")) {
        effectivePath = effectivePath.slice(0, -1);
      }
      const commandName: string = effectivePath.substring("/bin/".length);
      const pipelineSummary: BinPipelineSummary | null = binPipelineSummary_try(commandName);
      if (pipelineSummary !== null) return Ok(binPipelineSummary_render(pipelineSummary));

      const specifier: PluginSpecifier | null = pluginSpecifier_parse(commandName);
      if (specifier === null) {
        errorStack.stack_push("error", `Unknown /bin entry: ${commandName}`);
        return Err();
      }

      // The manual is a projection of the plugin model — the same facts
      // `plugin info` puts on the wire, so a terminal and a graphical
      // surface cannot end up describing different plugins.
      const built: Result<PluginInfoModel> = await pluginInfo_build(specifier);
      if (!built.ok) return Err();
      return Ok(pluginInfoText_render(built.value));
    } catch (error: unknown) {
      const msg: string = error instanceof Error ? error.message : String(error);
      errorStack.stack_push("error", `Static VFS read failed for prefix ${this.prefix}: ${msg}`);
      return Err();
    }
  }

  /** @inheritdoc */
  async readBinary(pathStr: string): Promise<VfsOutcome<Buffer>> {
    return vfsOutcome_ofResult(await this.bytes_read(pathStr), 'ENOENT');
  }

  /**
   * Reads an entry as bytes.
   *
   * @param pathStr - The absolute path of the entry.
   * @returns The text's bytes.
   */
  private async bytes_read(pathStr: string): Promise<Result<Buffer>> {
    const res: Result<string> = await this.read(pathStr);
    return res.ok ? Ok(Buffer.from(res.value, "utf-8")) : Err();
  }
}
