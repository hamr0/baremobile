import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listDevices, connectDevice, forward } from '../../src/usbmux.js';

describe('usbmux', () => {
  describe('exports', () => {
    it('should export listDevices, connectDevice, forward', async () => {
      const mod = await import('../../src/usbmux.js');
      assert.equal(typeof mod.listDevices, 'function');
      assert.equal(typeof mod.connectDevice, 'function');
      assert.equal(typeof mod.forward, 'function');
    });
  });

  describe('listDevices', () => {
    it('should return an array', async () => {
      // This may fail if usbmuxd is not running, but should not throw unhandled
      try {
        const devices = await listDevices();
        assert.ok(Array.isArray(devices));
        // If devices found, check shape
        if (devices.length > 0) {
          assert.ok(typeof devices[0].deviceId === 'number');
          assert.ok(typeof devices[0].serial === 'string');
        }
      } catch (e) {
        // usbmuxd not available — acceptable in CI
        assert.match(e.message, /usbmuxd|ENOENT|ECONNREFUSED/);
      }
    });
  });

  describe('connectDevice', () => {
    it('should reject with invalid device ID', async () => {
      try {
        await connectDevice(99999, 8100);
        assert.fail('should have thrown');
      } catch (e) {
        // Either connection refused (no usbmuxd) or connect failed (bad device)
        assert.ok(e.message.includes('usbmuxd') || e.message.includes('ENOENT') || e.message.includes('ECONNREFUSED'));
      }
    });
  });

  describe('forward', () => {
    it('should start and stop a TCP server', async () => {
      // forward() only listens — no usbmuxd contact until a client connects
      const server = await forward(99999, 8100, 0); // port 0 = random
      const addr = server.address();
      assert.ok(addr.port > 0);
      server.close();
    });
  });
});
