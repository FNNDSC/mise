/**
 * @file The mise brain, as the kernel's hosts have always imported it.
 *
 * The art and its frame renderer moved to the wire package so a browser can
 * draw the same brain a terminal boot does; the kernel re-exports them here so
 * chell and calypso keep their import.
 *
 * @module
 */
export { logo_linesRender, logo_frameRender, logoRows_count, logoColumns_count } from '@fnndsc/menu/logo';
