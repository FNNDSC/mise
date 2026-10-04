/**
 * @file Whether an envelope answered a press on the Files panel, and if not,
 * the words its refusal reads.
 *
 * A listing the kernel sent is drawn even when the command is marked an
 * error: that mark can come from a side lookup that failed while the listing
 * itself succeeded (a shared feed's `data`, whose owner's home this identity
 * may not read). Dropping it left the press hanging, neither drawn nor
 * refused. A listing that failed outright still carries the model, empty:
 * that one is a refusal, and is said as one.
 *
 * @module
 */
import type { WireEnvelope } from '@fnndsc/menu';

/**
 * Whether the envelope carries a listing to draw.
 *
 * @param envelope - The envelope a press brought back.
 * @returns True when it holds at least one listing.
 */
export function listing_isAnswered(envelope: WireEnvelope): boolean {
  return envelope.model?.kind === 'fs.listing'
    && Array.isArray(envelope.model.data) && envelope.model.data.length > 0;
}

/**
 * What a refused press reads: every line the kernel said (after the reason
 * may come why the path may not be where it looked, such as a parent whose
 * links it could not read), else the last error it drained, else a plain
 * word. A press is never left waiting on an answer that came.
 *
 * @param envelope - The refused envelope.
 * @returns The refusal's words, on one line.
 */
export function refusalWords_of(envelope: WireEnvelope): string {
  const said: string = (envelope.renderedErr ?? envelope.rendered ?? '').replace(/\x1b\[[0-9;]*m/g, '').split('\n')
    .map((line: string): string => line.trim()).filter((line: string): boolean => line.length > 0).join(' · ');
  const drained: string = [...((envelope as { errors?: Array<{ type?: string; message?: string }> }).errors ?? [])]
    .reverse().find((error) => error.type === 'error')?.message?.replace(/^\[[^\]]*\]\s*\|\s*/, '') ?? '';
  return said || drained || 'refused';
}
