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

class InitializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InitializationError";
  }
}

/**
 * Handles commands related to groups of plugin contexts (computes, instances, parameters).
 */
export class PluginContextGroupHandler {
  private baseGroupHandler: BaseGroupHandler | null = null;
  private controller: PluginContextController;
  readonly assetName: string;

  private constructor(
    controller: PluginContextController,
    assetName: string
  ) {
    this.controller = controller;
    this.assetName = assetName;
    // Cast ChRISEmbeddedResourceGroup to ChRISEmbeddedResourceGroup<unknown> safely.
    this.baseGroupHandler = new BaseGroupHandler(
      this.assetName,
      this.controller.chrisObject as unknown as ChRISEmbeddedResourceGroup<unknown>
    );
  }

  /**
   * Factory method to create a new PluginContextGroupHandler instance.
   *
   * @param assetName - The type of plugin context to handle ('computesofplugin', 'instancesofplugin', 'parametersofplugin').
   * @param id - Optional plugin ID. Defaults to current ChRIS plugin context.
   * @returns A Promise resolving to a new PluginContextGroupHandler instance.
   * @throws InitializationError if an unsupported asset type is provided.
   */
  static async handler_create(
    assetName: string,
    id?: number | null
  ): Promise<PluginContextGroupHandler> {
    try {
        const controller: PluginContextController = await PluginContextController.controller_create(assetName, id);
        return new PluginContextGroupHandler(controller, assetName);
    } catch (error: unknown) {
        throw new InitializationError(`Failed to initialize PluginContextGroupHandler: ${error}`);
    }
  }

  /**
   * Lists plugin parameters in a "man page" style format.
   * This is a specialized view for parameters that differs from the standard table view.
   *
   * @param options - CLI options for filtering.
   */
  async parameters_listMan(options: CLIoptions): Promise<void> {
    try {
      // We access the asset directly from the controller
      const asset = this.controller.chrisObject.asset;
      
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
      if (this.baseGroupHandler) {
          await this.baseGroupHandler.resourceFields_list();
      }
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
      const asset = this.controller.chrisObject.asset;

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
    if (this.baseGroupHandler) {
      return this.baseGroupHandler.resourceFields_render();
    }
    return envelope_ok('');
  }

  /**
   * Sets up the Commander.js commands for plugin context group operations.
   *
   * @param program - The Commander.js program instance.
   */
  pluginContextGroupCommand_setup(program: Command): void {
    if (this.baseGroupHandler) {
      this.baseGroupHandler.command_setup(program);
    }

    const fileGroupCommand: Command | undefined = program.commands.find(
      (cmd) => cmd.name() === this.assetName
    );
  }
}
