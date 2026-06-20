/**
 * @file Handler for the PACS server command group.
 *
 * @module
 */

import { Command } from "commander";
import { ChRISPACSGroup } from "@fnndsc/cumin";
import { BaseGroupHandler } from "../handlers/baseGroupHandler.js";
import { CLIoptions } from "../utils/cli.js";

/**
 * Command-group handler for PACS server operations.
 */
export class PACSServerGroupHandler {
  private baseGroupHandler: BaseGroupHandler;
  private assetName: string = "pacsservers";

  constructor() {
    const chrisObject: ChRISPACSGroup = new ChRISPACSGroup();
    this.baseGroupHandler = new BaseGroupHandler(this.assetName, chrisObject);
  }

  pacsServerCommand_setup(program: Command): void {
    const pacsServerCommand: Command = program
      .command(this.assetName)
      .description("Interact with PACS servers");

    const listCommand: Command = this.baseGroupHandler.baseListCommand_create(
      async (options: CLIoptions) => {
        await this.baseGroupHandler.resources_list(options);
      }
    );
    pacsServerCommand.addCommand(listCommand);

    pacsServerCommand
      .command("fieldslist")
      .description(`list the ${this.assetName} resource fields`)
      .action(async () => {
        await this.baseGroupHandler.resourceFields_list();
      });
  }
}
