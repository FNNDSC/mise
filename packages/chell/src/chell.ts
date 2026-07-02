/**
 * @file ChELL public module surface.
 *
 * Historically the shell's god file; the implementation now lives in the
 * `core/` modules. This barrel re-exports the command layer so existing
 * importers (`./builtins/res/*`, `./core/boot.js`) keep a stable path.
 *
 * @module
 */
export {
  chiliCommand_run,
  command_handle,
  command_dispatch,
  COMMAND_HANDLERS,
  COMMAND_HANDLERS_KEYS,
  stopOnError_set,
} from './core/dispatch.js';
