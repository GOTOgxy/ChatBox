const fs = require('fs');
const path = require('path');
const os = require('os');

function appDataDir() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData/Roaming'), 'ChatBox');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library/Application Support/ChatBox');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'ChatBox');
}

let buffer = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (buffer.length < 4 + length) return;
    const message = JSON.parse(buffer.subarray(4, 4 + length).toString('utf8'));
    buffer = buffer.subarray(4 + length);
    handle(message);
  }
});

function send(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
}

function handle(message) {
  if (!message || !Array.isArray(message.cookies)) {
    send({ ok: true, ignored: true });
    return;
  }
  try {
    const dir = appDataDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'cookie-import.json'), JSON.stringify(message, null, 2));
    send({ ok: true, count: Array.isArray(message.cookies) ? message.cookies.length : 0 });
  } catch (error) {
    send({ ok: false, error: String(error) });
  }
}
