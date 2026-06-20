/**
 * @file Terminal spinner utility for long-running operations.
 *
 * @module
 */

import chalk from 'chalk';

/**
 * Terminal spinner indicating progress of async work.
 */
export class Spinner {
  private interval: NodeJS.Timeout | null = null;
  private message: string = '';
  private frames: string[] = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
  private frameIndex: number = 0;
  private spinnerActive: boolean = false;
  private startTime: number = 0;
  private showTiming: boolean = false;

  constructor(initialMessage: string = 'Loading...') {
    this.message = initialMessage;
  }

  public start(message?: string, showTiming: boolean = false): void {
    // Do not start spinner if not in a TTY (e.g. piped output)
    if (!process.stdout.isTTY) {
      return;
    }

    if (this.spinnerActive) {
      this.stop(); // Stop any existing spinner
    }
    this.message = message || this.message;
    this.spinnerActive = true;
    this.frameIndex = 0;
    this.showTiming = showTiming;
    this.startTime = Date.now();

    // Hide cursor
    process.stdout.write('\x1B[?25l');

    this.interval = setInterval(() => {
      const frame: string = this.frames[this.frameIndex = (this.frameIndex + 1) % this.frames.length];
      let displayMessage: string = this.message;

      // Add timing if enabled
      if (this.showTiming) {
        const elapsedSeconds: string = ((Date.now() - this.startTime) / 1000).toFixed(1);
        displayMessage = `${this.message} (${elapsedSeconds}s)`;
      }

      // Note: We use chalk.gray for the message to match the existing "Fetching..." style
      process.stdout.write(`\r${chalk.bgBlack.cyanBright.bold(frame)} ${chalk.gray(displayMessage)}`);
    }, 80);
  }

  public stop(clearLine: boolean = true): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.spinnerActive) {
      if (clearLine) {
        process.stdout.write('\r\x1b[K'); // Clear line
      }
      // Show cursor
      process.stdout.write('\x1B[?25h');
      this.spinnerActive = false;
    }
  }

  public updateMessage(newMessage: string): void {
    this.message = newMessage;
  }
}

const globalSpinner: Spinner = new Spinner();
export { globalSpinner as spinner };
