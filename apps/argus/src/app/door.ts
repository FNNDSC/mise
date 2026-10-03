/**
 * @file The pills a page wears when it came through a door (a porter).
 *
 * LOG OUT leaves by that door: the session is not touched — a daemon
 * outlives every surface, and the door's own policy decides when it ends —
 * so the pill tells the door to forget this browser and goes back to its
 * login. RESTART (app/restart.ts) asks the door to restart the session.
 * Neither stands on a page that came in any other way.
 */
import { door_isPresent, doorUrl_build } from '../calypso/routes.js';

/**
 * Wires the LOG OUT pill, shown only on a page that came through a door.
 *
 * @param pill - The pill.
 */
export function doorPill_wire(pill: HTMLElement | null = document.getElementById('door-pill')): void {
  if (pill === null || !door_isPresent(window.location.search)) return;
  pill.hidden = false;
  pill.addEventListener('click', (): void => {
    const logout: string = doorUrl_build(window.location.pathname, 'logout');
    const login: string = doorUrl_build(window.location.pathname, 'login');
    void fetch(logout, { method: 'POST', headers: { accept: 'application/json' } })
      .catch((): void => undefined)
      .then((): void => { window.location.assign(login); });
  });
}
