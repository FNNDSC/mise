/**
 * @file Handler for the plugin context command group.
 *
 * @module
 */

import { Command } from "commander";
import { BaseGroupHandler } from "../handlers/baseGroupHandler.js";
import { CLIoptions, options_toParams } from "../utils/cli.js";
import { PluginContextController } from "../controllers/pluginContextController.js";
import { pluginParameters_renderMan, pluginParameters_manRender } from "../views/pluginParameters.js";
import { FilteredResourceData, ChRISEmbeddedResourceGroup, type CommandEnvelope, envelope_ok, envelope_error } from "@fnndsc/cumin";
import { chiliErrLog, chiliLog } from "../screen/output.js";

/**
 * Handles commands related to groups of plugin contexts (computes, instances, parameters).
 */
export class PluginContextGroupHandler {
  // Registration-only: built with no ChRIS context; its context is filled in by
  // controller_ensure() before any action reads it.
  private baseGroupHandler: BaseGroupHandler;
  // Resolved lazily on first action.
  private controller: PluginContextController | null = null;
  readonly assetName: string;
  private readonly id?: number | null;

  private constructor(assetName: string, id?: number | null) {
    this.assetName = assetName;
    this.id = id;
    this.baseGroupHandler = new BaseGroupHandler(this.assetName);
  }

  /**
   * Creates a PluginContextGroupHandler for an asset type. This performs no
   * network work and resolves no plugin context — command registration needs
   * only the asset name; the controller is resolved lazily on first action (see
   * {@link controller_ensure}).
   *
   * @param assetName - The type of plugin context ('computesofplugin', 'instancesofplugin', 'parametersofplugin').
   * @param id - Optional plugin ID the context binds to; defaults to the current plugin context.
   * @returns A new PluginContextGroupHandler instance.
   */
  static handler_create(assetName: string, id?: number | null): PluginContextGroupHandler {
    return new PluginContextGroupHandler(assetName, id);
  }

  /**
   * Lazily resolves and memoizes the plugin-context controller against the bound
   * plugin id (or the current ChRIS context), wiring it into the
   * registration-only base handler so its actions can read the context.
   *
   * @returns The controller, or null if the context cannot be resolved here.
   */
  private async controller_ensure(): Promise<PluginContextController | null> {
    if (!this.controller) {
      try {
        this.controller = await PluginContextController.controller_create(this.assetName, this.id);
        this.baseGroupHandler.chrisObject =
          this.controller.chrisObject as unknown as ChRISEmbeddedResourceGroup<unknown>;
      } catch {
        this.controller = null;
      }
    }
    return this.controller;
  }

  /**
   * Lists plugin parameters in a "man page" style format.
   * This is a specialized view for parameters that differs from the standard table view.
   *
   * @param options - CLI options for filtering.
   */
  async parameters_listMan(options: CLIoptions): Promise<void> {
    try {
      const controller: PluginContextController | null = await this.controller_ensure();
      if (!controller) {
        chiliErrLog(`No plugin context is available for ${this.assetName} in the current context.`);
        return;
      }
      // We access the asset directly from the controller
      const asset = controller.chrisObject.asset;

      if (!asset || typeof asset.resources_listAndFilterByOptions !== 'function') {
         chiliErrLog("Underlying resource does not support listing.");
         return;
      }

      const params = options_toParams(options);
      const results: FilteredResourceData | null = await asset.resources_listAndFilterByOptions(params);

      if (results) {
        pluginParameters_renderMan(results);
      } else {
        chiliLog("No parameters found.");
      }
    } catch (error: unknown) {
      chiliErrLog(`Error listing parameters: ${error}`);
    }
  }

  /**
   * Lists available fields for the current plugin context resource.
   */
  async parameters_fieldsList(): Promise<void> {
    const controller: PluginContextController | null = await this.controller_ensure();
    if (!controller) {
      chiliErrLog(`No plugin context is available for ${this.assetName} in the current context.`);
      return;
    }
    await this.baseGroupHandler.resourceFields_list();
  }

  /**
   * Renders plugin parameters in "man page" style as an envelope.
   *
   * Sans-I/O counterpart to {@link parameters_listMan}.
   *
   * @param options - CLI options for filtering.
   * @returns An envelope carrying the rendered parameters or an error.
   */
  async parameters_listManRender(options: CLIoptions): Promise<CommandEnvelope> {
    try {
      const controller: PluginContextController | null = await this.controller_ensure();
      if (!controller) {
        return envelope_error('', undefined, `No plugin context is available for ${this.assetName} in the current context.\n`);
      }
      const asset = controller.chrisObject.asset;

      if (!asset || typeof asset.resources_listAndFilterByOptions !== 'function') {
        return envelope_error('', undefined, "Underlying resource does not support listing.\n");
      }

      const params = options_toParams(options);
      const results: FilteredResourceData | null = await asset.resources_listAndFilterByOptions(params);

      if (results) {
        return envelope_ok(`${pluginParameters_manRender(results)}\n`);
      }
      return envelope_ok("No parameters found.\n");
    } catch (error: unknown) {
      return envelope_error('', undefined, `Error listing parameters: ${error}\n`);
    }
  }

  /**
   * Renders available fields for the current plugin context resource as an envelope.
   *
   * Sans-I/O counterpart to {@link parameters_fieldsList}.
   *
   * @returns An envelope carrying the field listing.
   */
  async parameters_fieldsRender(): Promise<CommandEnvelope> {
    const controller: PluginContextController | null = await this.controller_ensure();
    if (!controller) {
      return envelope_ok('');
    }
    return this.baseGroupHandler.resourceFields_render();
  }

  /**
   * Sets up the Commander.js commands for plugin context group operations.
   *
   * @param program - The Commander.js program instance.
   */
  pluginContextGroupCommand_setup(program: Command): void {
    this.baseGroupHandler.command_setup(program);
  }
}
