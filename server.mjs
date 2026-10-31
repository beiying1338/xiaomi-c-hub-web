// Xiaomi C-HUB Web Bridge — Redmi 电脑音箱 2 Pro (B03) web-based driver manager.
// Speaks the reverse-engineered A5 5A FC protocol over HID feature reports.
// Verified live against VID_2717&PID_D003&MI_04 (usagePage 0xFF00, usage 0x55AA).
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require2 = createRequire(import.meta.url);
// node-hid: repo-local install first, fallback to the extracted app's own copy (dev mode)
function loadHid() {
  for (const c of ['node-hid', join(__dirname, '..', 'app', 'node_modules', 'node-hid')]) {
    try { return require2(c); } catch {}
  }
  throw new Error('node-hid not found — run: npm install');
}
const HID = loadHid();

const PUBLIC = join(__dirname, 'public');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';            // 0.0.0.0 for Docker
const ACCESS_TOKEN = process.env.CHUB_TOKEN || '';       // optional bearer token gate
const CORS_ANY = process.env.CHUB_CORS === '1';          // opt-in cross-origin (direct-bridge mode)

// ---------------- protocol ----------------
const VID = 0x2717;
const B03_PIDS = new Set([0xd003, 0xd004, 0xd00b, 0xd00c, 0xd007, 0xd008, 0xd009, 0xd00a]);
const HEAD = [0xa5, 0x5a, 0xfc];
const ETX = 0x16;
const CMD = {
  LIGHT_EFFECT: 48, LIGHT_BRIGHTNESS: 49, LIGHT_TONE: 50, RGB_FLAG: 52,
  EQ_INDEX: 64, SOUND_TONE: 65, BT_VERSION: 113, VOLUME: 116, ELECTRICITY: 117,
  TX_VERSION: 119, RX_VERSION: 120, RX_CONNECT: 121,
  SLEEP_FLAG: 128, SLEEP_VALUE: 129, STANDBY_FLAG: 131, STANDBY_VALUE: 132,
  CHANNEL: 133, CHANNEL_TONE_FLAG: 134, CHANNEL_TONE: 135,
  AGILITY_COLOR: 136, SYLD_COLOR: 137, COLOR_FLOW: 138, BREATHING: 139,
  EQ_BANDS: 140, POWER_NOTICE: 142, MIX_LINE: 143,
};
const PARAM_NAMES = {
  48: 'lightEffectIndex', 49: 'light', 50: 'lightToneFlag', 52: 'rgbLightFlag',
  64: 'equalizerIndex', 65: 'soundToneFlag', 113: 'BTVersion', 116: 'volume',
  117: 'electricity', 128: 'sleepFlag', 129: 'sleepValue', 131: 'standbyFlag',
  132: 'standbyValue', 133: 'channelStatus', 134: 'channelPromptFlag',
  135: 'channelPrompt', 136: 'agilityOrColorFlag', 137: 'syldColorIndex',
  138: 'colorFlowRate', 139: 'breathingSpeed', 140: 'equalizerHZsValue',
  142: 'powerNoticeFlag', 143: 'mixLineChannelFlag', 119: 'TXVersion',
  120: 'RXVersion', 121: 'RXConnectStatus',
};

function frame(payload) {
  // B03 layout: A5 5A FC <len=payload.length> <payload…> 16
  // verified: BaseQuery len=03, EQ write len=12 (2+10)
  return [...HEAD, payload.length, ...payload, ETX];
}
// BaseQuery (HID)  = A5 5A FC 03 90 03 00 16 (verified live)
const buildQuery = (cmd) => frame([cmd, 3, 0]);
const buildWrite1 = (cmd, v) => frame([cmd, 2, v & 0xff]);
const buildWriteEQ = (vals) => frame([CMD.EQ_BANDS, 2, 10, ...vals.map((v) => (v + 6) & 0xff)]);

function parseState(buf) {
  // buf = frame WITHOUT report id: A5 5A FC <len> <cmd> <op> <TLV…> [16]
  if (buf[0] !== 0xa5 || buf[1] !== 0x5a || buf[2] !== 0xfc) return null;
  const len = buf[3];
  const data = buf.slice(6, 6 + len);
  const cfg = { _raw: len };
  for (let i = 0; i < data.length - 2; i++) {
    const id = data[i];
    if (!(id in PARAM_NAMES)) continue;
    const n = data[i + 1];
    if (n === 1) {
      let v = data[i + 2];
      if (id === 49) v = Math.min(100, v * 10);                      // brightness 0-10 → 0-100
      else if (id === 116) v = v === 16 ? 100 : Math.min(100, v * 6); // volume 0-16 → 0-100
      cfg[PARAM_NAMES[id]] = v;
      i += 2;
    } else if (id === 140 || id === 133) {
      const vals = [...data.slice(i + 2, i + 2 + n)];
      if (id === 140) cfg.equalizerHZsValue = vals.map((x) => x - 6);
      else {
        cfg.channelStatus = vals;
        cfg.channel = vals.findIndex((x) => x === 2);
      }
      i += 1 + n;
    }
  }
  return cfg;
}

// ---------------- HID transport ----------------
const hexs = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');

class Speaker {
  constructor() {
    this.hid = null;
    this.path = null;
    this.info = null;
    this.queue = Promise.resolve();
    this.lastCfg = null;
  }
  find() {
    const list = HID.devices().filter((d) => d.vendorId === VID && B03_PIDS.has(d.productId) && d.usagePage === 0xff00 && d.usage === 0x55aa);
    return list[0] || null;
  }
  connect() {
    const d = this.find();
    if (!d) return false;
    if (this.hid && this.path === d.path) return true;
    this.close();
    try {
      this.hid = new HID.HID(d.path);
      this.path = d.path;
      this.info = d;
      return true;
    } catch (e) {
      console.error('[hid] open failed:', e.message);
      this.hid = null;
      return false;
    }
  }
  close() { try { this.hid && this.hid.close(); } catch {} this.hid = null; }
  get connected() { return !!this.hid; }

  transact(frameArr) {
    return (this.queue = this.queue.then(async () => {
      if (!this.connect()) return { error: 'device not connected' };
      try {
        // exactly as C-HUB does: single buffer arg, report id 0 in first byte
        this.hid.sendFeatureReport(Buffer.from([0x00, ...frameArr]));
        const resp = this.hid.getFeatureReport(0, 129);
        const body = Buffer.from(resp).subarray(1); // strip report id byte
        console.log('[tx]', hexs(frameArr), '\n[rx]', hexs(body.subarray(0, Math.min(body.length, 96))));
        return body;
      } catch (e) {
        this.close();
        return { error: e.message };
      }
    }));
  }
  // Writes MUST go over the HID OUT report channel (HID.write) — the same
  // channel the official app's sendReport uses. Writes sent as feature
  // reports are silently IGNORED by the firmware (queries still work).
  writeOut(frameArr) {
    return (this.queue = this.queue.then(async () => {
      if (!this.connect()) return { error: 'device not connected' };
      try {
        const out = Buffer.from([0x00, ...frameArr]); // report id 0 + frame
        this.hid.write(out); // hidapi pads to the 257B OUT report size
        await new Promise((r) => setTimeout(r, 120));
        // read back the fresh state via the feature-report query channel
        const resp = this.hid.getFeatureReport(0, 129);
        const body = Buffer.from(resp).subarray(1);
        console.log('[wx]', hexs(frameArr), '\n[rx]', hexs(body.subarray(0, Math.min(body.length, 96))));
        return body;
      } catch (e) {
        this.close();
        return { error: e.message };
      }
    }));
  }
  async readState() {
    const r = await this.transact(buildQuery(0x90)); // A5 5A FC 03 90 03 00 16
    if (r.error) return r;
    const cfg = parseState(r);
    if (cfg) this.lastCfg = cfg;
    return cfg || { error: 'unparsable response', hex: hexs(r) };
  }
  async write(cmd, v) {
    const r = await this.writeOut(buildWrite1(cmd, v));
    if (r.error) return r;
    const cfg = parseState(r);
    if (cfg) this.lastCfg = cfg;
    return cfg || { ok: true };
  }
  async writeEQ(vals) {
    if (!Array.isArray(vals) || vals.length !== 10) return { error: 'EQ needs 10 values' };
    const r = await this.writeOut(buildWriteEQ(vals));
    if (r.error) return r;
    const cfg = parseState(r);
    if (cfg) this.lastCfg = cfg;
    return cfg || { ok: true };
  }
}
const speaker = new Speaker();

// ---------------- HTTP ----------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/') && CORS_ANY) {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'authorization, content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (url.pathname.startsWith('/api/') && ACCESS_TOKEN) {
    const auth = req.headers.authorization || '';
    if (auth !== 'Bearer ' + ACCESS_TOKEN) {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'unauthorized' }));
    }
  }
  if (url.pathname === '/api/state') {
    const st = speaker.connected || speaker.connect() ? await speaker.readState() : { error: 'device not connected' };
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(st));
  }
  if (url.pathname === '/api/set' && req.method === 'POST') {
    let body = '';
    for await (const c of req) body += c;
    try {
      const { key, value } = JSON.parse(body);
      const map = {
        lightEffectIndex: CMD.LIGHT_EFFECT, light: CMD.LIGHT_BRIGHTNESS,
        lightToneFlag: CMD.LIGHT_TONE, rgbLightFlag: CMD.RGB_FLAG,
        equalizerIndex: CMD.EQ_INDEX, soundToneFlag: CMD.SOUND_TONE,
        volume: CMD.VOLUME, sleepFlag: CMD.SLEEP_FLAG, sleepValue: CMD.SLEEP_VALUE,
        standbyFlag: CMD.STANDBY_FLAG, standbyValue: CMD.STANDBY_VALUE,
        channel: CMD.CHANNEL, channelPromptFlag: CMD.CHANNEL_TONE_FLAG,
        channelPrompt: CMD.CHANNEL_TONE, syldColorIndex: CMD.SYLD_COLOR,
        colorFlowRate: CMD.COLOR_FLOW, breathingSpeed: CMD.BREATHING,
        agilityOrColorFlag: CMD.AGILITY_COLOR, powerNoticeFlag: CMD.POWER_NOTICE,
        mixLineChannelFlag: CMD.MIX_LINE,
      };
      if (key === 'equalizerHZsValue') {
        const out = await speaker.writeEQ(value);
        return res.end(JSON.stringify(out));
      }
      const cmd = map[key];
      if (!cmd) { res.writeHead(400); return res.end(JSON.stringify({ error: 'unknown key' })); }
      // UI sliders send percent (0-100); device params use smaller scales
      const SCALE = { volume: 16, light: 10, sleepValue: 16, standbyValue: 16, channelPrompt: 16, colorFlowRate: 16, breathingSpeed: 16 };
      let v = value;
      if (key in SCALE) v = Math.max(0, Math.min(SCALE[key], Math.round(Number(value) * SCALE[key] / 100)));
      const out = await speaker.write(cmd, v);
      return res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: String(e.message || e) }));
    }
  }
  if (url.pathname === '/api/restart' && req.method === 'POST') {
    const out = await speaker.writeOut(buildWrite1(115, 0));
    return res.end(JSON.stringify({ ok: !out.error }));
  }
  if (url.pathname === '/api/factory-reset' && req.method === 'POST') {
    const out = await speaker.writeOut(buildWrite1(114, 0));
    return res.end(JSON.stringify({ ok: !out.error }));
  }
  // static
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = join(PUBLIC, p);
  if (!file.startsWith(PUBLIC) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});

server.listen(PORT, HOST, () => {
  console.log(`Xiaomi C-HUB Web Bridge: http://127.0.0.1:${PORT}`);
  console.log(`speaker: ${speaker.connect() ? 'connected (' + speaker.info.product + ')' : 'NOT FOUND — plug in the speaker'}`);
});
