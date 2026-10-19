// Renders a spectral model through the page's own player, offline, to a WAV.
// usage: node render.mjs MODEL.json OUT.wav [rate] [pitch]
// needs: npx tsc -p tools/trek-sound/tsconfig.synth.json (writes build/synth.js) and node-web-audio-api installed here.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { model_play, noise_make } from './build/synth.js';

const require = createRequire(import.meta.url);
const wa = require('node-web-audio-api');
const [, , modelFile, outFile, rateArg, pitchArg] = process.argv;
if (!modelFile || !outFile) { console.error('usage: node render.mjs MODEL.json OUT.wav [rate] [pitch]'); process.exit(2); }
const model = JSON.parse(readFileSync(modelFile, 'utf8'));
const rate = 44100;
const speed = Number(rateArg || 1);
const seconds = Math.ceil((model.frames * model.frame) / speed) + 1;
const ctx = new wa.OfflineAudioContext(1, rate * seconds, rate);
const out = ctx.createGain();
out.connect(ctx.destination);
const r = model_play(ctx, out, noise_make(ctx), 0.1, model, { rate: speed, pitch: Number(pitchArg || 1) });
const rendered = await ctx.startRendering();
const ch = rendered.getChannelData(0);
const n = ch.length;
const buf = Buffer.alloc(44 + n * 2);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
let peak = 0;
for (let i = 0; i < n; i++) { const v = Math.max(-1, Math.min(1, ch[i])); peak = Math.max(peak, Math.abs(v)); buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2); }
writeFileSync(outFile, buf);
console.log(JSON.stringify({ voices: r.voices, seconds: r.seconds.toFixed(2), peak: peak.toFixed(3) }));
