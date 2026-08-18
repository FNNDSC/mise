/**
 * @file Runtime output port.
 *
 * Provides a narrow host-installed output port for lower-layer operational
 * messages. Cumin and Salsa must not depend upward on a terminal or Brasa,
 * but their command-time notices still need a destination selected by the
 * host. The default preserves standalone CLI behavior; a host may replace it
 * with a surface-aware writer.
 *
 * @module
 */

/** A destination for unstructured command-time output. */
export interface RuntimeOutput {
  /**
   * Writes ordinary output.
   *
   * @param chunk - Text or bytes to deliver.
   * @returns Nothing.
   */
  data_write(chunk: string | Buffer): void;
  /**
   * Writes diagnostic output.
   *
   * @param chunk - Text or bytes to deliver.
   * @returns Nothing.
   */
  err_write(chunk: string | Buffer): void;
}

const consoleOutput: RuntimeOutput = {
  data_write: (chunk: string | Buffer): void => { process.stdout.write(chunk); },
  err_write: (chunk: string | Buffer): void => { process.stderr.write(chunk); },
};

let activeOutput: RuntimeOutput = consoleOutput;

/**
 * Installs the runtime output destination.
 *
 * @param output - The host-owned output destination.
 * @returns The previously active destination.
 */
export function runtimeOutput_set(output: RuntimeOutput): RuntimeOutput {
  const previous: RuntimeOutput = activeOutput;
  activeOutput = output;
  return previous;
}

/**
 * Writes ordinary runtime output through the active host destination.
 *
 * @param chunk - Text or bytes to deliver.
 * @returns Nothing.
 */
export function runtimeOutput_data(chunk: string | Buffer): void {
  activeOutput.data_write(chunk);
}

/**
 * Writes diagnostic runtime output through the active host destination.
 *
 * @param chunk - Text or bytes to deliver.
 * @returns Nothing.
 */
export function runtimeOutput_err(chunk: string | Buffer): void {
  activeOutput.err_write(chunk);
}
