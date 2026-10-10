/**
 * The core boots and runs with no ChRIS package loaded.
 *
 * Boots `@fnndsc/brasa/core` over the null backend in plain Node, with a
 * resolve hook that refuses cumin, salsa and chili, and runs the core shell:
 * navigation, the file tools, pipes, redirection to this host's disk, help.
 * Exits 1 when any line answers otherwise, or when anything asked for a
 * ChRIS package, caught or not.
 *
 * Run after the build: `npm run test:core-boot --workspace @fnndsc/brasa`.
 */
import { register } from 'node:module';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch = mkdtempSync(join(tmpdir(), 'core-boot-'));
process.env.CORE_BOOT_LOADS = join(scratch, 'chris-loads.txt');
register(new URL('./coreBoot.hook.mjs', import.meta.url));

const { engine_create, nullBackend_make } = await import('../dist/core.js');
const engine = await engine_create(nullBackend_make({
  seed: { '/home/user/hello.txt': 'hello\nworld\n', '/home/user/docs/a.txt': 'alpha' },
}));
engine.sink_install({ data_write: () => undefined, err_write: () => undefined, progress_write: () => undefined });

const redirected = join(scratch, 'out.txt');
/** Each line, the status it answers with, and what its output holds (and must not). */
const CHECKS = [
  { line: 'pwd', ok: true, has: ['/home/user'] },
  { line: 'ls', ok: true, has: ['hello.txt', 'docs'] },
  { line: 'cd docs', ok: true },
  { line: 'pwd', ok: true, has: ['/home/user/docs'] },
  { line: 'cat a.txt', ok: true, has: ['alpha'] },
  { line: 'cd ~', ok: true },
  { line: 'cat hello.txt | tac', ok: true, has: ['world\nhello'] },
  { line: `cat hello.txt > ${redirected}`, ok: true },
  { line: 'mkdir -p new/deeper', ok: true },
  { line: 'touch --withContents fresh new/deeper/f.txt', ok: true },
  { line: 'cp new/deeper/f.txt copy.txt', ok: true },
  { line: 'mv copy.txt moved.txt', ok: true },
  { line: 'cat moved.txt', ok: true, has: ['fresh'] },
  { line: 'rm moved.txt', ok: true },
  { line: 'rm -r new', ok: true },
  { line: 'ls', ok: true, has: ['hello.txt'], hasNot: ['moved.txt', 'new'] },
  { line: 'cat docs', ok: false, has: ['Is a directory'] },
  { line: 'ls /usr', ok: true, has: ['bin', 'games', 'share'] },
  { line: 'help', ok: true, has: ['ls', 'cat', 'help games'], hasNot: ['feed', 'plugin', 'pacs', 'connect'] },
  { line: 'help feed', ok: true, has: ["No help available for 'feed'"] },
  { line: 'fortune', ok: true },
  { line: 'nosuch', ok: false, has: ['command not found: nosuch'] },
];

const strip = (text) => text.replace(/\x1b\[[0-9;]*m/g, '');
let failed = 0;
for (const check of CHECKS) {
  const envelopes = await engine.line_execute(check.line);
  const ok = envelopes.length > 0 && envelopes.every((envelope) => envelope.status === 'ok');
  const said = strip(envelopes.map((envelope) => `${envelope.rendered}${envelope.renderedErr ?? ''}`).join(''));
  const wrong = [];
  if (ok !== check.ok) wrong.push(`answered ${ok ? 'ok' : 'error'}`);
  for (const text of check.has ?? []) if (!said.includes(text)) wrong.push(`lacks ${JSON.stringify(text)}`);
  for (const text of check.hasNot ?? []) if (new RegExp(`\\b${text}\\b`).test(said)) wrong.push(`holds ${JSON.stringify(text)}`);
  console.log(`${wrong.length === 0 ? 'ok  ' : 'FAIL'}  ${check.line}${wrong.length ? ` — ${wrong.join('; ')}` : ''}`);
  if (wrong.length) failed++;
}

if (!existsSync(redirected) || readFileSync(redirected, 'utf-8') !== 'hello\nworld\n') {
  console.log('FAIL  redirection wrote this host\'s file');
  failed++;
}
const loads = existsSync(process.env.CORE_BOOT_LOADS) ? readFileSync(process.env.CORE_BOOT_LOADS, 'utf-8') : '';
if (loads !== '') {
  console.log(`FAIL  ChRIS packages were asked for:\n${loads}`);
  failed++;
}
console.log(failed === 0 ? `core boot: ${CHECKS.length} lines, no ChRIS package loaded` : `core boot: ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
