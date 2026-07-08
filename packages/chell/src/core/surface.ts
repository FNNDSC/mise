/**
 * @file Surface capabilities: the input/interaction seam a host provides.
 *
 * The output sink (`./sink.js`) lets a host decide where a command's output
 * goes. This module is its input-side counterpart: it lets a host declare
 * what *interaction* it can offer — prompting for a line, reading a secret
 * without echo, opening a local editor — and lets a builtin ask for a
 * capability and fail with a clear message when the attached surface cannot
 * provide it, rather than hanging on a standard input that is not there.
 *
 * The CLI host backs this with readline and the local `$EDITOR`; a future
 * daemon backs it with request messages to a remote surface, and a surface
 * that cannot (say) open a local editor simply declares `localEdit: false`.
 *
 * Capabilities the surface can act on directly (prompting) are methods here;
 * capabilities a builtin still performs itself (local editing, whose editor
 * mechanics remain in the `edit` builtin until a remote surface needs its
 * own implementation) are declared as flags a builtin gates on via
 * {@link capability_require}. This module is deliberately free of Node
 * built-ins so it stays trivially testable and host-agnostic; the readline
 * implementation lives in `./cliSurface.js`.
 *
 * @see docs/calypso.adoc — "Interactivity is a declared surface capability".
 * @module
 */

/**
 * What interaction an attached surface can provide.
 *
 * @property hiddenInput - The surface can read a line without echoing it
 *   (password entry).
 * @property localEdit - The surface can open content in a local editor and
 *   return the edited result.
 * @property tty - The surface is an interactive terminal (as opposed to a
 *   pipe, a script, or a headless host).
 * @property pipeSegments - The surface can run a pipeline's non-first
 *   segments (`... | grep foo`) through its own tools. Nothing ever spawns on
 *   a daemon host: the local CLI runs segments in-process, a remote CLI runs
 *   them on the client machine, and a browser surface lacks the capability
 *   and fails such pipelines with a clear message.
 */
export interface SurfaceCapabilities {
  hiddenInput: boolean;
  localEdit: boolean;
  tty: boolean;
  pipeSegments: boolean;
}

/**
 * A request to prompt the user for a line of input.
 *
 * @property message - The prompt text to display.
 * @property hidden - When true, the entered text is not echoed; requires the
 *   `hiddenInput` capability.
 */
export interface PromptRequest {
  message: string;
  hidden?: boolean;
}

/**
 * Content handed to a surface's local editor.
 *
 * @property content - The text to open in the editor.
 * @property extension - Optional filename extension (e.g. `.txt`, `.json`) so
 *   the editor can apply the right syntax mode.
 */
export interface LocalEditRequest {
  content: string;
  extension?: string;
}

/**
 * The outcome of a local edit.
 *
 * @property content - The content after editing.
 * @property changed - Whether the content differs from what was opened.
 */
export interface LocalEditResult {
  content: string;
  changed: boolean;
}

/**
 * The interaction seam a host installs. Builtins reach it through
 * {@link surface_get}; hosts declare their capabilities and back the
 * prompt and local-edit operations with whatever their surface supports.
 */
export interface Surface {
  /** What this surface can do; read by builtins before they interact. */
  readonly capabilities: SurfaceCapabilities;

  /**
   * Prompts for a line of input.
   *
   * @param request - The prompt message and whether to hide the input.
   * @returns The entered line, trimmed.
   * @throws {CapabilityError} When hidden input is requested but the surface
   *   lacks the `hiddenInput` capability, or the surface cannot prompt.
   */
  prompt(request: PromptRequest): Promise<string>;

  /**
   * Runs one pipeline segment against an input, returning its output. Where
   * this runs is the surface's business — in-process for the local CLI, on
   * the client machine for a remote CLI — but never on a daemon host.
   *
   * @param command - The segment command line (e.g. `grep foo`).
   * @param input - The bytes to feed the segment on stdin.
   * @returns The segment's stdout.
   * @throws {CapabilityError} When the surface lacks the `pipeSegments`
   *   capability.
   */
  pipeSegment(command: string, input: Buffer): Promise<Buffer>;

  /**
   * Opens content in the surface's local editor and returns the result. The
   * editor mechanics are the surface's business — a temp file and `$EDITOR`
   * for the local CLI, the client's editor for a remote CLI, an editor
   * component in a browser.
   *
   * @param request - The content to edit and an optional extension.
   * @returns The edited content and whether it changed.
   * @throws {CapabilityError} When the surface lacks the `localEdit`
   *   capability.
   */
  localEdit(request: LocalEditRequest): Promise<LocalEditResult>;
}

/**
 * Raised when a builtin requests an interaction the attached surface cannot
 * provide. Carries the capability name so a host can present it uniformly.
 */
export class CapabilityError extends Error {
  /** The capability that was required but absent. */
  public readonly capability: keyof SurfaceCapabilities;

  /**
   * @param capability - The missing capability.
   * @param message - Human-readable explanation.
   */
  constructor(capability: keyof SurfaceCapabilities, message: string) {
    super(message);
    this.name = 'CapabilityError';
    this.capability = capability;
  }
}

/**
 * The default surface for a host that has not installed one: it can do
 * nothing interactive and says so clearly. This is the correct default for
 * an unknown host — a CLI host replaces it (see `./cliSurface.js`), and any
 * attempt to prompt or edit before a real surface is installed fails loudly
 * instead of hanging.
 */
export class HeadlessSurface implements Surface {
  /** @inheritdoc */
  public readonly capabilities: SurfaceCapabilities = {
    hiddenInput: false,
    localEdit: false,
    tty: false,
    pipeSegments: false,
  };

  /** @inheritdoc */
  public prompt(_request: PromptRequest): Promise<string> {
    throw new CapabilityError('tty', 'This surface cannot prompt for input.');
  }

  /** @inheritdoc */
  public pipeSegment(_command: string, _input: Buffer): Promise<Buffer> {
    throw new CapabilityError('pipeSegments', 'This surface cannot run pipeline segments.');
  }

  /** @inheritdoc */
  public localEdit(_request: LocalEditRequest): Promise<LocalEditResult> {
    throw new CapabilityError('localEdit', 'This surface cannot open a local editor.');
  }
}

/** The active surface. Defaults to headless until a host installs one. */
let activeSurface: Surface = new HeadlessSurface();

/**
 * Returns the currently installed surface.
 *
 * @returns The active surface.
 */
export function surface_get(): Surface {
  return activeSurface;
}

/**
 * Installs a surface. Called by the host that owns the interaction channel.
 *
 * @param surface - The surface to install.
 * @returns The previously installed surface, so callers can restore it.
 */
export function surface_set(surface: Surface): Surface {
  const previous: Surface = activeSurface;
  activeSurface = surface;
  return previous;
}

/**
 * Asserts that the active surface has a capability, throwing a
 * {@link CapabilityError} with a clear message when it does not.
 *
 * @param capability - The capability the caller needs.
 * @param message - The message to present when it is absent.
 * @throws {CapabilityError} When the active surface lacks the capability.
 */
export function capability_require(
  capability: keyof SurfaceCapabilities,
  message: string,
): void {
  if (!activeSurface.capabilities[capability]) {
    throw new CapabilityError(capability, message);
  }
}
