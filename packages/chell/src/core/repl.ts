/**
 * @file REPL Logic.
 *
 * Manages the Read-Eval-Print Loop using Node.js readline.
 *
 * @module
 */
import * as readline from 'readline';
import chalk from 'chalk';
import { session } from '../session/index.js';

/**
 * Handles the Read-Eval-Print Loop (REPL) interaction.
 */
export class REPL {
  private rl: readline.Interface;

  /**
   * Initializes the REPL interface.
   */
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> ',
    });
  }

  /**
   * Starts the REPL loop.
   * @param commandHandler - Async function to process each input line.
   */
  async start(commandHandler: (line: string) => Promise<void>): Promise<void> {
    await this.prompt_update();
    
    this.rl.on('line', async (line) => {
      await commandHandler(line);
      await this.prompt_update();
    });

    this.rl.on('close', () => {
      console.log(chalk.cyan('Exiting ChELL. Goodbye!'));
      process.exit(0);
    });
  }

  /**
   * Closes the REPL.
   */
  close(): void {
    this.rl.close();
  }

  /**
   * Updates and redisplays the prompt based on current session state.
   */
  async prompt_update(): Promise<void> {
    const conn: typeof session.connection = session.connection;
    const user: string | null = (await conn.authToken_get()) ? await conn.user_get() : 'disconnected';
    const uri: string | null = await conn.chrisURL_get();
    const cwd: string = await session.getCWD();
    
    const promptUser: string = user || 'disconnected';
    const promptUri: string = uri ? new URL(uri).hostname : 'no-cube';
    const promptPath: string = cwd;

    this.rl.setPrompt(`${chalk.green(promptUser)}@${chalk.blue(promptUri)}:${chalk.yellow(promptPath)}$ `);
    this.rl.prompt();
  }
}
