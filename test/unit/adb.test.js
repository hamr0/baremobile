import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  shellQuote, validatePackage, validateIntentAction, validateExtraKey,
} from '../../src/adb.js';

describe('shellQuote', () => {
  it('wraps plain strings in single quotes', () => {
    assert.strictEqual(shellQuote('hello'), `'hello'`);
  });

  it('escapes embedded single quotes via the standard idiom', () => {
    assert.strictEqual(shellQuote(`O'Brien`), `'O'\\''Brien'`);
  });

  it('preserves shell metacharacters inside the quotes (they cannot escape)', () => {
    const out = shellQuote('; rm -rf $HOME `whoami`');
    assert.strictEqual(out, `'; rm -rf $HOME \`whoami\`'`);
    // The whole string is one quoted token.
    assert.ok(out.startsWith(`'`) && out.endsWith(`'`));
  });

  it('coerces numbers and booleans to strings', () => {
    assert.strictEqual(shellQuote(42), `'42'`);
    assert.strictEqual(shellQuote(true), `'true'`);
  });
});

describe('validatePackage', () => {
  it('accepts standard Android package names', () => {
    for (const pkg of [
      'com.android.settings',
      'com.termux',
      'com.google.android.youtube',
      'org.fdroid.fdroid',
      'A',
      'a',
      'a1.b2.c3',
    ]) {
      assert.strictEqual(validatePackage(pkg), pkg);
    }
  });

  it('rejects shell-injection payloads', () => {
    for (const bad of [
      'com.x; rm -rf $HOME',
      'com.x && touch /tmp/pwned',
      'com.x`whoami`',
      'com.x$(id)',
      'com.x|cat',
      '../etc/passwd',
      '',
      '1com.starts.with.digit',
      'com x.with.space',
      'com.x\nnewline',
      null,
      undefined,
      42,
      {},
    ]) {
      assert.throws(() => validatePackage(bad), /Invalid Android package name/);
    }
  });
});

describe('validateIntentAction', () => {
  it('accepts standard Android intent actions', () => {
    for (const act of [
      'android.intent.action.VIEW',
      'android.settings.BLUETOOTH_SETTINGS',
      'com.example.MY_ACTION',
    ]) {
      assert.strictEqual(validateIntentAction(act), act);
    }
  });

  it('rejects injection payloads', () => {
    for (const bad of [
      'android.intent.action.VIEW; rm -rf /',
      'action`id`',
      '$(id)',
      '',
      null,
    ]) {
      assert.throws(() => validateIntentAction(bad), /Invalid intent action/);
    }
  });
});

describe('validateExtraKey', () => {
  it('accepts identifier-like keys', () => {
    for (const k of ['url', 'data', 'my_key', 'a.b.c']) {
      assert.strictEqual(validateExtraKey(k), k);
    }
  });

  it('rejects keys with metacharacters', () => {
    for (const bad of [
      'key;evil',
      'key value',
      "key'",
      '$KEY',
      '',
      null,
    ]) {
      assert.throws(() => validateExtraKey(bad), /Invalid intent extra key/);
    }
  });
});
