import chalk from 'chalk';

export class Spinner {
  private interval: NodeJS.Timeout | null = null;
  private message: string = '';
  private frames: string[] = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
  private frameIndex: number = 0;
  private spinnerActive: boolean = false;

  constructor(initialMessage: string = 'Loading...') {
    this.message = initialMessage;
  }

  public start(message?: string): void {
    if (this.spinnerActive) {
      this.stop(); // Stop any existing spinner
    }
    this.message = message || this.message;
    this.spinnerActive = true;
    this.frameIndex = 0;

    // Hide cursor
    process.stdout.write('\x1B[?25l');

    this.interval = setInterval(() => {
      const frame = this.frames[this.frameIndex = (this.frameIndex + 1) % this.frames.length];
      // Note: We use chalk.gray for the message to match the existing "Fetching..." style
      process.stdout.write(`\r${chalk.bgBlack.cyanBright.bold(frame)} ${chalk.gray(this.message)}`);
    }, 80);
  }

  public stop(clearLine: boolean = true): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.spinnerActive && clearLine) {
      process.stdout.write('\r\x1b[K'); // Clear line
    }
    // Show cursor
    process.stdout.write('\x1B[?25h');
    this.spinnerActive = false;
  }

  public updateMessage(newMessage: string): void {
    this.message = newMessage;
  }
}

const globalSpinner = new Spinner();
export { globalSpinner as spinner };
