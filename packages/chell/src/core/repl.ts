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
import { completer } from '../lib/completer/index.js';
import { settings } from '../config/settings.js';

/**
 * Handles the Read-Eval-Print Loop (REPL) interaction.
 */
export class REPL {
  private rl: readline.Interface;
  private isOpen: boolean = true;

  /**
   * Initializes the REPL interface.
   */
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> ',
      completer,
    });
  }

  /**
   * Starts the REPL loop.
   * @param commandHandler - Async function to process each input line.
   */
  async start(commandHandler: (line: string) => Promise<void>): Promise<void> {
    await this.history_load();
    await this.prompt_update();
    
    this.rl.on('line', async (line) => {
      await this.history_append(line);
      await commandHandler(line);
      // Only prompt if still open (command might have exited)
      if (this.isOpen) {
        await this.prompt_update();
      }
    });

    this.rl.on('close', () => {
      this.isOpen = false;
      console.log(chalk.cyan('Exiting ChELL. Goodbye!'));
      process.exit(0);
    });
  }
  
  // ...

  /**
   * Updates and redisplays the prompt based on current session state.
   */
  async prompt_update(): Promise<void> {
    if (!this.isOpen) return;
    
    const conn: typeof session.connection = session.connection;
    // ...
    const user: string | null = (await conn.authToken_get()) ? await conn.user_get() : 'disconnected';
    const uri: string | null = await conn.chrisURL_get();
    const cwd: string = await session.getCWD();
    
    const promptUser: string = user || 'disconnected';
    const promptUri: string = uri ? uri : 'no-cube'; // Use full URI
    const promptPath: string = cwd;

    this.rl.setPrompt(`${chalk.green(promptUser)}@${chalk.cyan(promptUri)}:${chalk.yellow(promptPath)}$ `);
    try {
      this.rl.prompt();
    } catch (e) {
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
        const lines: string[] = content.split('\n').filter((l) => l.trim()).reverse();
        const limit: number = settings.config.historySize;
        // Force cast to any to access history property if strict types block it, 
        // though it is part of the public API in recent Node versions.
        (this.rl as any).history = lines.slice(0, limit);
      } catch (e) {
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
    } catch (e) {
      // Silently fail if history cannot be saved
    }
  }
}
