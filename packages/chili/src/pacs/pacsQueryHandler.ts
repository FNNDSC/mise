/**
 * @file Handler for the PACS query command group.
 *
 * @module
 */

import { Command } from "commander";
import {
  ChRISPACSQueryGroup,
  PACSQueryListOptions,
  PACSQueryCreateData,
  Result,
  FilteredResourceData,
  errorStack_getAllOfType,
  chrisContext,
  Context,
  PACSQueryRecord,
  PACSQueryDecodedResult,
} from "@fnndsc/cumin";
import { pacsQueries_list, pacsQueries_create, pacsQuery_resultDecode } from "@fnndsc/salsa";
import { BaseGroupHandler } from "../handlers/baseGroupHandler.js";
import { CLIoptions } from "../utils/cli.js";
import { border_draw } from "../screen/screen.js";
import { pacsQueryResult_renderPretty } from "./pacsResultRender.js";
import { pacsQueryPayload_build } from "./pacsQueryPayload.js";
import { chiliLog } from "../screen/output.js";

/**
 * Handler for PACS queries commands.
 */
export class PACSQueryGroupHandler {
  private baseGroupHandler: BaseGroupHandler;
  private assetName: string = "pacsqueries";

  constructor() {
    const chrisObject: ChRISPACSQueryGroup = new ChRISPACSQueryGroup();
    this.baseGroupHandler = new BaseGroupHandler(this.assetName, chrisObject);
  }

  /**
   * Render a decoded PACS query JSON payload into a readable string.
   * Expected structure:
   * [
   *   { <study fields>, series: [ { <series fields> }, ... ] },
   *   ...
   * ]
   * Falls back gracefully if structure varies.
   */
  private pacsResult_renderPretty(payload: unknown): string | null {
    return pacsQueryResult_renderPretty(payload);
  }

  private async pacsserverContext_resolve(
    overridePacsserver?: string
  ): Promise<string | null> {
    if (overridePacsserver && overridePacsserver.length > 0) {
      return overridePacsserver;
    }
    const current: string | null = await chrisContext.current_get(Context.PACSserver);
    return current;
  }

  private options_withPACSFilter(
    options: CLIoptions,
    pacsserver: string | null
  ): CLIoptions {
    if (!pacsserver) {
      return options;
    }
    const pacsFilter: string = /^\d+$/.test(pacsserver)
      ? `pacs_id:${pacsserver}`
      : `pacs_identifier:${pacsserver}`;
    const searchParts: string[] = [];
    if (options.search) {
      searchParts.push(options.search);
    }
    searchParts.push(pacsFilter);
    return { ...options, search: searchParts.join(",") };
  }

  pacsQueryCommand_setup(program: Command): void {
    const pacsQueryCommand: Command = program
      .command(this.assetName)
      .description("Interact with PACS queries");

    this.listCommand_register(pacsQueryCommand);
    this.fieldsListCommand_register(pacsQueryCommand);
    this.createCommand_register(pacsQueryCommand);
    this.decodeCommand_register(pacsQueryCommand);
  }

  /**
   * Registers the `list` subcommand (with PACS-server context filtering).
   *
   * @param parent - The parent `pacsqueries` command.
   */
  private listCommand_register(parent: Command): void {
    const listCommand: Command = this.baseGroupHandler.baseListCommand_create(
      async (options: CLIoptions & { pacsserver?: string }) => {
        const pacsserver: string | null = await this.pacsserverContext_resolve(
          options.pacsserver
        );
        if (!pacsserver) {
          chiliLog(
            border_draw("No PACS server in context. Use --pacsserver or set via context.")
          );
          return;
        }
        const mergedOptions: CLIoptions = this.options_withPACSFilter(
          options,
          pacsserver
        );
        await this.baseGroupHandler.resources_list(mergedOptions);
      }
    );
    listCommand.option(
      "--pacsserver <pacsserver>",
      "PACS server ID or identifier to filter queries"
    );
    parent.addCommand(listCommand);
  }

  /**
   * Registers the `fieldslist` subcommand.
   *
   * @param parent - The parent `pacsqueries` command.
   */
  private fieldsListCommand_register(parent: Command): void {
    parent
      .command("fieldslist")
      .description(`list the ${this.assetName} resource fields`)
      .action(async () => {
        await this.baseGroupHandler.resourceFields_list();
      });
  }

  /**
   * Registers the `create <query>` subcommand.
   *
   * @param parent - The parent `pacsqueries` command.
   */
  private createCommand_register(parent: Command): void {
    parent
      .command("create <query>")
      .description(
        "Create a PACS query against the current or specified PACS server. <query> can be JSON or comma-separated key:value pairs."
      )
      .option("--title <title>", "Title for the PACS query", `Query ${Date.now()}`)
      .option(
        "--description <description>",
        "Optional description for the PACS query"
      )
      .option(
        "--pacsserver <pacsserver>",
        "PACS server ID or identifier (overrides context)"
      )
      .action(async (queryInput: string, options: CLIoptions & { title?: string; description?: string; pacsserver?: string }) => {
        const pacsserver: string | null = await this.pacsserverContext_resolve(
          options.pacsserver
        );
        if (!pacsserver) {
          border_draw("No PACS server in context. Use --pacsserver or set via context.");
          return;
        }

        const payload: PACSQueryCreateData | null = pacsQueryPayload_build(
          queryInput,
          options.title,
          options.description
        );
        if (!payload) {
          chiliLog(
            border_draw("Invalid query format. Provide JSON or comma-separated key:value pairs.")
          );
          return;
        }

        const result: Result<PACSQueryRecord> = await pacsQueries_create(pacsserver, payload);
        if (!result.ok) {
          const errors: string[] = errorStack_getAllOfType("error");
          if (errors.length) {
            errors.forEach((msg: string) => chiliLog(border_draw(msg)));
          } else {
            chiliLog(border_draw("Failed to create PACS query."));
          }
          return;
        }
        const created: PACSQueryRecord = result.value;
        const msg: string = [
          "Created PACS query",
          `id=${created.id}`,
          `status=${created.status || "unknown"}`,
          `pacs=${pacsserver}`,
          `title="${created.title ?? options.title ?? ""}"`,
        ].join(" ");
        chiliLog(border_draw(msg.trim()));
      });
  }

  /**
   * Registers the `decode <queryId>` subcommand.
   *
   * @param parent - The parent `pacsqueries` command.
   */
  private decodeCommand_register(parent: Command): void {
    parent
      .command("decode <queryId>")
      .description("Decode the result payload of a PACS query")
      .option("--raw", "Print raw decoded JSON if available")
      .action(async (queryId: string, options: { raw?: boolean }) => {
        const idNum: number = Number(queryId);
        if (Number.isNaN(idNum)) {
          chiliLog(border_draw("queryId must be a number."));
          return;
        }
        const result: Result<PACSQueryDecodedResult> = await pacsQuery_resultDecode(idNum);
        if (!result.ok) {
          const errors: string[] = errorStack_getAllOfType("error");
          if (errors.length) {
            errors.forEach((msg: string) => chiliLog(border_draw(msg)));
          } else {
            chiliLog(border_draw(`Failed to decode PACS query result for ${idNum}.`));
          }
          return;
        }
        const decoded: PACSQueryDecodedResult = result.value;
        // Prefer JSON, then text, else indicate base64 length
        if (decoded.json !== undefined) {
          if (options.raw) {
            chiliLog(border_draw(JSON.stringify(decoded.json, null, 2)));
            return;
          }
          const pretty: string | null = this.pacsResult_renderPretty(decoded.json);
          if (pretty) {
            chiliLog(border_draw(pretty));
          } else {
            chiliLog(border_draw(JSON.stringify(decoded.json, null, 2)));
          }
        } else if (decoded.text) {
          chiliLog(border_draw(decoded.text));
        } else {
          const len: number = decoded.raw.length;
          chiliLog(
            border_draw(`Decoded payload available (base64 length ${len}), but not printable.`)
          );
        }
      });
  }

  /**
   * Build a PACS query payload from JSON or comma-separated key:value pairs.
   */
  private queryPayload_build(
    queryInput: string,
    title?: string,
    description?: string
  ): PACSQueryCreateData | null {
    return pacsQueryPayload_build(queryInput, title, description);
  }
}
