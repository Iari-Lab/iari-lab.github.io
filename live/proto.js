// acam-ws v1: the stream between the acoustic camera (or the lab bridge) and
// IARI Live.  One WebSocket; text frames are JSON, binary frames carry a
// 16-byte header (little-endian) and a payload:
//
//   0  u8   kind      1 video, 2 map, 3 spectrum, 4 audio (reserved)
//   1  u8   flags     video: bit0 key, bit1 catch-up (decode, do not show)
//                     map:   bit0 gate open, bit1 map from the FPGA
//   2  u16  n         map: nu | nv << 8;  spectrum: bins
//   4  u32  seq
//   8  f64  t         seconds on the sender's clock (the same clock for all kinds)
//
//   video     H.264 access unit, Annex B (SPS + PPS in front of every IDR)
//   map       8 x f32: level dB over the room's floor, the spot's dB, coherence,
//             contrast dB, peak u, peak v, fade 0..1, display range dB;
//             u8 sources + 3 pad; per source 3 x f32 (u, v, dB below the first);
//             nu * nv u8 cells, row-major from the top-left (0 = nothing, 255 = peak)
//   spectrum  f32 f0 (Hz), f32 df (Hz), bins x f32 dB
//
// JSON from the sender: hello (first; the camera's geometry), status (~1/s),
// label (the classifier's verdict).  From the viewer: hello, keyframe (asks
// for an IDR, e.g. after a decoder error).  The full specification is in the
// acamera repository, docs/acam/phone_app_plan.md.

export const KIND = { VIDEO: 1, MAP: 2, SPECTRUM: 3, AUDIO: 4 };
const HDR = 16;

export function parseBinary(buf) {
  const dv = new DataView(buf);
  const kind = dv.getUint8(0), flags = dv.getUint8(1), n = dv.getUint16(2, true);
  const seq = dv.getUint32(4, true), t = dv.getFloat64(8, true);
  if (kind === KIND.VIDEO) {
    return { kind, key: !!(flags & 1), catchup: !!(flags & 2), seq, t, data: new Uint8Array(buf, HDR) };
  }
  if (kind === KIND.MAP) {
    const nu = n & 255, nv = n >> 8;
    const f = (i) => dv.getFloat32(HDR + 4 * i, true);
    const ns = dv.getUint8(HDR + 32);
    const sources = [];
    let o = HDR + 36;
    for (let i = 0; i < ns; i++, o += 12) {
      sources.push({ u: dv.getFloat32(o, true), v: dv.getFloat32(o + 4, true), db: dv.getFloat32(o + 8, true) });
    }
    return {
      kind, seq, t, nu, nv, open: !!(flags & 1), fabric: !!(flags & 2),
      levelDb: f(0), spotDb: f(1), coherence: f(2), contrastDb: f(3),
      peakU: f(4), peakV: f(5), fade: f(6), dynDb: f(7),
      sources, cells: new Uint8Array(buf, o, nu * nv),
    };
  }
  if (kind === KIND.SPECTRUM) {
    const f0 = dv.getFloat32(HDR, true), df = dv.getFloat32(HDR + 4, true);
    const db = new Float32Array(n);
    for (let i = 0; i < n; i++) db[i] = dv.getFloat32(HDR + 8 + 4 * i, true);
    return { kind, seq, t, f0, df, db };
  }
  return { kind, flags, n, seq, t, data: new Uint8Array(buf, HDR) };
}

function header(dv, kind, flags, n, seq, t) {
  dv.setUint8(0, kind); dv.setUint8(1, flags); dv.setUint16(2, n, true);
  dv.setUint32(4, seq >>> 0, true); dv.setFloat64(8, t, true);
}

// The simulator builds its messages with these, so a simulated stream runs
// through the same parser as the camera's.
export function encodeMap(m) {
  const ns = m.sources.length, cells = m.nu * m.nv;
  const buf = new ArrayBuffer(HDR + 36 + 12 * ns + cells);
  const dv = new DataView(buf);
  header(dv, KIND.MAP, (m.open ? 1 : 0) | (m.fabric ? 2 : 0), m.nu | (m.nv << 8), m.seq, m.t);
  [m.levelDb, m.spotDb, m.coherence, m.contrastDb, m.peakU, m.peakV, m.fade, m.dynDb]
    .forEach((x, i) => dv.setFloat32(HDR + 4 * i, x, true));
  dv.setUint8(HDR + 32, ns);
  let o = HDR + 36;
  for (const s of m.sources) {
    dv.setFloat32(o, s.u, true); dv.setFloat32(o + 4, s.v, true); dv.setFloat32(o + 8, s.db, true);
    o += 12;
  }
  new Uint8Array(buf, o, cells).set(m.cells);
  return buf;
}

export function encodeSpectrum(seq, t, f0, df, db) {
  const buf = new ArrayBuffer(HDR + 8 + 4 * db.length);
  const dv = new DataView(buf);
  header(dv, KIND.SPECTRUM, 0, db.length, seq, t);
  dv.setFloat32(HDR, f0, true); dv.setFloat32(HDR + 4, df, true);
  for (let i = 0; i < db.length; i++) dv.setFloat32(HDR + 8 + 4 * i, db[i], true);
  return buf;
}

// The NAL unit types in an Annex B access unit.
export function nalTypes(u8) {
  const types = [];
  for (let i = 0; i + 3 < u8.length; i++) {
    if (u8[i] === 0 && u8[i + 1] === 0 && u8[i + 2] === 1) { types.push(u8[i + 3] & 31); i += 3; }
  }
  return types;
}

// The WebCodecs codec string ("avc1.PPCCLL") from the access unit's SPS,
// or null when it carries none.
export function codecFromAnnexB(u8) {
  for (let i = 0; i + 6 < u8.length; i++) {
    if (u8[i] === 0 && u8[i + 1] === 0 && u8[i + 2] === 1 && (u8[i + 3] & 31) === 7) {
      const hex = (b) => b.toString(16).padStart(2, '0');
      return 'avc1.' + hex(u8[i + 4]) + hex(u8[i + 5]) + hex(u8[i + 6]);
    }
  }
  return null;
}

// The map's grid in the camera's direction cosines, as acam builds it
// (bf_core.hpp): cell centres from (u0, v0) to (-u0, -v0) across the picture.
export function defaultGrid(w = 800, h = 600, fx = 678.6, nu = 16, nv = 12) {
  const u0 = -(w / 2) / Math.hypot(w / 2, fx), v0 = -(h / 2) / Math.hypot(h / 2, fx);
  return { nu, nv, u0, v0, du: (-2 * u0) / (nu - 1), dv: (-2 * v0) / (nv - 1) };
}

// Direction cosines -> picture pixels (pinhole, principal point at the centre).
export function uvToPixel(u, v, w, h, fx) {
  const z = Math.sqrt(Math.max(1e-6, 1 - u * u - v * v));
  return [w / 2 + (fx * u) / z, h / 2 + (fx * v) / z];
}
