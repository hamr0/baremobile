import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import * as api from '../../src/termux-api.js';

describe('termux-api exports', () => {
  it('exports all expected functions', () => {
    const expected = [
      'isAvailable', 'batteryStatus', 'clipboardGet', 'clipboardSet',
      'smsSend', 'smsList', 'call', 'location', 'cameraPhoto',
      'contactList', 'notify', 'volumeGet', 'volumeSet',
      'wifiInfo', 'torch', 'vibrate',
    ];
    for (const name of expected) {
      assert.strictEqual(typeof api[name], 'function', `${name} should be a function`);
    }
  });

  it('exports exactly 16 functions', () => {
    const exports = Object.keys(api).filter(k => typeof api[k] === 'function');
    assert.strictEqual(exports.length, 16);
  });
});

describe('isAvailable', () => {
  it('returns false when termux-api is not installed', async () => {
    // On non-Termux system, termux-battery-status won't be in PATH
    const available = await api.isAvailable();
    assert.strictEqual(available, false);
  });
});

describe('batteryStatus', () => {
  it('throws when not in Termux', async () => {
    await assert.rejects(() => api.batteryStatus(), {
      code: 'ENOENT',
    });
  });
});

describe('clipboardGet', () => {
  it('throws when not in Termux', async () => {
    await assert.rejects(() => api.clipboardGet(), {
      code: 'ENOENT',
    });
  });
});

describe('clipboardSet', () => {
  it('throws when not in Termux', async () => {
    await assert.rejects(() => api.clipboardSet('test'), {
      code: 'ENOENT',
    });
  });
});

describe('smsSend', () => {
  it('throws when not in Termux', async () => {
    await assert.rejects(() => api.smsSend('5551234', 'hello'), {
      code: 'ENOENT',
    });
  });
});

describe('smsList', () => {
  it('throws when not in Termux', async () => {
    await assert.rejects(() => api.smsList(), {
      code: 'ENOENT',
    });
  });
});

describe('call', () => {
  it('throws when not in Termux', async () => {
    await assert.rejects(() => api.call('5551234'), {
      code: 'ENOENT',
    });
  });
});

describe('location', () => {
  it('throws when not in Termux', async () => {
    await assert.rejects(() => api.location(), {
      code: 'ENOENT',
    });
  });
});

describe('contactList', () => {
  it('throws when not in Termux', async () => {
    await assert.rejects(() => api.contactList(), {
      code: 'ENOENT',
    });
  });
});

describe('notify', () => {
  it('throws when not in Termux', async () => {
    await assert.rejects(() => api.notify('Test', 'Content'), {
      code: 'ENOENT',
    });
  });
});

describe('volumeGet', () => {
  it('throws when not in Termux', async () => {
    await assert.rejects(() => api.volumeGet(), {
      code: 'ENOENT',
    });
  });
});

describe('volumeSet', () => {
  it('throws when not in Termux', async () => {
    await assert.rejects(() => api.volumeSet('music', 5), {
      code: 'ENOENT',
    });
  });
});

describe('wifiInfo', () => {
  it('throws when not in Termux', async () => {
    await assert.rejects(() => api.wifiInfo(), {
      code: 'ENOENT',
    });
  });
});

describe('torch', () => {
  it('throws when not in Termux', async () => {
    await assert.rejects(() => api.torch(true), {
      code: 'ENOENT',
    });
  });
});

describe('vibrate', () => {
  it('throws when not in Termux', async () => {
    await assert.rejects(() => api.vibrate(), {
      code: 'ENOENT',
    });
  });
});

describe('cameraPhoto', () => {
  it('throws when not in Termux', async () => {
    await assert.rejects(() => api.cameraPhoto('/tmp/test.jpg'), {
      code: 'ENOENT',
    });
  });
});
