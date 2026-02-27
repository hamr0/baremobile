/**
 * Integration tests for the CLI session (daemon-based).
 * Requires a running Android emulator or device.
 *
 * Run: node --test test/integration/cli.test.js
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { listDevices } from '../../src/adb.js';

let hasDevice = false;
try {
  const devices = await listDevices();
  hasDevice = devices.length > 0;
} catch {
  hasDevice = false;
}

const CLI = resolve(import.meta.dirname, '..', '..', 'cli.js');
const NODE = process.execPath;

function cli(args, opts = {}) {
  return execFileSync(NODE, [CLI, ...args], {
    timeout: 30000,
    encoding: 'utf8',
    cwd: opts.cwd,
    ...opts,
  }).trim();
}

describe('CLI session (integration)', { skip: !hasDevice && 'No ADB device available' }, () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'baremobile-cli-int-'));
  const sessionDir = join(tmpDir, '.baremobile');

  after(() => {
    try { cli(['close'], { cwd: tmpDir }); } catch { /* already closed */ }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('open starts a daemon and creates session.json', () => {
    const out = cli(['open'], { cwd: tmpDir });
    assert.ok(out.includes('Session started'), `expected session started, got: ${out}`);
    assert.ok(existsSync(join(sessionDir, 'session.json')), 'session.json should exist');

    const session = JSON.parse(readFileSync(join(sessionDir, 'session.json'), 'utf8'));
    assert.ok(session.port > 0, 'should have a port');
    assert.ok(session.pid > 0, 'should have a pid');
  });

  it('status shows running session', () => {
    const out = cli(['status'], { cwd: tmpDir });
    assert.ok(out.includes('Session running'), `expected running, got: ${out}`);
  });

  it('snapshot creates a .yml file', () => {
    const out = cli(['snapshot'], { cwd: tmpDir });
    assert.ok(out.endsWith('.yml'), `expected .yml path, got: ${out}`);
    assert.ok(existsSync(out), 'snapshot file should exist');
    const content = readFileSync(out, 'utf8');
    assert.ok(content.length > 0, 'snapshot should not be empty');
  });

  it('launch opens Settings app', () => {
    const out = cli(['launch', 'com.android.settings'], { cwd: tmpDir });
    assert.equal(out, 'ok');

    // Wait for app to launch, then verify via snapshot
    execFileSync('sleep', ['2']);
    const snapOut = cli(['snapshot'], { cwd: tmpDir });
    const content = readFileSync(snapOut, 'utf8');
    // Settings may land on any sub-page; just verify it's a real app screen with refs
    assert.ok(content.includes('[ref='), `should have interactive refs, got:\n${content.slice(0, 500)}`);
  });

  it('tap sends tap command', () => {
    // Get snapshot to find a valid ref
    const snapOut = cli(['snapshot'], { cwd: tmpDir });
    const content = readFileSync(snapOut, 'utf8');
    const refMatch = content.match(/\[ref=(\d+)\]/);
    assert.ok(refMatch, 'snapshot should have refs');

    const out = cli(['tap', refMatch[1]], { cwd: tmpDir });
    assert.equal(out, 'ok');
  });

  it('back returns ok', () => {
    const out = cli(['back'], { cwd: tmpDir });
    assert.equal(out, 'ok');
  });

  it('screenshot creates a .png file', () => {
    const out = cli(['screenshot'], { cwd: tmpDir });
    assert.ok(out.endsWith('.png'), `expected .png path, got: ${out}`);
    assert.ok(existsSync(out), 'screenshot file should exist');
    const stat = readFileSync(out);
    assert.ok(stat.length > 1000, 'screenshot should be a real image');
  });

  it('logcat creates a .json file', () => {
    const out = cli(['logcat'], { cwd: tmpDir });
    assert.ok(out.endsWith('.json'), `expected .json path, got: ${out}`);
    assert.ok(existsSync(out), 'logcat file should exist');
    const entries = JSON.parse(readFileSync(out, 'utf8'));
    assert.ok(Array.isArray(entries), 'logcat should be an array');
  });

  it('close shuts down the daemon', () => {
    const out = cli(['close'], { cwd: tmpDir });
    assert.ok(out.includes('Session closed'), `expected closed, got: ${out}`);
    assert.ok(!existsSync(join(sessionDir, 'session.json')), 'session.json should be removed');
  });

  it('status after close exits non-zero', () => {
    let threw = false;
    try {
      cli(['status'], { cwd: tmpDir });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'status should exit with non-zero after close');
  });
});
