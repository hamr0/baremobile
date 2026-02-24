/**
 * Unit tests for CLI session infrastructure (session-client + daemon command dispatch).
 * No emulator required — uses a mock HTTP server.
 *
 * Run: node --test test/unit/cli.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { readSession, isAlive, sendCommand } from '../../src/session-client.js';

describe('session-client', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'baremobile-cli-unit-'));
  let server;
  let port;
  let lastCommand;

  before(async () => {
    // Start a mock daemon HTTP server
    server = createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, pid: process.pid }));
        return;
      }
      if (req.method === 'POST' && req.url === '/command') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const parsed = JSON.parse(body);
        lastCommand = parsed;

        if (parsed.command === 'snapshot') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, file: '/tmp/screen.yml' }));
        } else if (parsed.command === 'tap') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else if (parsed.command === 'type') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else if (parsed.command === 'close') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else if (parsed.command === 'status') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, pid: process.pid, uptime: 42 }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        }
        return;
      }
      res.writeHead(404);
      res.end('Not found');
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    port = server.address().port;

    // Write session.json
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'session.json'), JSON.stringify({
      port,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }));
  });

  after(() => {
    server.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('readSession returns session data', () => {
    const session = readSession(tmpDir);
    assert.ok(session, 'should return session');
    assert.equal(session.port, port);
    assert.equal(session.pid, process.pid);
    assert.ok(session.startedAt);
  });

  it('readSession returns null for missing dir', () => {
    const session = readSession('/tmp/nonexistent-baremobile-test');
    assert.equal(session, null);
  });

  it('isAlive returns true for running daemon', async () => {
    const alive = await isAlive(tmpDir);
    assert.equal(alive, true);
  });

  it('isAlive returns false for missing session', async () => {
    const alive = await isAlive('/tmp/nonexistent-baremobile-test');
    assert.equal(alive, false);
  });

  it('sendCommand proxies snapshot correctly', async () => {
    const result = await sendCommand('snapshot', {}, tmpDir);
    assert.equal(result.ok, true);
    assert.equal(result.file, '/tmp/screen.yml');
    assert.equal(lastCommand.command, 'snapshot');
  });

  it('sendCommand proxies tap with ref', async () => {
    const result = await sendCommand('tap', { ref: '5' }, tmpDir);
    assert.equal(result.ok, true);
    assert.equal(lastCommand.command, 'tap');
    assert.equal(lastCommand.args.ref, '5');
  });

  it('sendCommand proxies type with ref and text', async () => {
    const result = await sendCommand('type', { ref: '3', text: 'hello', clear: true }, tmpDir);
    assert.equal(result.ok, true);
    assert.equal(lastCommand.command, 'type');
    assert.equal(lastCommand.args.ref, '3');
    assert.equal(lastCommand.args.text, 'hello');
    assert.equal(lastCommand.args.clear, true);
  });

  it('sendCommand proxies close', async () => {
    const result = await sendCommand('close', {}, tmpDir);
    assert.equal(result.ok, true);
    assert.equal(lastCommand.command, 'close');
  });

  it('sendCommand throws for missing session', async () => {
    await assert.rejects(
      () => sendCommand('snapshot', {}, '/tmp/nonexistent-baremobile-test'),
      { message: /No active session/ },
    );
  });

  it('sendCommand error message references baremobile', async () => {
    await assert.rejects(
      () => sendCommand('snapshot', {}, '/tmp/nonexistent-baremobile-test'),
      { message: /baremobile open/ },
    );
  });
});
