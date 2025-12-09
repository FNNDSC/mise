/**
 * @file CLI Parser
 *
 * Extracts the logic for parsing command line arguments for `chell`.
 * This allows testing the argument parsing logic without side effects.
 *
 * @module
 */
import { Command } from 'commander';

export interface ChellCLIConfig {
  mode: 'interactive' | 'connect' | 'help' | 'version' | 'execute';
  physicalFS?: boolean;
  commandToExecute?: string;
  connectConfig?: {
    user?: string;
    password?: string;
    url?: string;
  };
  output?: string; // For help/version text
}

export function cli_parse(argv: string[], version: string): Promise<ChellCLIConfig> {
  return new Promise((resolve, reject) => {
    const program = new Command();
    let config: ChellCLIConfig = { mode: 'interactive' };

    program
      .name('chell')
      .version(version)
      .description('ChRIS Interactive Shell')
      .argument('[target]', 'Target CUBE (user@url or url)')
      .option('-u, --user <user>', 'Username')
      .option('-p, --password <password>', 'Password')
      .option('-c, --command <command>', 'Execute a single command and exit')
      .option('--physicalFS', 'Use physical filesystem paths (skip logical-to-physical mapping)')
      .addHelpText('after', `
Interactive Commands:
  connect    Connect to a ChRIS CUBE
  logout     Log out from ChRIS
  cd         Change directory
  ls         List directory contents
  pwd        Print working directory
  cat        Display file content
  chefs      Access ChRIS Experimental File System commands
  exit       Exit the shell
  <other>    Any other command is passed to chili

Shell Features:
  Pipes              Use | to chain commands: cat file.txt | wc -l
  Output Redirection Use > to write to file: cat file.txt > output.txt
                     Use >> to append to file: cat file.txt >> output.txt

Options:
  --physicalFS    Operate directly on physical paths without logical-to-physical mapping.
                  Use this for debugging or when working with physical ChRIS storage paths.
  -c, --command   Run a specific command and exit immediately (non-interactive mode).
      `)
      .action((target: string | undefined, options: { user?: string, password?: string, command?: string, physicalFS?: boolean }) => {
          let user: string | undefined = options.user;
          let url: string | undefined = target;
          let password: string | undefined = options.password;

          // Initialize connectConfig if connection args are present
          let connectConfig: { user?: string, password?: string, url?: string } | undefined;

          if (url && url.includes('@')) {
              const parts: string[] = url.split('@');
              user = parts[0];
              url = parts[1];
          }

          if (url) {
              if (!url.startsWith('http://') && !url.startsWith('https://')) {
                  url = 'http://' + url;
              }
              connectConfig = { user, password, url };
          }

          // Determine mode
          if (options.command) {
              config = {
                  mode: 'execute',
                  commandToExecute: options.command,
                  physicalFS: options.physicalFS,
                  connectConfig: connectConfig
              };
          } else if (connectConfig) {
              config = {
                  mode: 'connect',
                  physicalFS: options.physicalFS,
                  connectConfig: connectConfig
              };
          } else {
              config = {
                  mode: 'interactive',
                  physicalFS: options.physicalFS
              };
          }
      });

    // Capture help/version output instead of writing to stdout
    program.configureOutput({
      writeOut: (str) => { config = { mode: 'help', output: str }; },
      writeErr: (str) => { config = { mode: 'help', output: str }; },
      outputError: (str, write) => { config = { mode: 'help', output: str }; } // Override default error handling
    });
    
    // We need to handle exit events to prevent process.exit() during tests
    program.exitOverride((err) => {
        if (err.code === 'commander.helpDisplayed') {
            resolve({ mode: 'help', output: program.helpInformation() }); // Or capture from writeOut
        } else if (err.code === 'commander.version') {
            resolve({ mode: 'version', output: version });
        } else {
            // For other errors (e.g. missing arg), we might want to reject or return help
            resolve({ mode: 'help', output: err.message });
        }
        // We return a promise that never resolves here to stop execution flow in main? 
        // No, in `cli_parse` we resolve.
        throw err; // Rethrow to be caught by parseAsync catch block
    });

    program.parseAsync(argv)
      .then(() => {
          resolve(config);
      })
      .catch((err) => {
          // If exitOverride threw, we handled it above mostly?
          // Actually exitOverride throws.
          if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
             // config is already set via configureOutput hooks? 
             // Or we resolved?
             // If we resolve in exitOverride, the promise returned by parseAsync won't finish?
             // Actually exitOverride throws, so parseAsync promise rejects.
             // We catch here.
             if (config.mode === 'interactive') { 
                 // If mode wasn't set (e.g. version flag), set it.
                 // But for version, writeOut is called.
             }
             resolve(config);
          } else {
             // Real error
             // console.error(err.message);
             // For now, treat as help/error output
             resolve({ mode: 'help', output: err.message });
          }
      });
  });
}
