import { errorStack } from '../src/errorStack';
import { Ok, Err } from '../src/result';
import {
  vfs_ok, vfs_fail, vfs_failFromStack, vfsOutcome_ofResult, vfsOutcome_ofBoolean, vfsOutcome_toResult,
} from '../src/vfs/outcome';

beforeEach(() => errorStack.stack_clear());

describe('a failure whose words were pushed deeper down', () => {
  it('carries the newest message as its reason, stamp removed, and takes it off the stack', () => {
    errorStack.stack_push('error', 'File exists: a file already holds /a');
    expect(vfs_failFromStack('EEXIST')).toEqual({ ok: false, errno: 'EEXIST', reason: 'File exists: a file already holds /a' });
    expect(errorStack.stack_pop()).toBeUndefined();
  });

  it('is the bare errno when nothing was said', () => {
    expect(vfs_failFromStack('EIO')).toEqual({ ok: false, errno: 'EIO' });
  });
});

describe('an outcome from what older calls answer', () => {
  it('reads a Result: its value, or its failure with the stack\'s words', () => {
    expect(vfsOutcome_ofResult(Ok('text'), 'EIO')).toEqual(vfs_ok('text'));
    errorStack.stack_push('error', 'File not found: x');
    expect(vfsOutcome_ofResult(Err(), 'ENOENT')).toEqual(vfs_fail('ENOENT', 'File not found: x'));
  });

  it('reads a boolean the same way', () => {
    expect(vfsOutcome_ofBoolean(true, 'EIO')).toEqual(vfs_ok(true));
    expect(vfsOutcome_ofBoolean(false, 'EIO')).toEqual(vfs_fail('EIO'));
  });
});

describe('an outcome given back as a Result', () => {
  it('passes the value through, untouched stack', () => {
    expect(vfsOutcome_toResult(vfs_ok(7), 'read', '/x')).toEqual(Ok(7));
    expect(errorStack.stack_pop()).toBeUndefined();
  });

  it('says the failure in the operator\'s words on the stack', () => {
    expect(vfsOutcome_toResult(vfs_fail('ENOTEMPTY'), 'rmdir', '/d').ok).toBe(false);
    expect(errorStack.stack_pop()?.message).toContain("rmdir: failed to remove '/d': Directory not empty");
    expect(vfsOutcome_toResult(vfs_fail('EXDEV'), 'cp', '/a').ok).toBe(false);
    expect(errorStack.stack_pop()?.message).toContain("cp: cannot copy '/a' to '': Invalid cross-device link");
    expect(vfsOutcome_toResult(vfs_fail('EXDEV'), 'rename', '/a').ok).toBe(false);
    expect(errorStack.stack_pop()?.message).toContain("mv: cannot move '/a' to '': Invalid cross-device link");
    expect(vfsOutcome_toResult(vfs_fail('EISDIR'), 'readBinary', '/d').ok).toBe(false);
    expect(errorStack.stack_pop()?.message).toContain('/d: Is a directory');
    expect(vfsOutcome_toResult(vfs_fail('ENOENT'), 'write', '/n/x').ok).toBe(false);
    expect(errorStack.stack_pop()?.message).toContain('/n/x: No such file or directory');
  });
});
