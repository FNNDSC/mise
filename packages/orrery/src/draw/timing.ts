/**
 * @file The drawing's clock: how a wave steps down a graph, how long a pulse takes, how long a replay rests.
 *
 * @module
 */

/** Wave delay between one dependency tier firing and the next. */
export const WAVE_STEP_MS: number = 450;

/** A pulse's trip along one tube; a live edge repeats it. */
export const PULSE_TRIP_MS: number = 1200;

/** The rest between two replays of a finished feed's run. */
export const REPLAY_REST_MS: number = 1800;
