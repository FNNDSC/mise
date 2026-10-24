/**
 * @file What the bridge is heard to do: the cue for an engine line, for a
 * change of state, for a command and an answer; the bank's label for a
 * pill; and the bank itself, every file it names present and well formed.
 */
import { describe, it, expect } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerCue_derive, commandCue_find, lineCues_derive, pillLabel_format, stateCues_derive } from '../../src/features/trek/cues.js';
import { pillFile_find, type SynthBank, type SynthModel } from '../../src/lcars/synth.js';
import type { BridgeReadout } from '../../src/features/trek/model.js';

const SOUND_DIR: string = fileURLToPath(new URL('../../public/sound/', import.meta.url));

/** A readout with only what the cues read. */
function readout_make(condition: BridgeReadout['condition']['name'], quadrant: { x: number; y: number }): BridgeReadout {
  return { condition: { name: condition, why: '' }, position: { quadrant, sector: { x: 0, y: 0 } } } as unknown as BridgeReadout;
}

describe('the cues', () => {
  it("hears the engine's lines: an attack, a hit, a kill, a torpedo, phasers, a starbase answering", () => {
    expect(lineCues_derive('Stardate 2100.12: Klingon attack:')).toEqual(['incoming']);
    expect(lineCues_derive('HIT: 274 units, shields absorb 80%, effective hit 55')).toEqual(['hit']);
    expect(lineCues_derive('   *** Klingon at 1,7 destroyed ***')).toEqual(['explosion']);
    expect(lineCues_derive('Torpedo track, torpedo number 1: 4,5 3,6')).toEqual(['torpedo']);
    expect(lineCues_derive('Phaser bank 0 fires:')).toEqual(['phaser']);
    expect(lineCues_derive('Phasers locked on target.  4926 units available')).toEqual(['phaser']);
    expect(lineCues_derive('Starbase in 1,1 responds')).toEqual(['hail']);
    expect(lineCues_derive('You are now in quadrant 2,0.  It is stardate 2100.88')).toEqual([]);
  });

  it('hears the state change: the alerts, docking, and the sensors in a new quadrant; nothing at the first state', () => {
    const green: BridgeReadout = readout_make('GREEN', { x: 1, y: 1 });
    expect(stateCues_derive(null, green)).toEqual([]);
    expect(stateCues_derive(green, readout_make('RED', { x: 1, y: 1 }))).toEqual(['redalert']);
    expect(stateCues_derive(green, readout_make('YELLOW', { x: 1, y: 1 }))).toEqual(['yellowalert']);
    expect(stateCues_derive(green, readout_make('DOCKED', { x: 1, y: 1 }))).toEqual(['dock']);
    expect(stateCues_derive(readout_make('RED', { x: 1, y: 1 }), green)).toEqual(['green']);
    expect(stateCues_derive(green, readout_make('GREEN', { x: 2, y: 1 }))).toEqual(['sensor']);
  });

  it('hears a grave command as the thing, the computer as thinking, and ENGAGE as warp or impulse', () => {
    expect(commandCue_find('abandon')).toBe('transporter');
    expect(commandCue_find('destruct')).toBe('destruct');
    expect(commandCue_find('computer')).toBe('thinking');
    expect(commandCue_find('move')).toBeNull();
    expect(answerCue_derive('distance', 'move')).toBe('warp');
    expect(answerCue_derive('distance', 'impulse')).toBe('impulse');
    expect(answerCue_derive('course', 'move')).toBeNull();
  });

  it("names a pill as the bank does: the computer's MOVE, a burst angle, a commit, a cancel", () => {
    expect(pillLabel_format('MOVE', 'computer')).toBe('MOVE (COMPUTER)');
    expect(pillLabel_format('MOVE', 'command')).toBe('MOVE');
    expect(pillLabel_format('10°', 'choice')).toBe('BURST ANGLE');
    expect(pillLabel_format('SET COURSE', 'commit')).toBe('SET COURSE');
    expect(pillLabel_format('ENGAGE', 'commit')).toBe('SLIDER SET');
    expect(pillLabel_format('CANCEL MOVE', 'command')).toBe('CANCEL');
  });
});

describe('the bank', () => {
  const bank: SynthBank = JSON.parse(readFileSync(join(SOUND_DIR, 'bank.json'), 'utf8')) as SynthBank;

  it('names a model for every cue the bridge plays and for every pill, and each file is there and well formed', () => {
    for (const cue of ['press', 'ack', 'deny', 'open', 'close', 'thinking', 'sensor', 'scanner', 'phaser', 'torpedo', 'incoming', 'hit', 'explosion', 'redalert', 'yellowalert', 'green', 'dock', 'warp', 'impulse', 'transporter', 'destruct', 'hail', 'gameover', 'nova', 'supernova', 'klingon-pass', 'shield']) {
      expect(bank.cues[cue]).toBeDefined();
    }
    for (const label of ['MOVE', 'SET COURSE', 'SLIDER SET', 'YES', 'NO', 'CANCEL', 'LEAVE BRIDGE', 'MOVE (COMPUTER)', 'BURST ANGLE', 'SEND TO HELM']) {
      expect(bank.pills[label]).toBeDefined();
    }
    expect(pillFile_find(bank, 'NO SUCH PILL')).toBe(bank.cues['press']);
    const files: Set<string> = new Set<string>([...Object.values(bank.cues), ...Object.values(bank.pills)]);
    expect(files.size).toBeGreaterThanOrEqual(60);
    for (const file of files) {
      const path: string = join(SOUND_DIR, file);
      expect(existsSync(path)).toBe(true);
      const model: SynthModel = JSON.parse(readFileSync(path, 'utf8')) as SynthModel;
      expect(model.frames).toBeGreaterThan(0);
      expect(model.frame).toBeGreaterThan(0);
      expect(model.tracks.length).toBeGreaterThan(0);
      expect(model.noise.centres).toHaveLength(32);
      expect(model.noise.frames.length).toBeGreaterThan(0);
      for (const [start, hz, amp] of model.tracks.slice(0, 5)) {
        expect(start).toBeGreaterThanOrEqual(0);
        expect(hz.length).toBe(amp.length);
      }
    }
  });
});
