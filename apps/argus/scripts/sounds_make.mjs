/**
 * @file Makes ARGUS's four sounds, from arithmetic.
 *
 * The surface used to borrow its beeps from TheLCARS.com's template, which
 * meant an operator needed that zip before the interface would answer a press.
 * These are synthesised here instead — sine partials under an exponential
 * decay, written straight into a WAV — so they are ours, they are tiny, and
 * they are committed rather than fetched.
 *
 * The four are deliberately distinct at a glance of the ear, because they mean
 * different things: a press acknowledged, a thing arriving, a retreat, and a
 * refusal. A retreat falls; a refusal is flatter and shorter, and neither is
 * pleasant enough to be mistaken for the other.
 *
 * Run: `node scripts/sounds_make.mjs` — writes into `src/lcars/sounds/`.
 *
 * @module
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Samples per second. 44.1kHz is what every browser decodes without thought. */
const RATE = 44100;

/** Where the sounds land, beside the surface's other vendored assets. */
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lcars', 'sounds');

/**
 * One sound: partials, how long, and how sharply it dies away.
 *
 * @property name - The file to write.
 * @property partials - Frequencies in Hz with their relative weights.
 * @property seconds - Total length.
 * @property decay - Exponential decay constant; larger is shorter-lived.
 * @property glide - Semitone shift across the sound; negative falls.
 */
const SOUNDS = [
  // audio1 — a press acknowledged. Bright, immediate, gone.
  { name: 'press.wav', partials: [[988, 1], [1976, 0.28]], seconds: 0.085, decay: 46, glide: 0 },
  // audio2 — a thing arriving. Two partials a fifth apart, a touch longer.
  { name: 'arrive.wav', partials: [[784, 1], [1176, 0.42], [1568, 0.12]], seconds: 0.13, decay: 30, glide: 0 },
  // audio3 — a retreat. Falls a whole tone, which is what makes it read as away.
  { name: 'retreat.wav', partials: [[660, 1], [990, 0.22]], seconds: 0.14, decay: 28, glide: -2 },
  // audio4 — a refusal. Low, flat, and over before it is enjoyed.
  { name: 'refuse.wav', partials: [[233, 1], [349, 0.5], [466, 0.18]], seconds: 0.17, decay: 22, glide: 0 },
];

/**
 * Renders one sound to 16-bit mono PCM.
 *
 * @param sound - Its recipe.
 * @returns The samples, as signed 16-bit values.
 */
function samples_render(sound) {
  const total = Math.round(RATE * sound.seconds);
  const out = new Int16Array(total);
  // A short fade in and out: a waveform that starts or stops at a non-zero
  // value clicks, and a click is the one sound nobody designed.
  const edge = Math.max(1, Math.round(RATE * 0.004));
  for (let i = 0; i < total; i++) {
    const t = i / RATE;
    const bend = Math.pow(2, (sound.glide * (t / sound.seconds)) / 12);
    let value = 0;
    let weight = 0;
    for (const [hz, w] of sound.partials) {
      value += w * Math.sin(2 * Math.PI * hz * bend * t);
      weight += w;
    }
    value /= weight;
    const envelope = Math.exp(-sound.decay * t)
      * Math.min(1, i / edge)
      * Math.min(1, (total - i) / edge);
    out[i] = Math.max(-32768, Math.min(32767, Math.round(value * envelope * 0.72 * 32767)));
  }
  return out;
}

/**
 * Wraps PCM in a WAV header.
 *
 * @param samples - 16-bit mono samples.
 * @returns The complete file.
 */
function wav_wrap(samples) {
  const header = Buffer.alloc(44);
  const bytes = samples.length * 2;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + bytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(bytes, 40);
  return Buffer.concat([header, Buffer.from(samples.buffer, samples.byteOffset, bytes)]);
}

mkdirSync(OUT, { recursive: true });
for (const sound of SOUNDS) {
  const file = wav_wrap(samples_render(sound));
  writeFileSync(path.join(OUT, sound.name), file);
  console.log(`${sound.name.padEnd(12)} ${String(file.length).padStart(6)} bytes  ${sound.seconds * 1000} ms`);
}
