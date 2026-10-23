/**
 * @file The switch between a person's sessions, through the door they came
 * in by: `stratus oci` to their cloud session, `chris` back.
 *
 * The ChRIS login is the only login (docs/stratus.adoc, D14). A page that
 * came through a porter asks the porter to start or rejoin the person's
 * stratus session, on the credentials filed under their ChRIS identity, and
 * then goes there; the ChRIS session keeps running, and `chris` comes back
 * to it. The porter decides everything and holds every secret: the page
 * only asks and follows.
 *
 * @module
 */
import { door_isPresent, doorUrl_build } from '../calypso/routes.js';

/** Where to go, as the porter answers a switch. */
interface SwitchAnswer {
  key?: string;
  state?: 'attached' | 'starting';
  error?: string;
}

/**
 * Asks the porter to switch this person's page to another of their sessions,
 * and goes there.
 *
 * @param to - `stratus` (their cloud session) or `chris`.
 * @param spend - For `stratus`: true asks for the tasks tier, false for read-only.
 * @returns What happened, or why it could not.
 */
export async function session_switch(to: 'stratus' | 'chris', spend: boolean): Promise<string> {
  if (!door_isPresent(window.location.search)) return `${to}: this page did not come through a porter, so there is no other session to switch to`;
  const url: string = doorUrl_build(window.location.pathname, 'switch');
  let answer: SwitchAnswer;
  try {
    const reply: Response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(to === 'stratus' ? { to, cloud: 'oci', spend } : { to }),
    });
    answer = (await reply.json()) as SwitchAnswer;
  } catch (error: unknown) {
    return `${to}: the porter did not answer (${error instanceof Error ? error.message : String(error)})`;
  }
  if (answer.error !== undefined || answer.key === undefined) return `${to}: ${answer.error ?? 'the porter refused'}`;
  const base: string = url.slice(0, -'switch'.length);
  window.location.assign(answer.state === 'starting' ? `${base}greet/${answer.key}` : `${base}s/${answer.key}/?door`);
  return to === 'stratus' ? `switching to your stratus session${spend ? ' (may spend)' : ' (read-only)'}…` : 'switching to your ChRIS session…';
}
