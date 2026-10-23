// IARI Live: the acoustic camera on a phone.  The page comes from iari.io;
// the stream comes straight from the camera on the visitor's own Wi-Fi
// (WsSource), from a simulation (SimSource) or from a recorded session
// (ReplaySource).  One requestAnimationFrame loop shows everything at the
// playout clock of video.js.
//
// URL parameters: ?board=192.168.8.130 (or a name, or a ws(s):// URL)
// connects at once, ?demo starts the simulation, ?replay=URL plays a
// recording.  A QR code with ?board=... is all a visitor needs at a booth.
import { KIND, defaultGrid, uvToPixel } from './proto.js';
import { Clock, H264Player, checkDecoder } from './video.js';
import { Renderer } from './gl.js';
import { Charts } from './charts.js';
import { WsSource, SimSource, ReplaySource, boardUrl, isIOS } from './sources.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } },
};

// ------------------------------------------------------------- state
const S = {
  source: null,
  hello: null,
  overlay: 'none',           // 'burned': the video already carries the map (acam's RTSP picture)
  maps: [],                  // recent maps, oldest first, waiting for the playhead
  shown: { a: null, b: null },
  played: -1,                // seq of the last map handed to the charts
  specs: [],
  label: { name: '', prob: 0, shown: false },
  status: null,
  display: store.get('iari-live-display') || 'spot',
  lastMsg: 0,
  link: 'idle',
  told: false,               // the connect sheet already opened for this source's failure
  bg: null,                  // the simulation's picture
};

const clock = new Clock();
const player = new H264Player(clock, {
  requestKey: () => S.source && S.source.send({ type: 'keyframe' }),
});
let renderer;
try {
  renderer = new Renderer($('gl'));
} catch (e) {
  $('stage').insertAdjacentHTML('beforeend', `<p class="fatal">This browser cannot draw the view (${e.message}).</p>`);
  throw e;
}
const charts = new Charts($('chLevel'), $('chSpec'));
const ov = $('ov'), octx = ov.getContext('2d');

// ------------------------------------------------------------- messages
const sink = {
  state(name, hint) {
    S.link = name;
    chip();
    if (name === 'failed' && hint) {
      $('err').textContent = hint;
      $('err').hidden = false;
      if (!S.told) { S.told = true; openDialog(); }   // once: retries go on quietly
    }
    if (name === 'open') hideError();
  },
  json(j) {
    S.lastMsg = performance.now();
    if (j.type === 'hello') onHello(j);
    else if (j.type === 'status') onStatus(j);
    else if (j.type === 'label') onLabel(j);
  },
  binary(m) {
    S.lastMsg = performance.now();
    if (m.kind === KIND.VIDEO) {
      player.push(m);
    } else if (m.kind === KIND.MAP) {
      clock.observe(m.t);
      S.maps.push(m);
      if (S.maps.length > 12) S.maps.shift();
    } else if (m.kind === KIND.SPECTRUM) {
      clock.observe(m.t);
      S.specs.push(m);
      if (S.specs.length > 12) S.specs.shift();
    }
  },
};

function onHello(h) {
  S.hello = h;
  S.overlay = h.overlay || 'none';
  S.maps = []; S.specs = []; S.played = -1; S.shown = { a: null, b: null };
  clock.reset();
  player.reset();
  charts.clear();
  const g = h.grid || defaultGrid(h.w, h.h, h.fx);
  renderer.setGeometry({ w: h.w || 800, h: h.h || 600, fx: h.fx || 678.6, ...g });
  renderer.hasPic = false;
  $('btnView').hidden = S.overlay === 'burned';      // the board draws its own map into that picture
  S.bg = null;
  if (h.background && S.source && S.source.kind === 'sim') {     // a camera's hello cannot point the page elsewhere
    const img = new Image();
    img.onload = () => { S.bg = img; renderer.setPicture(img); };
    img.src = h.background;
  }
  chip();
}

function onStatus(st) {
  S.status = st;
  // Without maps (the bridge reads acam's log), the status is the only level there is.
  if (!S.maps.length && typeof st.level === 'number') charts.point(st.t, st.level, st.coherence || 0);
}

// acam's rule for its own label (LabelFile): a verdict needs 0.55 while the
// map has a direction and 0.85 while it has not, with 0.15 of hysteresis.
function onLabel(j) {
  const L = S.label, open = currentGate();
  const hi = open ? 0.55 : 0.85, lo = hi - 0.15;
  const show = !!j.name && (L.shown && j.name === L.name ? j.prob >= lo : j.prob >= hi);
  if (show && (!L.shown || j.name !== L.name)) logEvent(j.name, j.prob);
  L.name = j.name; L.prob = j.prob || 0; L.shown = show;
  $('cls').textContent = show ? j.name.toUpperCase() : '—';
  $('pbar').style.width = `${Math.round((show ? L.prob : 0) * 100)}%`;
}

function currentGate() {
  const m = S.shown.b || S.shown.a;
  return m ? m.open : !!(S.status && S.status.gate === 'open');
}

function logEvent(name, prob) {
  const li = document.createElement('li');
  const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  li.innerHTML = `<time>${t}</time><b></b><span>${Math.round(prob * 100)} %</span>`;
  li.querySelector('b').textContent = name.toUpperCase();
  const ol = $('events');
  ol.prepend(li);
  while (ol.children.length > 6) ol.lastChild.remove();
}

// ------------------------------------------------------------- the loop
function frame(ts) {
  requestAnimationFrame(frame);
  if (document.hidden) return;
  const head = clock.playhead();

  if (player.update()) {
    const f = player.take();
    if (f) renderer.setPicture(f);
  }

  // the maps that bracket the playhead, blended
  const view = { beam: S.display === 'beam', mix: 0, fade: 0, spots: [] };
  let a = null, b = null;
  if (S.overlay !== 'burned' && S.maps.length) {
    let i = -1;
    for (let k = 0; k < S.maps.length; k++) if (S.maps[k].t <= head) i = k;
    if (i >= 0) {
      if (i > 0) S.maps.splice(0, i);                    // older ones are done
      a = S.maps[0];
      b = S.maps[1] || a;
      view.mix = b === a ? 0 : Math.min(1, (head - a.t) / (b.t - a.t));
      if (a !== S.shown.a || b !== S.shown.b) {
        renderer.setMaps(a.cells, b.cells, a.nu, a.nv);
        S.shown = { a, b };
      }
      if (a.seq !== S.played) { S.played = a.seq; charts.point(a.t, a.levelDb, a.coherence); }
      view.fade = a.fade + (b.fade - a.fade) * view.mix;
      if (S.display === 'spot') view.spots = spotsOf(a, b, view.mix, view.fade);
    }
  }
  while (S.specs.length && S.specs[0].t <= head) charts.spectrum(S.specs.shift());

  renderer.draw(view);
  drawLabels(a, b, view);
  charts.tick(ts);
  if (ts - (frame.hud || 0) > 500) { frame.hud = ts; hud(a); }
}

const lerp = (x, y, k) => x + (y - x) * k;

// The peak and CLEAN-SC's further sources as discs (acam --spot 36: 36 px at 800x600).
function spotsOf(a, b, k, fade) {
  const g = renderer.geo, R = 36, out = [];
  if (fade < 0.02) return out;
  const pu = lerp(a.peakU, b.peakU, k), pv = lerp(a.peakV, b.peakV, k);
  const [x, y] = uvToPixel(pu, pv, g.w, g.h, g.fx);
  out.push({ x, y, r: R, a: fade, db: lerp(a.spotDb, b.spotDb, k), main: true });
  // the source nearest the peak is the peak itself
  const src = b.sources.length ? b.sources : a.sources;
  let main = -1, best = 1e9;
  src.forEach((s, i) => { const d = Math.hypot(s.u - pu, s.v - pv); if (d < best) { best = d; main = i; } });
  src.forEach((s, i) => {
    if (i === main) return;
    const [sx, sy] = uvToPixel(s.u, s.v, g.w, g.h, g.fx);
    out.push({ x: sx, y: sy, r: R, a: fade, db: s.db, main: false });
  });
  return out;
}

function sizeOverlay() {
  const c = $('gl');
  if (ov.width !== c.width || ov.height !== c.height) { ov.width = c.width; ov.height = c.height; }
}

// Text over the picture: each disc's level, the classifier's verdict above
// the main one (or in the corner while the map has no direction).
function drawLabels(a, b, view) {
  sizeOverlay();
  octx.clearRect(0, 0, ov.width, ov.height);
  const r = renderer.rect, g = renderer.geo;
  if (!r.w) return;
  const sx = r.w / g.w, X = (x) => r.x + x * sx, Y = (y) => r.y + y * sx;
  const px = Math.max(12, Math.round(13 * r.dpr));
  const shown = view.fade > 0.5;
  if (shown) {
    for (const s of view.spots) {
      const txt = s.main ? `${s.db >= 0 ? '+' : ''}${s.db.toFixed(1)} dB` : `${s.db.toFixed(0)} dB`;
      tag(txt, X(s.x + s.r + 6), Y(s.y), px, 'left');
    }
    if (S.display === 'beam' && a) {
      const k = view.mix, [cx, cy] = uvToPixel(lerp(a.peakU, b.peakU, k), lerp(a.peakV, b.peakV, k), g.w, g.h, g.fx);
      cross(X(cx), Y(cy), 12 * sx);
    }
  }
  if (S.label.shown && S.overlay !== 'burned') {
    const big = Math.round(px * 1.35);
    if (shown && view.spots.length) {
      const m = view.spots[0];
      tag(S.label.name.toUpperCase(), X(m.x), Y(m.y - m.r - 10) - big, big, 'center', true);
    } else {
      tag(S.label.name.toUpperCase(), r.x + 16 * r.dpr, r.y + r.h - 16 * r.dpr - big * 1.6, big, 'left', true);
    }
  }
}

function tag(text, x, y, size, align, strong) {
  octx.font = `${strong ? 600 : 500} ${size}px Outfit, Inter, sans-serif`;
  const w = octx.measureText(text).width, pad = size * 0.45, h = size * 1.5;
  let x0 = align === 'center' ? x - w / 2 - pad : x;
  x0 = Math.max(4, Math.min(ov.width - w - 2 * pad - 4, x0));
  const y0 = y - h / 2;
  octx.fillStyle = 'rgba(13,13,12,0.72)';
  octx.beginPath();
  octx.roundRect ? octx.roundRect(x0, y0, w + 2 * pad, h, h / 2) : octx.rect(x0, y0, w + 2 * pad, h);
  octx.fill();
  octx.fillStyle = strong ? '#fff' : '#f4f4f1';
  octx.textBaseline = 'middle';
  octx.fillText(text, x0 + pad, y0 + h / 2 + 1);
}

function cross(x, y, len) {
  octx.strokeStyle = '#fff';
  octx.lineWidth = 2;
  octx.beginPath();
  octx.moveTo(x - len, y); octx.lineTo(x - len / 3, y);
  octx.moveTo(x + len / 3, y); octx.lineTo(x + len, y);
  octx.moveTo(x, y - len); octx.lineTo(x, y - len / 3);
  octx.moveTo(x, y + len / 3); octx.lineTo(x, y + len);
  octx.stroke();
}

// The level, the gate and the link figures, twice a second.
function hud(a) {
  const st = S.status;
  const level = a ? a.levelDb : st && typeof st.level === 'number' ? st.level : null;
  const open = a ? a.open : st && st.gate === 'open';
  $('lvl').textContent = level === null ? '—' : `${level >= 0 ? '+' : ''}${level.toFixed(1)} dB`;
  $('gate').textContent = level === null ? '' : open ? 'source located' : 'no direction';
  $('gate').classList.toggle('on', !!open);
  const parts = [];
  if (S.hello) parts.push(S.hello.source === 'sim' ? 'simulation' : `${S.hello.board || 'camera'} · ${S.hello.source}`);
  if (player.codec) parts.push(`${player.codec} (WebCodecs)`);
  if (st && st.fps) parts.push(`${st.fps.toFixed(1)} fps`);
  if (st && st.maps) parts.push(`${st.maps.toFixed(1)} maps/s`);
  if (clock.offset !== null) parts.push(`buffer ${Math.round(clock.delay * 1000)} ms`);
  $('stats').textContent = parts.join(' · ');
  $('cardLevel').classList.toggle('nodata', !charts.t.length);
  $('cardSpec').classList.toggle('nodata', !charts.spec);
  if (S.link === 'open' && performance.now() - S.lastMsg > 3000) { S.link = 'quiet'; chip(); }
  else if (S.link === 'quiet' && performance.now() - S.lastMsg < 1000) { S.link = 'open'; chip(); }
}

// ------------------------------------------------------------- UI
function chip() {
  const kind = S.source ? S.source.kind : null;
  const map = {
    connecting: ['wait', 'Connecting'], failed: ['bad', 'No camera'], lost: ['wait', 'Reconnecting'],
    quiet: ['wait', 'No data'], idle: ['', 'Not connected'],
  };
  let [cls, text] = map[S.link] || ['live', 'Live'];
  if (S.link === 'open' && kind === 'sim') [cls, text] = ['demo', 'Simulation'];
  if (S.link === 'open' && kind === 'replay') [cls, text] = ['demo', 'Replay'];
  $('chip').className = `chip ${cls}`;
  $('chipText').textContent = text;
}

function showError(text) { $('err').textContent = text; $('err').hidden = false; if (!$('dlg').open) openDialog(); }
function hideError() { $('err').hidden = true; }
function openDialog() { if (!$('dlg').open) $('dlg').showModal(); }

function start(kind, arg) {
  if (S.source) S.source.close();
  S.source = null;
  S.hello = null;
  player.reset();
  charts.clear();
  onLabel({ name: '', prob: 0 });
  S.link = 'idle';
  S.told = false;
  if (kind === 'live') {
    let url;
    try { url = boardUrl(arg); } catch (e) { showError(e.message); return; }
    store.set('iari-live-board', arg);
    S.source = new WsSource(url, sink);
  } else if (kind === 'replay') {
    S.source = new ReplaySource(arg, sink);
  } else {
    S.source = new SimSource(sink);
  }
  chip();
  wake();
}

$('btnConnect').onclick = openDialog;
$('dlgClose').onclick = () => $('dlg').close();
$('go').onclick = () => {
  const a = $('addr').value.trim();
  if (!a) { $('addr').focus(); return; }
  hideError();
  start('live', a);
  $('dlg').close();
};
$('addr').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('go').click(); } });
$('demo').onclick = () => { hideError(); start('sim'); $('dlg').close(); };

$('btnView').onclick = () => {
  S.display = S.display === 'spot' ? 'beam' : 'spot';
  store.set('iari-live-display', S.display);
  $('btnView').textContent = S.display === 'spot' ? 'Spots' : 'Map';
};
$('btnView').textContent = S.display === 'spot' ? 'Spots' : 'Map';

const fsOk = !!document.documentElement.requestFullscreen;
$('btnFull').hidden = !fsOk;
$('btnFull').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
};

// Double tap on the picture: the picture alone (the panel hidden).
let lastTap = 0;
$('stage').addEventListener('pointerup', (e) => {
  if (e.timeStamp - lastTap < 320) document.body.classList.toggle('immersive');
  lastTap = e.timeStamp;
});

// The screen stays on while a stream plays: a demo should not go dark.
let lock = null;
async function wake() {
  if (!('wakeLock' in navigator) || document.hidden || lock) return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
  } catch (_) { /* refused: battery saver */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.source) wake(); });
document.addEventListener('pointerdown', () => { if (S.source) wake(); });   // Safari wants a gesture

// Phones drop WebGL contexts under memory pressure (iOS in particular): rebuild.
$('gl').addEventListener('webglcontextlost', (e) => e.preventDefault());
$('gl').addEventListener('webglcontextrestored', () => {
  const geo = renderer.geo;
  renderer = new Renderer($('gl'));
  renderer.setGeometry(geo);
  S.shown = { a: null, b: null };
  if (S.bg) renderer.setPicture(S.bg);
  player.requestKey();
});

$('platformHint').textContent = isIOS
  ? 'On this iPhone, enter the camera’s secure name (for example acam.iari.io).'
  : 'Enter the camera’s IP address. Chrome asks once whether this page may reach devices on your network: allow it.';

checkDecoder().then((why) => {
  if (why) { $('decNote').textContent = `Live video is not available here (${why}); the map, the level and the classifier still are.`; $('decNote').hidden = false; }
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ------------------------------------------------------------- go
const q = new URLSearchParams(location.search);
$('addr').value = q.get('board') || store.get('iari-live-board') || '';
if (q.get('board')) start('live', q.get('board'));
else if (q.get('replay')) start('replay', q.get('replay'));
else start('sim');
requestAnimationFrame(frame);
