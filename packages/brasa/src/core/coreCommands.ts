/**
 * @file The core commands: the ones that mean the same in every session,
 * whatever the backend — the filesystem verbs, the shell's own settings and
 * meta commands (help, notes, record and play), and the toys and games shelf.
 *
 * The engine registers them itself (`core/dispatch.ts`). A backend registers
 * its own commands beside them and never replaces one of these
 * (docs/backend-neutral.adoc).
 *
 * @module
 */
import { type CommandGroup, type CommandHandler, type EnvelopeHandler } from './commandRegistry.js';
import { builtin_file, builtin_md5sum, builtin_sha256sum, builtin_strings, builtin_xxd } from '../builtins/games/bytes.js';
import { builtin_leave, builtin_stopwatch, builtin_timer } from '../builtins/games/chimes.js';
import { builtin_cowsay, builtin_cowthink } from '../builtins/games/cowsay.js';
import { builtin_banner, builtin_figlet } from '../builtins/games/figlet.js';
import { builtin_say, builtin_uptime, builtin_who } from '../builtins/games/lab.js';
import { builtin_lolcat } from '../builtins/games/lolcat.js';
import { builtin_morse } from '../builtins/games/morse.js';
import { builtin_calc, builtin_factor, builtin_primes, builtin_roll, builtin_units } from '../builtins/games/numbers.js';
import { builtin_2048, builtin_hangman, builtin_quiz } from '../builtins/games/play.js';
import { builtin_qr } from '../builtins/games/qr.js';
import { builtin_asciiquarium, builtin_cmatrix, builtin_rain, builtin_sl, builtin_snake, builtin_tetris } from '../builtins/games/show.js';
import { builtin_ddate, builtin_pom, builtin_stardate, builtin_sunrise } from '../builtins/games/sky.js';
import { builtin_rev, builtin_rot13, builtin_seq, builtin_shuf, builtin_tac, builtin_yes } from '../builtins/games/text.js';
import { builtin_wtf } from '../builtins/games/wtf.js';
import { builtin_cal, builtin_cat, builtin_cd, builtin_cp, builtin_date, builtin_debug, builtin_du, builtin_edit, builtin_expect, builtin_fortune, builtin_help, builtin_ls, builtin_mkdir, builtin_motd, builtin_mv, builtin_play, builtin_pwd, builtin_record, builtin_rm, builtin_rmdir, builtin_timing, builtin_touch, builtin_tree, builtin_version, builtin_weather } from '../builtins/index.js';
import { builtin_notes } from '../builtins/sys/notes.js';
import { envelopeHandler_wrap } from './sink.js';

const envelope: Record<string, EnvelopeHandler> = {
  cat: builtin_cat,
  cd: builtin_cd,
  cp: builtin_cp,
  mv: builtin_mv,
  rm: builtin_rm,
  mkdir: builtin_mkdir,
  rmdir: builtin_rmdir,
  touch: builtin_touch,
  pwd: builtin_pwd,
  timing: builtin_timing,
  debug: builtin_debug,
  version: builtin_version,
  fortune: builtin_fortune,
  cowsay: builtin_cowsay,
  cowthink: builtin_cowthink,
  figlet: builtin_figlet,
  banner: builtin_banner,
  lolcat: builtin_lolcat,
  rev: builtin_rev,
  tac: builtin_tac,
  yes: builtin_yes,
  seq: builtin_seq,
  factor: builtin_factor,
  primes: builtin_primes,
  shuf: builtin_shuf,
  roll: builtin_roll,
  rot13: builtin_rot13,
  morse: builtin_morse,
  calc: builtin_calc,
  units: builtin_units,
  who: builtin_who,
  uptime: builtin_uptime,
  say: builtin_say,
  wtf: builtin_wtf,
  file: builtin_file,
  xxd: builtin_xxd,
  strings: builtin_strings,
  sha256sum: builtin_sha256sum,
  md5sum: builtin_md5sum,
  qr: builtin_qr,
  pom: builtin_pom,
  stardate: builtin_stardate,
  ddate: builtin_ddate,
  sunrise: builtin_sunrise,
  timer: builtin_timer,
  leave: builtin_leave,
  stopwatch: builtin_stopwatch,
  sl: builtin_sl,
  cmatrix: builtin_cmatrix,
  rain: builtin_rain,
  asciiquarium: builtin_asciiquarium,
  tetris: builtin_tetris,
  snake: builtin_snake,
  quiz: builtin_quiz,
  hangman: builtin_hangman,
  '2048': builtin_2048,
  weather: builtin_weather,
  motd: builtin_motd,
  notes: builtin_notes,
  date: builtin_date,
  cal: builtin_cal,
  ls: builtin_ls,
  tree: builtin_tree,
  du: builtin_du,
  help: builtin_help,
  expect: builtin_expect,
  play: builtin_play,
  record: builtin_record,
  edit: builtin_edit,
};

const plain: Record<string, CommandHandler> = {
  cd: envelopeHandler_wrap(builtin_cd),
  ls: envelopeHandler_wrap(builtin_ls),
  pwd: envelopeHandler_wrap(builtin_pwd),
  cat: envelopeHandler_wrap(builtin_cat),
  rm: envelopeHandler_wrap(builtin_rm),
  cp: envelopeHandler_wrap(builtin_cp),
  mv: envelopeHandler_wrap(builtin_mv),
  touch: envelopeHandler_wrap(builtin_touch),
  mkdir: envelopeHandler_wrap(builtin_mkdir),
  rmdir: envelopeHandler_wrap(builtin_rmdir),
  edit: envelopeHandler_wrap(builtin_edit),
  timing: envelopeHandler_wrap(builtin_timing),
  debug: envelopeHandler_wrap(builtin_debug),
  fortune: envelopeHandler_wrap(builtin_fortune),
  cowsay: envelopeHandler_wrap(builtin_cowsay),
  cowthink: envelopeHandler_wrap(builtin_cowthink),
  figlet: envelopeHandler_wrap(builtin_figlet),
  banner: envelopeHandler_wrap(builtin_banner),
  lolcat: envelopeHandler_wrap(builtin_lolcat),
  rev: envelopeHandler_wrap(builtin_rev),
  tac: envelopeHandler_wrap(builtin_tac),
  yes: envelopeHandler_wrap(builtin_yes),
  seq: envelopeHandler_wrap(builtin_seq),
  factor: envelopeHandler_wrap(builtin_factor),
  primes: envelopeHandler_wrap(builtin_primes),
  shuf: envelopeHandler_wrap(builtin_shuf),
  roll: envelopeHandler_wrap(builtin_roll),
  rot13: envelopeHandler_wrap(builtin_rot13),
  morse: envelopeHandler_wrap(builtin_morse),
  calc: envelopeHandler_wrap(builtin_calc),
  units: envelopeHandler_wrap(builtin_units),
  who: envelopeHandler_wrap(builtin_who),
  uptime: envelopeHandler_wrap(builtin_uptime),
  say: envelopeHandler_wrap(builtin_say),
  wtf: envelopeHandler_wrap(builtin_wtf),
  file: envelopeHandler_wrap(builtin_file),
  xxd: envelopeHandler_wrap(builtin_xxd),
  strings: envelopeHandler_wrap(builtin_strings),
  sha256sum: envelopeHandler_wrap(builtin_sha256sum),
  md5sum: envelopeHandler_wrap(builtin_md5sum),
  qr: envelopeHandler_wrap(builtin_qr),
  pom: envelopeHandler_wrap(builtin_pom),
  stardate: envelopeHandler_wrap(builtin_stardate),
  ddate: envelopeHandler_wrap(builtin_ddate),
  sunrise: envelopeHandler_wrap(builtin_sunrise),
  timer: envelopeHandler_wrap(builtin_timer),
  leave: envelopeHandler_wrap(builtin_leave),
  stopwatch: envelopeHandler_wrap(builtin_stopwatch),
  sl: envelopeHandler_wrap(builtin_sl),
  cmatrix: envelopeHandler_wrap(builtin_cmatrix),
  rain: envelopeHandler_wrap(builtin_rain),
  asciiquarium: envelopeHandler_wrap(builtin_asciiquarium),
  tetris: envelopeHandler_wrap(builtin_tetris),
  snake: envelopeHandler_wrap(builtin_snake),
  quiz: envelopeHandler_wrap(builtin_quiz),
  hangman: envelopeHandler_wrap(builtin_hangman),
  '2048': envelopeHandler_wrap(builtin_2048),
  weather: envelopeHandler_wrap(builtin_weather),
  motd: envelopeHandler_wrap(builtin_motd),
  notes: envelopeHandler_wrap(builtin_notes),
  date: envelopeHandler_wrap(builtin_date),
  cal: envelopeHandler_wrap(builtin_cal),
  help: envelopeHandler_wrap(builtin_help),
  tree: envelopeHandler_wrap(builtin_tree),
  du: envelopeHandler_wrap(builtin_du),
  expect: envelopeHandler_wrap(builtin_expect),
  play: envelopeHandler_wrap(builtin_play),
  record: envelopeHandler_wrap(builtin_record),
};


/** The core commands: their handlers. Their help is registered from `builtins/help.ts`, which holds it. */
export const coreCommands: CommandGroup = {
  envelope,
  plain,
};
