// Where the stream comes from: the camera (or the lab bridge) over a
// WebSocket, a simulation in the page, or a recorded session.  All three
// hand the same messages to a sink: { state(name, hint), json(obj), binary(msg) }.
import { parseBinary, encodeMap, encodeSpectrum, defaultGrid } from './proto.js';

const now = () => performance.now() / 1000;

// ------------------------------------------------------------- addresses
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
export const isIpLiteral = (h) => IPV4.test(h) || /^\[[0-9a-f:.]+\]$/i.test(h);
const isLocalName = (h) => isIpLiteral(h) || h === 'localhost' || h.endsWith('.local');

// "192.168.8.130" -> ws://192.168.8.130:8090/acam (Chrome lets a secure page
// reach a private IP literal once the visitor allows local network access);
// "acam.iari.io"  -> wss://acam.iari.io:8443/acam (a name with a certificate,
// for Safari/iPhone, which never allow ws:// from a secure page).
export function boardUrl(addr) {
  addr = addr.trim();
  if (/^wss?:\/\//i.test(addr)) return addr;
  const m = addr.match(/^(\[[^\]]+\]|[^/:]+)(?::(\d+))?(\/.*)?$/);
  if (!m) throw new Error(`not an address: ${addr}`);
  const local = isLocalName(m[1]);
  return `${local ? 'ws' : 'wss'}://${m[1]}:${m[2] || (local ? 8090 : 8443)}${m[3] || '/acam'}`;
}

const ua = navigator.userAgent;
export const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const isSafari = isIOS || (/Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua));
const isFirefox = /Firefox\//.test(ua);

// Why a connection that never opened failed, as far as the page can tell.
export function diagnose(url) {
  const u = new URL(url.replace(/^ws/, 'http'));
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const insecure = url.startsWith('ws:') && location.protocol === 'https:';
  if (insecure && (isSafari || isIOS)) {
    return 'iPhone and Safari never let a secure page open an unencrypted (ws://) connection. Use the camera’s secure name (wss://, see “How it connects”).';
  }
  if (insecure && isFirefox) return 'Firefox blocks ws:// from a secure page. Use Chrome, or the camera’s secure name (wss://).';
  if (insecure && !isLocalName(u.hostname)) return 'A secure page can reach ws:// only at an IP address (e.g. 192.168.8.130) or a .local name.';
  if (insecure) return `No answer from ${host}. Same Wi-Fi as the camera? If Chrome asked about devices on your local network, choose Allow (lock icon → Site settings → Local network access).`;
  return `No answer from ${host}. Same Wi-Fi as the camera, and the camera’s stream running?`;
}

// ------------------------------------------------------------- the camera
export class WsSource {
  constructor(url, sink) {
    this.kind = 'live';
    this.url = url;
    this.sink = sink;
    this.tries = 0;
    this.closed = false;
    this.connect();
  }

  connect() {
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      this.sink.state('failed', `${e.message || e}. ${diagnose(this.url)}`);
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    let opened = false;
    this.sink.state('connecting');
    ws.onopen = () => {
      opened = true;
      this.tries = 0;
      this.sink.state('open');
      ws.send(JSON.stringify({ type: 'hello', client: 'iari-live/0.1' }));
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        let j;
        try { j = JSON.parse(ev.data); } catch (_) { return; }
        this.sink.json(j);
      } else {
        this.sink.binary(parseBinary(ev.data));
      }
    };
    ws.onclose = () => {
      if (this.closed) return;
      this.sink.state(opened ? 'lost' : 'failed', opened ? null : diagnose(this.url));
      this.timer = setTimeout(() => this.connect(), Math.min(5000, 1000 * 2 ** this.tries++));
    };
  }

  send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    if (this.ws) this.ws.close();
  }
}

// ------------------------------------------------------------- simulation
// The lab as the camera sees it (live/lab-view.jpg, a frame from the board
// with the gate shut), with sources placed on what is in the picture, and a
// sound map built the way acam builds its own: the smoothing, the 2 dB
// display range capped at 8 % of the view, the gate on coherence and level.
const RATE = 23.5;
const SCRIPT_S = 48;
const px2uv = (x, y, fx = 678.6) => { const p = x - 400, q = y - 300, n = Math.hypot(p, q, fx); return [p / n, q / n]; };
const SPEAKER = px2uv(400, 165);        // the Zero on its stand
const STRIP = px2uv(185, 205);          // the power strip on the left

function scene(t) {
  const s = t % SCRIPT_S, out = [];
  if (s >= 3 && s < 15) out.push({ cls: 'vacuum', uv: SPEAKER, db: 34, sigma: 0.2 });
  if (s >= 15 && s < 29) {                                     // an alarm carried across the room
    const k = (s - 15) / 14, x = 140 + 520 * (0.5 - 0.5 * Math.cos(2 * Math.PI * k)), y = 215 + 40 * Math.sin(2 * Math.PI * k);
    if ((s * 2.5) % 1 < 0.6) out.push({ cls: 'alarm', uv: px2uv(x, y), db: 30, sigma: 0.3 });
  }
  if (s >= 29 && s < 41) {
    out.push({ cls: 'vacuum', uv: SPEAKER, db: 34, sigma: 0.2 });
    out.push({ cls: 'rain', uv: STRIP, db: 30.5, sigma: 0.24 });
  }
  return out;
}

export class SimSource {
  constructor(sink) {
    this.kind = 'sim';
    this.sink = sink;
    this.g = defaultGrid();
    const n = this.g.nu * this.g.nv;
    this.Ps = new Float32Array(n);
    this.state = { open: false, fade: 0, peakU: 0, peakV: 0, floor: 1, Es: 1, seq: 0, labelT: 0, verdict: null };
    this.t0 = now();
    sink.state('open');
    sink.json({
      type: 'hello', proto: 1, source: 'sim', board: 'simulation', w: 800, h: 600, fx: 678.6,
      grid: this.g, overlay: 'none', background: 'lab-view.jpg', fps: RATE,
    });
    this.timer = setInterval(() => this.step(), 1000 / RATE);
  }

  step() {
    const t = now() - this.t0, dt = 1 / RATE, g = this.g, S = this.state;
    const src = scene(t);
    // the beam: each source's power spread by its spectrum's beam width, over a noisy floor
    const P = new Float32Array(this.Ps.length);
    let total = 0;
    for (let j = 0; j < g.nv; j++) {
      for (let i = 0; i < g.nu; i++) {
        const u = g.u0 + i * g.du, v = g.v0 + j * g.dv;
        let p = 1 + 0.35 * Math.random();
        for (const s of src) {
          const d2 = (u - s.uv[0]) ** 2 + (v - s.uv[1]) ** 2;
          p += 10 ** (s.db / 10) * Math.exp(-d2 / (2 * s.sigma * s.sigma)) * (0.9 + 0.2 * Math.random());
        }
        P[j * g.nu + i] = p;
      }
    }
    for (const s of src) total += 10 ** (s.db / 10);
    // acam's asymmetric smoothing: up with 0.1 s, down with 0.25 s
    const au = Math.exp(-dt / 0.1), ad = Math.exp(-dt / 0.25);
    let mx = 0;
    for (let i = 0; i < P.length; i++) {
      const a = P[i] > this.Ps[i] ? au : ad;
      this.Ps[i] = a * this.Ps[i] + (1 - a) * P[i];
      mx = Math.max(mx, this.Ps[i]);
    }
    const E = 1 + total * 0.2, ae = E > S.Es ? au : ad;
    S.Es = ae * S.Es + (1 - ae) * E;
    const levelDb = 10 * Math.log10(S.Es / S.floor);
    const coherence = (total * 4e-4) / (total * 4e-4 + 1.4) + 0.02 * Math.random();
    const coherent = coherence > 0.12 || (S.open && coherence > 0.084);
    const loud = levelDb > 10 || (S.open && levelDb > 7);
    S.open = coherent && loud;
    const fa = Math.exp(-dt / (S.open ? 0.1 : 0.4));
    S.fade = fa * S.fade + (1 - fa) * (S.open ? 1 : 0);
    // display range: 2 dB below the peak, at most 8 % of the cells lit
    const sorted = Array.from(this.Ps).sort((a, b) => b - a);
    const keep = Math.max(1, Math.floor(0.08 * sorted.length));
    const dyn = Math.min(2, Math.max(0.5, 10 * Math.log10(mx / sorted[keep - 1])));
    const cells = new Uint8Array(P.length);
    let cu = 0, cv = 0, cw = 0;
    for (let i = 0; i < P.length; i++) {
      const db = 10 * Math.log10(this.Ps[i] / mx);
      cells[i] = Math.round(Math.max(0, Math.min(1, (db + dyn) / dyn)) * 255);
      if (this.Ps[i] >= mx * 0.794) {
        const w = this.Ps[i] - mx * 0.794 + 1e-3 * mx;
        cu += w * (g.u0 + (i % g.nu) * g.du); cv += w * (g.v0 + Math.floor(i / g.nu) * g.dv); cw += w;
      }
    }
    // the cross: centroid of the top 1 dB, low-passed (0.3 s), snapping on big moves
    const nu_ = cu / cw, nv_ = cv / cw;
    const snap = !S.open || Math.abs(nu_ - S.peakU) > 0.25 || Math.abs(nv_ - S.peakV) > 0.25;
    const ap = snap ? 0 : Math.exp(-dt / 0.3);
    S.peakU = ap * S.peakU + (1 - ap) * nu_;
    S.peakV = ap * S.peakV + (1 - ap) * nv_;
    // CLEAN-SC's list: the sources, strongest first, dB below the first
    const strongest = Math.max(...src.map((s) => s.db), 0);
    const sources = S.open ? src.slice().sort((a, b) => b.db - a.db).map((s) => ({
      u: s.uv[0] + 0.006 * (Math.random() - 0.5), v: s.uv[1] + 0.006 * (Math.random() - 0.5), db: s.db - strongest,
    })) : [];
    const tt = now();
    const buf = encodeMap({
      seq: S.seq++, t: tt, nu: g.nu, nv: g.nv, open: S.open, fabric: true,
      levelDb, spotDb: levelDb, coherence, contrastDb: 10 * Math.log10(mx / (sorted.reduce((a, b) => a + b, 0) / sorted.length)),
      peakU: S.peakU, peakV: S.peakV, fade: S.fade, dynDb: dyn, sources, cells,
    });
    this.sink.binary(parseBinary(buf));
    this.sink.binary(parseBinary(this.spectrum(S.seq, tt, src)));
    if (tt - S.labelT > 0.5) {                     // the classifier's verdict, twice a second
      S.labelT = tt;
      const top = src.slice().sort((a, b) => b.db - a.db)[0];
      const label = top ? { type: 'label', name: top.cls, prob: 0.78 + 0.18 * Math.random(), t: tt } : { type: 'label', name: '', prob: 0, t: tt };
      this.sink.json(label);
      this.sink.json({ type: 'status', t: tt, fps: RATE, maps: RATE, source: 'sim' });
    }
  }

  // 64 bins up to 8 kHz: a pinkish floor, the vacuum's broadband hump and
  // motor line, the alarm's tone and harmonic, the rain's flat hiss.
  spectrum(seq, t, src) {
    const n = 64, df = 125, db = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) * df;
      let p = 10 ** ((-68 - 6 * Math.log2(1 + f / 1000)) / 10);
      for (const s of src) {
        if (s.cls === 'vacuum') p += 10 ** ((-34 - 8 * ((Math.log2(f / 2500)) ** 2)) / 10) + (Math.abs(f - 1187) < 70 ? 10 ** (-24 / 10) : 0);
        if (s.cls === 'alarm') p += (Math.abs(f - 3150) < 70 ? 10 ** (-14 / 10) : 0) + (Math.abs(f - 6300) < 70 ? 10 ** (-30 / 10) : 0);
        if (s.cls === 'rain') p += 10 ** ((-42 - 3 * Math.log2(1 + f / 4000)) / 10);
      }
      db[i] = 10 * Math.log10(p) + 1.5 * (Math.random() - 0.5);
    }
    return encodeSpectrum(seq, t, df / 2, df, db);
  }

  send() {}
  close() { clearInterval(this.timer); }
}

// ------------------------------------------------------------- replay
// A session recorded by the bridge (acam_ws_bridge.py --record): "ACWS1\n",
// then per message f64 arrival time (s), u32 length, u8 1 = JSON text /
// 0 = binary, and the message.  Played with its own timing, looped.
export function parseAcws(buf) {
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, 6));
  if (head !== 'ACWS1\n') throw new Error('not an ACWS1 recording');
  const dv = new DataView(buf), out = [];
  for (let o = 6; o + 13 <= buf.byteLength;) {
    const t = dv.getFloat64(o, true), len = dv.getUint32(o + 8, true), text = dv.getUint8(o + 12) === 1;
    o += 13;
    if (o + len > buf.byteLength) break;
    out.push({ t, text, data: buf.slice(o, o + len) });
    o += len;
  }
  return out;
}

export class ReplaySource {
  constructor(url, sink) {
    this.kind = 'replay';
    this.sink = sink;
    this.closed = false;
    sink.state('connecting');
    fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.arrayBuffer();
    }).then((buf) => {
      this.recs = parseAcws(buf);
      if (!this.recs.length) throw new Error('the recording is empty');
      sink.state('open');
      this.play();
    }).catch((e) => sink.state('failed', `Cannot play ${url}: ${e.message || e}`));
  }

  play() {
    if (this.closed) return;
    this.i = 0;
    this.t0 = now() - this.recs[0].t;
    this.pump();
  }

  pump() {
    if (this.closed) return;
    const t = now() - this.t0, r = this.recs, dec = new TextDecoder();
    while (this.i < r.length && r[this.i].t <= t) {
      const m = r[this.i++];
      if (m.text) {
        try { this.sink.json(JSON.parse(dec.decode(m.data))); } catch (_) { /* skip */ }
      } else {
        this.sink.binary(parseBinary(m.data));
      }
    }
    if (this.i >= r.length) { this.timer = setTimeout(() => this.play(), 800); return; }
    this.timer = setTimeout(() => this.pump(), Math.max(1, Math.min(20, (r[this.i].t - t) * 1000)));
  }

  send() {}
  close() { this.closed = true; clearTimeout(this.timer); }
}
