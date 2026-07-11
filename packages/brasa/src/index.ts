/**
 * BRASA Runs Abstracted Shell Actions.
 *
 * The hostable ChRIS shell engine (kernel): parsing, dispatch, pipes, builtins,
 * session and output capture, with no terminal I/O of its own. Frontends
 * (the chell CLI, the calypso daemon, future web clients) host this engine and
 * supply their own output sink, surface and renderer implementations.
 *
 * This barrel is populated as the engine is lifted out of the chell package.
 */

export {};
