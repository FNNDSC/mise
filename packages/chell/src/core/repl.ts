/**
 * @file REPL Logic.
 *
 * Manages the Read-Eval-Print Loop using Node.js readline.
 *
 * @module
 */
import * as readline from 'readline';
import * as fs from 'fs';
import chalk from 'chalk';
import { session } from '../session/index.js';
import { input_complete } from '../lib/completer/index.js';
import { settings } from '../config/settings.js';
import { context_getSingle } from '@fnndsc/salsa';
import { SingleContext } from '@fnndsc/cumin';
import { prompt_render, type PromptContext } from './prompt/index.js';
import { repl_questionRegister } from './question.js';

/**
 * Handles the Read-Eval-Print Loop (REPL) interaction.
 */
export class REPL {
  private rl: readline.Interface;
  private isOpen: boolean = true;
  private lastCommandDurationMs: number = 0;
  private lastExitCode: number = 0;

  /**
   * Initializes the REPL interface.
   */
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> ',
      completer: input_complete,
    });
  }

  /**
   * Starts the REPL loop.
   * @param commandHandler - Async function to process each input line.
   */
  async start(commandHandler: (line: string) => Promise<void>): Promise<void> {
    repl_questionRegister(
      (prompt: string): Promise<string> =>
        new Promise((resolve: (answer: string) => void) => {
          this.rl.question(prompt, (answer: string) => resolve(answer.trim()));
        }),
      (prompt: string): Promise<string> => {
        // Pause the REPL readline so it doesn't consume the chars, then read
        // via raw-mode stdin with echo suppressed.
        this.rl.pause();
        process.stdout.write(prompt);
        return new Promise((resolve: (answer: string) => void) => {
          const chars: string[] = [];
          const onData = (chunk: Buffer): void => {
            const key: string = chunk.toString();
            if (key === '\r' || key === '\n') {
              process.stdin.removeListener('data', onData);
              if (process.stdin.isTTY) process.stdin.setRawMode(false);
              process.stdout.write('\n');
              this.rl.resume();
              resolve(chars.join('').trim());
            } else if (key === '') { // Ctrl+C
              process.stdin.removeListener('data', onData);
              if (process.stdin.isTTY) process.stdin.setRawMode(false);
              process.stdout.write('\n');
              this.rl.resume();
              resolve('');
            } else if (key === '' || key === '\b') { // backspace
              chars.pop();
            } else if (key.charCodeAt(0) >= 0x20) {
              chars.push(key);
            }
          };
          if (process.stdin.isTTY) process.stdin.setRawMode(true);
          process.stdin.resume();
          process.stdin.on('data', onData);
        });
      }
    );

    await this.history_load();
    await this.prompt_update();

    this.rl.on('line', async (line) => {
      await this.history_append(line);

      const startMs: number = Date.now();
      process.exitCode = 0;
      await commandHandler(line);
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

    const context: SingleContext = await context_getSingle();
    const cwd: string = await session.getCWD();
    const isOffline: boolean = session.offline;

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
