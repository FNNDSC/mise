/**
 * @file fond: the neutral base under mise's engine and session host.
 *
 * What is generic and once lived in a ChRIS package moves here, so a layer
 * that is not about CUBE can use it without loading CUBE's client. fond
 * depends on nothing in `@fnndsc` (law of docs/backend-neutral.adoc, held by
 * `npm run lint:fond`).
 *
 * @module
 */
export * from './result.js';
export * from './errorStack.js';
