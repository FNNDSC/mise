/**
 * @file The art a terminal draws when it attaches to a daemon.
 *
 * The splash is the session's composition, and only the attach answer says
 * which: the brain for a ChRIS session, the Trusted Domain mark for a stratus
 * session, nothing for another backend. A daemon that predates the field is a
 * ChRIS daemon and keeps the brain.
 *
 * @module
 */
import { logo_frameRender, logo_linesRender } from '@fnndsc/menu/logo';
import { tdMark_linesRender } from '@fnndsc/menu/logo/td';

/**
 * The splash lines for a session over a backend.
 *
 * @param backend - The backend id from the attach answer, or undefined from
 *   a daemon that does not send one.
 * @param colorize - Whether to draw in colour.
 * @returns The lines to print; empty for a backend with no art of its own.
 */
export function splashLines_render(backend: string | undefined, colorize: boolean): string[] {
  if (backend === undefined || backend === 'chris') return colorize ? logo_frameRender(0, true) : logo_linesRender(false);
  if (backend === 'stratus') return tdMark_linesRender(colorize);
  return [];
}
