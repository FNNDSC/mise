/**
 * @file Boot, connection, and REPL startup for the ChELL shell.
 *
 * Holds the process-lifecycle glue that sits around the command dispatcher:
 * - self/dependency package.json loading and the boot info panels
 * - password prompting and ChRIS connection establishment (CLI args or saved session)
 * - engine creation and cache prefetch
 * - the interactive session runner and `chell_start` entrypoint
 *
 * The parse/dispatch logic it drives lives in `../chell.js`.
 *
 * @module
 */
import * as readline from 'readline';
import * as os from 'os';
import { readFileSync, existsSync } from 'fs';
import { Writable } from 'stream';
import chalk from 'chalk';
import { REPL } from './repl.js';
import { session } from '@fnndsc/brasa';
import { Result, Ok, Err, Client } from '@fnndsc/cumin';
import { spinner } from '@fnndsc/brasa';
import { logo_print, logo_animatePulse, logo_animateStop } from '../lib/logo.js';
import {
  BootInfoItem,
  BootInfoItem3,
  BootPanels,
  bootLogger_create,
  bootsequence_printIntroPanelsStacked
} from '../lib/bootsequence.js';
import { settings_load } from '../config/settings.js';
import { cli_parse, ChellCLIConfig } from './cli.js';
import { bootFlags_compute, type BootFlags } from './bootFlags.js';
import { context_getSingle } from '@fnndsc/salsa';
import { chrisContext, Context, SingleContext } from '@fnndsc/cumin';
import { engine_create, stopOnError_set, type BrasaEngine } from '@fnndsc/brasa';
import { sessionConnect_fromSaved, type SavedSessionResult } from '@fnndsc/brasa';
import { surface_set } from '@fnndsc/brasa';
import { cliSurface_create } from './cliSurface.js';
import { surfaceLine_execute } from './surfaceDispatch.js';
import { versionReport_build, infoReport_build, stackInfo_get, type PackageInfo } from '@fnndsc/brasa';
import {
  daemonSession_run,
  startupWarmup_run,
  type StartupWarmupCache,
  type StartupWarmupFlags,
} from './startupWarmup.js';

/**
 * Extended Writable stream with muted property for password input.
 */
interface MutableWritable extends Writable {
  muted?: boolean;
}

/**
 * Prompts the user for a password without echoing input.
 *
 * @param user - The username.
 * @param url - The CUBE URL.
 * @returns A Promise resolving to the password string.
 */
async function password_prompt(user: string, url: string): Promise<string> {
  return new Promise((resolve) => {
    const mutableStdout: MutableWritable = new Writable({
      write: function(chunk, encoding, callback) {
        if (!(this as MutableWritable).muted)
          process.stdout.write(chunk, encoding);
        callback();
      }
    });

    const rl: readline.Interface = readline.createInterface({
      input: process.stdin,
      output: mutableStdout,
      terminal: true
    });

    mutableStdout.muted = false;
    process.stdout.write(`Password for ${user}@${url}: `);
    mutableStdout.muted = true;

    rl.question('', (password: string) => {
      rl.close();
      console.log(''); // Add newline after entry
      resolve(password);
    });
  });
}

/**
 * Assemble and render the Neofetch-style boot info panels.
 *
 * @param context    - Current ChRIS session context.
 * @param mode       - Shell mode string (e.g. 'interactive').
 * @param cache      - Prefetch counts for the panel's ChRIS section.
 * @param useAsciiBoot - Render ASCII box-drawing instead of Unicode.
 */
function bootPanels_render(
  context: SingleContext,
  mode: string,
  cache: StartupWarmupCache,
  useAsciiBoot: boolean,
): void {
  const headerItems: BootInfoItem3[] = stackInfo_get().map(
    (i: PackageInfo): BootInfoItem3 => ({ app: i.pkg, name: i.name, version: i.version }),
  );

  const localItems: BootInfoItem[] = [
    { label: 'System', value: `${os.platform()} ${os.release()} (${os.arch()})` },
    { label: 'User',   value: `${os.userInfo().username}@${os.hostname()}` },
    ...(localIPv4_get() ? [{ label: 'Local', value: localIPv4_get() as string }] : []),
    { label: 'Time',   value: localTime_withOffset() },
  ];

  const maxItemLen: number = Math.max(30, (process.stdout.columns || 100) - 20);
  const str_truncate = (s: string): string => s.length > maxItemLen ? `…${s.slice(-(maxItemLen - 1))}` : s;

  const chrisItems: BootInfoItem[] = [
    { label: 'ChRIS', value: str_truncate(context.URL || 'offline') },
    { label: 'User',  value: context.user || 'offline' },
    { label: 'Mode',  value: mode },
  ];

  if (typeof cache.plugins   === 'number') chrisItems.push({ label: 'Plugins',      value: `${cache.plugins}`   });
  if (typeof cache.pipelines === 'number') chrisItems.push({ label: 'Pipelines',    value: `${cache.pipelines}` });
  if (context.plugin)                      chrisItems.push({ label: 'Active Plugin', value: context.plugin       });
  if (typeof cache.feeds     === 'number') chrisItems.push({ label: 'User Feeds',   value: `${cache.feeds}`     });
  if (context.feed)                        chrisItems.push({ label: 'Active Feed',  value: `${context.feed}`    });
  if (typeof cache.public    === 'number') chrisItems.push({ label: 'Public Feeds', value: `${cache.public}`    });
  if (context.pacsserver)                  chrisItems.push({ label: 'PACS Server',  value: context.pacsserver   });

  chrisItems.push({ label: 'Path', value: str_truncate(context.folder ?? '/') });

  const panels: BootPanels = { header: headerItems, local: localItems, chris: chrisItems };
  bootsequence_printIntroPanelsStacked([], panels, !useAsciiBoot, useAsciiBoot);
}

/**
 * Returns the first non-internal IPv4 address of the local machine, or null if none found.
 */
function localIPv4_get(): string | null {
  const interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces();
  for (const key of Object.keys(interfaces)) {
    const iface: os.NetworkInterfaceInfo[] | undefined = interfaces[key];
    if (!iface) continue;
    for (const entry of iface) {
      if (entry.family === 'IPv4' && !entry.internal && entry.address) {
        return entry.address;
      }
    }
  }
  return null;
}

/**
 * Returns the current local date/time as `YYYY-MM-DD HH:MM:SS ±HH:MM`.
 */
function localTime_withOffset(): string {
  const now: Date = new Date();
  const offsetMinutes: number = now.getTimezoneOffset();
  const sign: string = offsetMinutes <= 0 ? '+' : '-';
  const absMinutes: number = Math.abs(offsetMinutes);
  const hours: number = Math.floor(absMinutes / 60);
  const minutes: number = absMinutes % 60;
  const pad = (n: number): string => n.toString().padStart(2, '0');
  const offsetStr: string = `${sign}${pad(hours)}:${pad(minutes)}`;
  const dateStr: string = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeStr: string = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return `${dateStr} ${timeStr} ${offsetStr}`;
}

/**
 * Executes a chell script file.
 * Reads the file line by line, ignoring comments and blank lines.
 * Supports shebang (#!) on first line.
 *
 * @param engine - The engine that executes each line.
 * @param scriptPath - Path to the script file.
 * @param stopOnError - Whether to stop execution on first error (default: false).
 * @returns A Promise that resolves when script execution completes.
 *
 * @example
 * ```typescript
 * await script_execute(engine, '/path/to/script.chell', false);
 * ```
 */
async function script_execute(engine: BrasaEngine, scriptPath: string, stopOnError: boolean = false): Promise<void> {
  if (!existsSync(scriptPath)) {
    console.error(chalk.red(`Error: Script file not found: ${scriptPath}`));
    process.exit(1);
  }

  // Set global stop-on-error flag
  stopOnError_set(stopOnError);

  const scriptContent: string = readFileSync(scriptPath, 'utf8');
  const lines: string[] = scriptContent.split('\n');

  for (let i: number = 0; i < lines.length; i++) {
    let line: string = lines[i].trim();

    // Skip shebang on first line
    if (i === 0 && line.startsWith('#!')) {
      continue;
    }

    // Skip comment lines and blank lines
    if (line.startsWith('#') || line === '') {
      continue;
    }

    // Execute the line
    try {
      await surfaceLine_execute(engine, line);
    } catch (error: unknown) {
      const msg: string = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Error on line ${i + 1}: ${msg}`));

      if (stopOnError) {
        console.error(chalk.red('Stopping execution due to error (use without -e to continue on error)'));
        process.exit(1);
      }
      // Otherwise continue to next line
    }

    // Builtins report failure through process.exitCode rather than throwing.
    if (stopOnError && process.exitCode) {
      console.error(chalk.red(`Stopping execution: command on line ${i + 1} failed (use without -e to continue on error)`));
      process.exit(1);
    }
  }

  // Reset flag; a failed command's exit code survives to process exit.
  stopOnError_set(false);
}

type BootLogger = ReturnType<typeof bootLogger_create>;

/**
 * Connect using explicit CLI credentials. Returns Err() on unrecoverable failure.
 */
async function connection_fromArgs(
  config: ChellCLIConfig,
  boot: BootLogger | null,
): Promise<Result<SingleContext>> {
  let { user, password, url } = config.connectConfig!;

  if (!user) {
    console.error(chalk.red('Error: Username required when connecting via CLI args.'));
    return Err();
  }

  if (!password && url && config.mode !== 'execute' && config.mode !== 'script') {
    password = await password_prompt(user, url);
  }

  if (!password && config.mode === 'execute') {
    console.error(chalk.red('Error: Password required for connection in execute mode.'));
    return Err();
  }

  if (!url || !password) {
    return Ok(await context_getSingle());
  }

  spinner.start(`Establishing uplink to ${url}`);
  try {
    await session.connection.connection_connect({ user: user!, password, url, debug: false });
    session.offline = false;
    await chrisContext.current_set(Context.ChRISuser, user!);
    await chrisContext.current_set(Context.ChRISURL, url);
    await chrisContext.current_set(Context.ChRISfolder, '/');
    await chrisContext.current_set(Context.ChRISfeed, '');
    await chrisContext.current_set(Context.ChRISplugin, '');
    spinner.stop();
    if (config.mode !== 'execute' && config.mode !== 'script') {
      console.log(chalk.green('[+] Connection established.'));
    }
    boot?.log('ok', 'Connect', `Connected to ${url}`);
    return Ok(await context_getSingle());
  } catch (error: unknown) {
    spinner.stop();
    const errorMessage: string = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`[!] Connection failed: ${errorMessage}`));
    boot?.log('fail', 'Connect', errorMessage);
    return Err();
  }
}

/**
 * Restore a saved session from disk. Always succeeds — falls back to offline mode.
 */
async function connection_fromSavedSession(
  config: ChellCLIConfig,
  boot: BootLogger | null,
): Promise<SingleContext> {
  const verbose: boolean = config.mode !== 'execute' && config.mode !== 'script';

  spinner.start('Validating saved session');
  const result: SavedSessionResult = await sessionConnect_fromSaved();
  spinner.stop();

  const ctx: SingleContext = result.context;
  const reconnectHint = (): void =>
    console.log(chalk.gray(`    Use: connect --user ${ctx.user} --password <pwd> ${ctx.URL}`));

  switch (result.status) {
    case 'no-context':
      if (verbose) console.log(chalk.yellow('[!] No previous context found'));
      break;
    case 'no-token':
      console.log(chalk.yellow('[!] No token found'));
      console.log(chalk.yellow('[!] Running in disconnected mode'));
      reconnectHint();
      boot?.log('skip', 'Session', 'No saved token; offline');
      break;
    case 'no-client':
      console.log(chalk.yellow('[!] Failed to create client'));
      console.log(chalk.yellow('[!] Running in disconnected mode'));
      reconnectHint();
      break;
    case 'invalid-token':
      console.log(chalk.yellow('[!] Token expired or invalid'));
      if (result.error) console.log(chalk.gray(`    Error: ${result.error}`));
      console.log(chalk.yellow('[!] Running in disconnected mode'));
      reconnectHint();
      break;
    case 'restored':
      if (verbose) {
        console.log(chalk.green('[+] Previous context detected'));
        console.log(chalk.gray(`    User: ${chalk.cyan(ctx.user)}`));
        console.log(chalk.gray(`    URL:  ${chalk.cyan(ctx.URL)}`));
        console.log(chalk.green('[+] Token validated with server'));
        console.log(chalk.green('[+] Session restored'));
        boot?.log('ok', 'Session', `Restored ${ctx.user}@${ctx.URL}`);
      }
      break;
  }

  return ctx;
}

/**
 * Establish a ChRIS connection: explicit CLI args or saved session restore.
 *
 * @param config - Parsed CLI config.
 * @param boot   - Boot logger; null in non-interactive modes.
 * @returns Ok(context) on success; Err() on unrecoverable failure (caller should exit).
 */
async function connection_establish(
  config: ChellCLIConfig,
  boot: BootLogger | null,
): Promise<Result<SingleContext>> {
  if (config.connectConfig) {
    return await connection_fromArgs(config, boot);
  }

  const ctx: SingleContext = await connection_fromSavedSession(config, boot);
  if (!ctx.user || !ctx.URL) {
    if (!session.offline) {
      console.log(chalk.yellow('[!] Running in disconnected mode.'));
      session.offline = true;
    }
  }
  return Ok(ctx);
}

/**
 * Runs the interactive session: prefetches the boot cache, renders the boot
 * panels and greeting, kicks off non-blocking topology warm-up, and enters the
 * REPL loop.
 *
 * @param engine - The engine the REPL hosts.
 * @param config - The parsed CLI config.
 * @param currentContext - The resolved session context.
 * @param flags - Prefetch/interactivity boot flags.
 * @param boot - The boot logger, or null when non-interactive.
 */
async function interactiveSession_run(
  engine: BrasaEngine,
  config: ChellCLIConfig,
  currentContext: SingleContext,
  flags: Pick<BootFlags, 'prefetchPlugins' | 'prefetchFeeds' | 'prefetchPublicFeeds' | 'prefetchJobs' | 'isInteractiveSession' | 'useAsciiBoot'>,
  boot: ReturnType<typeof bootLogger_create> | null,
): Promise<void> {
  const warmupFlags: StartupWarmupFlags = {
    plugins: flags.prefetchPlugins,
    feeds: flags.prefetchFeeds,
    publicFeeds: flags.prefetchPublicFeeds,
    jobs: flags.prefetchJobs,
  };
  const cache: StartupWarmupCache = await startupWarmup_run(
    warmupFlags,
    currentContext.user ?? undefined,
    flags.isInteractiveSession,
    boot,
  );

  if (flags.isInteractiveSession) {
    logo_animateStop();
    bootPanels_render(
      currentContext,
      config.mode,
      cache,
      flags.useAsciiBoot,
    );
  }

  console.log(chalk.yellow('Order up! Your Taco Chell is ready! Filled with chili, salsa, and cumin goodness! 🌮'));
  console.log('');
  if (flags.isInteractiveSession) {
    if (session.offline) {
      console.log(chalk.yellow('You are currently disconnected. Use: connect --user <user> --password <pwd> <url>'));
    }
    console.log(chalk.gray("Tip: type 'help' for available commands."));
    console.log('');
  }

  const repl: REPL = new REPL(engine);
  await repl.start();
}

/**
 * Starts the ChELL REPL.
 * Initializes connection and enters the command loop.
 *
 * @param argv - The argument vector to parse. Defaults to `process.argv`; the
 *   `calypso` entry passes an argv with daemon mode forced in.
 * @returns A Promise that resolves when the shell exits.
 */
export async function chell_start(argv: string[] = process.argv): Promise<void> {
  const config: ChellCLIConfig = await cli_parse(argv, versionReport_build(), infoReport_build());
  const {
    isInteractiveSession,
    useAsciiBoot,
    prefetchPlugins,
    prefetchFeeds,
    prefetchPublicFeeds,
    prefetchJobs,
    showLogo,
  }: BootFlags = bootFlags_compute(config, !!process.stdout.isTTY);
  const boot: ReturnType<typeof bootLogger_create> | null = isInteractiveSession ? bootLogger_create('ChELL Boot', useAsciiBoot) : null;

  if (config.mode === 'help' || config.mode === 'version' || config.mode === 'info') {
    if (config.output) console.log(config.output);
    return;
  }

  // --- Common Initialization ---

  if (isInteractiveSession) {
    logo_print(showLogo && !useAsciiBoot);
  }

  await settings_load();

  // --- Remote Mode ---
  // A remote surface attaches to a daemon and drives it with the ordinary
  // REPL; it needs no local engine, session, or CUBE connection.
  if (config.mode === 'remote') {
    const { remote_run } = await import('../remote/client.js');
    const { identity_forSession } = await import('@fnndsc/calypso');
    const cc: { user?: string; url?: string } | undefined = config.connectConfig;
    // A `<user>@<url>` target names the identity to attach to; a bare `--remote`
    // resolves the sole/most-suitable berth (identity undefined).
    const identity: string | undefined = cc?.user && cc?.url ? identity_forSession(cc.user, cc.url) : undefined;
    await remote_run(identity);
    return;
  }

  // Install the CLI surface so builtins can prompt in every mode. The REPL
  // reinstalls a surface backed by its persistent readline interface for
  // interactive use; execute and script modes keep this one-shot surface.
  surface_set(cliSurface_create());

  spinner.start('Initializing session components');
  const engine: BrasaEngine = await engine_create();
  spinner.stop();

  if (isInteractiveSession) {
    console.log(chalk.green('[+] Session initialized.'));
    boot?.log('ok', 'Session', 'Components initialized');
  }

  // Set physical filesystem mode if requested
  if (config.physicalFS) {
    session.physicalMode_set(true);
    if (config.mode !== 'execute' && config.mode !== 'script') {
      console.log(chalk.yellow('[!] Physical filesystem mode enabled - logical-to-physical mapping disabled'));
    }
  }

  const ctxResult: Result<SingleContext> = await connection_establish(config, boot);
  if (!ctxResult.ok) process.exit(1);
  let currentContext: SingleContext = ctxResult.value;
  if (!currentContext.folder) {
    currentContext = { ...currentContext, folder: '/' };
  }

  // Login phase complete — start the brain activity animation now
  if (isInteractiveSession && showLogo && !useAsciiBoot) {
    logo_animatePulse();
  }


  // --- Daemon Mode ---
  // Host the connected engine over WebSocket and stay alive on the server.
  if (config.mode === 'daemon') {
    const warmupFlags: StartupWarmupFlags = {
      plugins: prefetchPlugins,
      feeds: prefetchFeeds,
      publicFeeds: prefetchPublicFeeds,
      jobs: prefetchJobs,
    };
    await daemonSession_run(
      engine,
      currentContext.user ?? undefined,
      warmupFlags,
      isInteractiveSession,
      boot ?? bootLogger_create('ChELL Boot', useAsciiBoot),
    );
    return;
  }

  // --- Execution Mode ---

  if (config.mode === 'execute' && config.commandToExecute) {
    // Set stop-on-error flag if requested
    if (config.stopOnError) {
      stopOnError_set(true);
    }
    await surfaceLine_execute(engine, config.commandToExecute);
    process.exit(process.exitCode ?? 0);
  }

  // --- Script Mode ---

  if (config.mode === 'script' && config.scriptFile) {
    await script_execute(engine, config.scriptFile, config.stopOnError || false);
    process.exit(0);
  }

  // --- Interactive Mode ---

  await interactiveSession_run(
    engine,
    config,
    currentContext,
    { prefetchPlugins, prefetchFeeds, prefetchPublicFeeds, prefetchJobs, isInteractiveSession, useAsciiBoot },
    boot,
  );
}
