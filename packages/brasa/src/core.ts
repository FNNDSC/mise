/**
 * @file `@fnndsc/brasa/core`: the engine with no backend installed.
 *
 * The package root installs ChRIS for every consumer. This entry installs
 * nothing: a host hands `engine_create` the backend its session runs over
 * (the null backend here, or its own), and none of the ChRIS packages load
 * unless that backend loads them.
 *
 * @module
 */
export * from './core/engine.js';
export * from './core/dispatch.js';
export * from './core/backend.js';
export * from './core/sink.js';
export * from './core/surface.js';
export * from './core/question.js';
export * from './core/progress.js';
export * from './core/commandRegistry.js';
export { nullBackend_make, type NullBackendOptions } from './null/backend.js';
