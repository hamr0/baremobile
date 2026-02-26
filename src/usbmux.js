// Node.js usbmuxd client — replaces pymobiledevice3 port forwarder.
// Connects to /var/run/usbmuxd unix socket, speaks the binary protocol.
// Zero dependencies. Used by ios.js to reach WDA on USB-connected iPhones.

import net from 'node:net';

const USBMUXD = '/var/run/usbmuxd';

// --- usbmuxd binary protocol ---

function makeHeader(type, payloadLen, tag = 1) {
  const buf = Buffer.alloc(16);
  buf.writeUInt32LE(16 + payloadLen, 0); // total length
  buf.writeUInt32LE(0, 4);               // version 0 (binary)
  buf.writeUInt32LE(type, 8);
  buf.writeUInt32LE(tag, 12);
  return buf;
}

function makeConnectPacket(deviceId, port) {
  const header = makeHeader(2, 8); // type 2 = Connect
  const payload = Buffer.alloc(8);
  payload.writeUInt32LE(deviceId, 0);
  payload.writeUInt16BE(port, 4);    // network byte order
  return Buffer.concat([header, payload]);
}

function makePlistPacket(plistBody) {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>ClientVersionString</key>
  <string>baremobile</string>
  <key>MessageType</key>
  <string>${plistBody}</string>
</dict>
</plist>`;
  const payload = Buffer.from(plist, 'utf8');
  const header = Buffer.alloc(16);
  header.writeUInt32LE(16 + payload.length, 0);
  header.writeUInt32LE(1, 4);   // version 1 (plist)
  header.writeUInt32LE(8, 8);   // type 8 (plist message)
  header.writeUInt32LE(1, 12);  // tag
  return Buffer.concat([header, payload]);
}

// --- Public API ---

/**
 * List USB-connected iOS devices via usbmuxd.
 * @returns {Promise<Array<{deviceId: number, serial: string}>>}
 */
export function listDevices() {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(USBMUXD);
    sock.once('error', reject);
    sock.once('connect', () => sock.write(makePlistPacket('ListDevices')));

    const chunks = [];
    sock.on('data', (d) => {
      chunks.push(d);
      // usbmuxd sends the full response in one go — parse when we have the header
      const raw = Buffer.concat(chunks);
      if (raw.length < 4) return;
      const expectedLen = raw.readUInt32LE(0);
      if (raw.length < expectedLen) return;

      const plist = raw.slice(16).toString('utf8');
      const devices = [];
      const re = /<key>DeviceID<\/key>\s*<integer>(\d+)<\/integer>[\s\S]*?<key>SerialNumber<\/key>\s*<string>([^<]+)<\/string>/g;
      let m;
      while ((m = re.exec(plist)) !== null) {
        devices.push({ deviceId: parseInt(m[1]), serial: m[2] });
      }
      sock.destroy();
      resolve(devices);
    });

    setTimeout(() => { sock.destroy(); reject(new Error('usbmuxd list timeout')); }, 3000);
  });
}

/**
 * Open a raw TCP connection to a port on a USB device.
 * After resolving, the returned socket speaks directly to the device port.
 *
 * @param {number} deviceId — usbmuxd device ID
 * @param {number} port — remote port on device
 * @returns {Promise<net.Socket>}
 */
export function connectDevice(deviceId, port) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(USBMUXD);
    sock.once('error', reject);
    sock.once('connect', () => sock.write(makeConnectPacket(deviceId, port)));

    let gotResponse = false;
    sock.once('data', (data) => {
      gotResponse = true;
      const result = data.length >= 20 ? data.readUInt32LE(16) : -1;
      if (result === 0) {
        sock.removeAllListeners('error');
        resolve(sock);
      } else {
        sock.destroy();
        reject(new Error(`usbmuxd connect failed (code ${result})`));
      }
    });

    sock.once('close', () => {
      if (!gotResponse) reject(new Error('usbmuxd closed before response'));
    });

    setTimeout(() => {
      if (!gotResponse) { sock.destroy(); reject(new Error('usbmuxd connect timeout')); }
    }, 5000);
  });
}

/**
 * Start a TCP proxy: localhost:localPort → device:remotePort via usbmuxd.
 * Each incoming connection gets its own usbmuxd channel.
 *
 * @param {number} deviceId
 * @param {number} remotePort
 * @param {number} [localPort=remotePort]
 * @returns {Promise<net.Server>} the listening server (call .close() to stop)
 */
export function forward(deviceId, remotePort, localPort) {
  if (localPort === undefined || localPort === null) localPort = remotePort;

  return new Promise((resolve, reject) => {
    const server = net.createServer(async (client) => {
      try {
        const device = await connectDevice(deviceId, remotePort);
        client.pipe(device);
        device.pipe(client);
        client.on('error', () => device.destroy());
        device.on('error', () => client.destroy());
        client.on('close', () => device.destroy());
        device.on('close', () => client.destroy());
      } catch {
        client.destroy();
      }
    });

    server.on('error', reject);
    server.listen(localPort, () => resolve(server));
  });
}
