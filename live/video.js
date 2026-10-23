// H.264 from the camera, decoded by the phone's own hardware (WebCodecs), and
// a playout clock that shows every frame at its sender time plus a small,
// adaptive delay: Wi-Fi delivers frames in bursts, the screen shows them
// evenly.  The map and the charts use the same clock, so they stay in step
// with the picture.
import { codecFromAnnexB } from './proto.js';

const now = () => performance.now() / 1000;

export class Clock {
  constructor() { this.reset(); }
  reset() {
    this.offset = null;        // local - sender, the smallest seen (the least delayed message)
    this.delay = 0.12;         // playout delay on top of it, s
    this.late = [];            // how late each message came, s
  }
  // Every timestamped message on arrival.
  observe(t) {
    const off = now() - t;
    if (this.offset === null || off < this.offset) this.offset = off;
    else this.offset += (off - this.offset) * 0.0005;                          // follows clock drift, ~1.5 min
    if (off - this.offset > 5) { this.offset = off; this.late.length = 0; }     // a long stall: start over
    this.late.push(off - this.offset);
    if (this.late.length >= 48) {
      const s = this.late.slice().sort((a, b) => a - b);
      const want = Math.min(0.5, Math.max(0.03, s[Math.floor(s.length * 0.9)] + 0.02));
      this.delay += (want - this.delay) * (want > this.delay ? 0.5 : 0.1);   // grow fast, shrink slowly
      this.late.length = 0;
    }
  }
  // The sender time being shown now.
  playhead() { return this.offset === null ? -Infinity : now() - this.offset - this.delay; }
}

export class H264Player {
  constructor(clock, { requestKey = () => {}, onInfo = () => {} } = {}) {
    this.clock = clock;
    this.requestKey = requestKey;
    this.onInfo = onInfo;
    this.supported = typeof VideoDecoder === 'function';
    this.queue = [];           // decoded frames waiting for their time
    this.current = null;       // the frame on screen (owned here)
    this.fresh = false;        // current changed since the last take()
    this.waitKey = true;
    this.decoder = null;
    this.codec = null;
    this.stats = { decoded: 0, shown: 0, dropped: 0 };
  }

  push(m) {
    if (!this.supported) return;
    if (!m.catchup) this.clock.observe(m.t);
    if (this.waitKey && !m.key) return;
    if (!this.decoder || this.decoder.state === 'closed') {
      if (!m.key) return;
      this.configure(codecFromAnnexB(m.data) || 'avc1.42e01f');
    }
    if (this.decoder.decodeQueueSize > 10) {          // the decoder fell behind: skip to the next IDR
      this.waitKey = true;
      this.stats.dropped++;
      this.requestKey();
      return;
    }
    this.waitKey = false;
    try {
      this.decoder.decode(new EncodedVideoChunk({
        type: m.key ? 'key' : 'delta',
        timestamp: Math.round(m.t * 1e6),
        data: m.data,
      }));
    } catch (e) {
      this.fail(e);
    }
  }

  configure(codec) {
    this.codec = codec;
    this.decoder = new VideoDecoder({
      output: (f) => this.output(f),
      error: (e) => this.fail(e),
    });
    // No description: the chunks are Annex B with SPS/PPS in band.
    this.decoder.configure({ codec, optimizeForLatency: true });
    this.onInfo({ codec });
  }

  fail(e) {
    console.warn('decoder:', e);
    try { this.decoder && this.decoder.state !== 'closed' && this.decoder.close(); } catch (_) {}
    this.decoder = null;
    this.waitKey = true;
    this.requestKey();
  }

  output(frame) {
    this.stats.decoded++;
    this.queue.push(frame);
    while (this.queue.length > 8) { this.queue.shift().close(); this.stats.dropped++; }
  }

  // The frame to show at the clock's playhead; true when it changed.
  update() {
    const head = this.clock.playhead();
    let pick = -1;
    for (let i = 0; i < this.queue.length; i++) if (this.queue[i].timestamp / 1e6 <= head) pick = i;
    if (pick < 0 && !this.current && this.queue.length) pick = 0;   // the very first frame: show it at once
    if (pick < 0) return false;
    for (let i = 0; i < pick; i++) { this.queue[i].close(); this.stats.dropped++; }
    if (this.current) this.current.close();
    this.current = this.queue[pick];
    this.queue = this.queue.slice(pick + 1);
    this.stats.shown++;
    this.fresh = true;
    return true;
  }

  // The current frame if it is new since the last call, else null.
  take() {
    if (!this.fresh) return null;
    this.fresh = false;
    return this.current;
  }

  reset() {
    for (const f of this.queue) f.close();
    this.queue = [];
    if (this.current) { this.current.close(); this.current = null; }
    try { this.decoder && this.decoder.state !== 'closed' && this.decoder.close(); } catch (_) {}
    this.decoder = null;
    this.waitKey = true;
  }
}

// Whether this browser decodes the camera's stream (Constrained Baseline,
// level 3.1 covers 800x600 at 30 fps); resolves to a short reason when not.
export async function checkDecoder() {
  if (typeof VideoDecoder !== 'function') {
    return window.isSecureContext ? 'no WebCodecs in this browser' : 'WebCodecs needs HTTPS';
  }
  try {
    const r = await VideoDecoder.isConfigSupported({ codec: 'avc1.42e01f', optimizeForLatency: true });
    return r.supported ? null : 'H.264 is not supported here';
  } catch (e) {
    return String(e.message || e);
  }
}
