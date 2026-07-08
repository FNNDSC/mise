/**
 * @file REPL Logic.
 *
 * The CLI host around the chell engine: a readline loop that reads lines,
 * hands them to the engine, and owns the terminal-facing concerns (prompt,
 * history, output sink, interactive questions).
 *
 * @module
 */
import * as readline from 'readline';
import * as fs from 'fs';
import chalk from 'chalk';
import { session } from '../session/index.js';
import { settings } from '../config/settings.js';
import { context_getSingle } from '@fnndsc/salsa';
import { SingleContext } from '@fnndsc/cumin';
import { prompt_render, type PromptContext } from './prompt/index.js';
import { surface_set } from './surface.js';
import { cliSurface_create } from './cliSurface.js';
import { sink_set, StdoutSink } from './sink.js';
import { procCache_get, type ProcWarmupProgress } from '@fnndsc/cumin';
import type { ChellEngine, CompletionResult } from './engine.js';

/**
 * Handles the Read-Eval-Print Loop (REPL) interaction.
 */
/**
 * Options for the REPL host.
 *
 * @property promptText - A fixed prompt string to display instead of the
 *   locally-rendered themed prompt. Used by the remote client, whose session
 *   context lives in the daemon; the themed, pushed prompt arrives later.
 */
export interface ReplOptions {
  promptText?: string;
}

/**
 * Handles the Read-Eval-Print Loop (REPL) interaction.
 */
export class REPL {
  private rl: readline.Interface;
  private engine: ChellEngine;
  private isOpen: boolean = true;
  private lastCommandDurationMs: number = 0;
  private lastExitCode: number = 0;
  private promptText: string | undefined;

  /**
   * Initializes the REPL interface around an engine.
   *
   * @param engine - The engine that executes lines and answers completions.
   * @param options - Optional host settings (e.g. a fixed prompt string).
   */
  constructor(engine: ChellEngine, options?: ReplOptions) {
    this.engine = engine;
    this.promptText = options?.promptText;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> ',
      completer: (line: string, callback: (err: Error | null, result: [string[], string]) => void): void => {
        this.engine.line_complete(line)
          .then((result: CompletionResult) => callback(null, [result.candidates, result.prefix]))
          .catch(() => callback(null, [[], line]));
      },
    });
  }

  /**
   * Starts the REPL loop, executing each input line through the engine.
   */
  async start(): Promise<void> {
    // The REPL is the host that owns the interaction channels: command output
    // reaches the terminal through the sink it installs, and interactive
    // prompts run through the surface it installs — both backed by the REPL's
    // single readline interface, so builtins never assume a terminal exists.
    sink_set(new StdoutSink());
    surface_set(cliSurface_create(this.rl));

    await this.history_load();
    await this.prompt_update();

    this.rl.on('line', async (line: string) => {
      await this.history_append(line);

      const startMs: number = Date.now();
      process.exitCode = 0;
      await this.engine.line_execute(line);
      this.lastCommandDurationMs = Date.now() - startMs;
      this.lastExitCode = (process.exitCode as number | undefined) ?? 0;

      if (this.isOpen) {
        await this.prompt_update();
      }
    });

    this.rl.on('SIGINT', () => {
      // Ctrl+C cancels the current input line and re-prompts — does not exit.
      process.stdout.write('\n');
      readline.clearLine(process.stdout, 0);
      this.prompt_update();
    });

    this.rl.on('close', () => {
      this.isOpen = false;
      console.log(chalk.cyan('Exiting ChELL. Goodbye!'));
      process.exit(0);
    });
  }

  /**
   * Updates and redisplays the prompt based on current session state.
   */
  async prompt_update(): Promise<void> {
    if (!this.isOpen) return;

    // A fixed prompt (the remote client) skips local context rendering: the
    // session lives in the daemon, not this process.
    if (this.promptText !== undefined) {
      this.rl.setPrompt(this.promptText);
      try {
        this.rl.prompt();
      } catch (e: unknown) {
        // Interface might be closed
      }
      return;
    }

    const context: SingleContext = await context_getSingle();
    const cwd: string = await session.getCWD();
    const isOffline: boolean = session.offline;

    const warmupRaw: ProcWarmupProgress = procCache_get().warmupProgress_get();
    const procWarmup: { loaded: number } | undefined =
      warmupRaw.active ? { loaded: warmupRaw.loaded } : undefined;

    const ctx: PromptContext = {
      user:                 isOffline ? 'disconnected' : (context.user ?? 'disconnected'),
      uri:                  isOffline ? 'no-cube'      : (context.URL  ?? 'no-cube'),
      cwd:                  isOffline ? '/'            : cwd,
      pacsserver:           context.pacsserver ?? null,
      physicalMode:         session.physicalMode_get(),
      terminalWidth:        process.stdout.columns || 80,
      lastExitCode:         this.lastExitCode,
      lastCommandDurationMs: this.lastCommandDurationMs,
      p10kSegments:         settings.config.p10kSegments,
      procWarmup,
    };

    this.rl.setPrompt(prompt_render(settings.config.promptTheme, ctx));
    try {
      this.rl.prompt();
    } catch (e: unknown) {
      // Interface might be closed
    }
  }

  /**
   * Loads command history from file.
   */
  private async history_load(): Promise<void> {
    const file: string = settings.config.historyFile;
    if (fs.existsSync(file)) {
      try {
        const content: string = await fs.promises.readFile(file, 'utf-8');
        const lines: string[] = content.split('\n').filter((l: string) => l.trim()).reverse();
        const limit: number = settings.config.historySize;
        (this.rl as unknown as { history: string[] }).history = lines.slice(0, limit);
      } catch (e: unknown) {
        // Silently fail if history cannot be loaded
      }
    }
  }

  /**
   * Appends a command to the history file.
   * @param line - The command line to append.
   */
  private async history_append(line: string): Promise<void> {
    if (!line.trim()) return;
    const file: string = settings.config.historyFile;
    try {
      await fs.promises.appendFile(file, line + '\n');
    } catch (e: unknown) {
      // Silently fail if history cannot be saved
    }
  }
}
