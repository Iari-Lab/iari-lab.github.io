// The level over the room's floor, the coherence and the spectrum, with
// uPlot (vendor/uPlot.iife.min.js, loaded before this module as a global).
// The data arrive at the map rate (~23/s); the plots redraw at most 15
// times a second and not at all while the page is hidden.

const WINDOW_S = 30;
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function sizeOf(el) {
  const r = el.getBoundingClientRect();
  return { width: Math.max(200, Math.floor(r.width)), height: Math.max(90, Math.floor(r.height)) };
}

export class Charts {
  constructor(levelEl, specEl) {
    this.levelEl = levelEl;
    this.specEl = specEl;
    this.t = []; this.level = []; this.coh = [];
    this.spec = null;
    this.dirty = false;
    this.last = 0;
    const accent = css('--accent') || '#ff4a1a';
    const muted = css('--on-dark-muted') || '#a6a6a0';
    const grid = { stroke: css('--dark-line') || '#2a2a27', width: 1 };
    const axis = { stroke: muted, grid, ticks: { show: false }, font: '11px Inter, sans-serif', size: 30 };

    this.lp = new uPlot({
      ...sizeOf(levelEl),
      legend: { show: false },
      cursor: { show: false },
      scales: { x: { time: false }, db: { range: [0, 60] }, coh: { range: [0, 1] } },
      axes: [
        { ...axis, values: (u, v) => v.map((x) => `${Math.round(x - (this.t.at(-1) || 0))} s`) },
        { ...axis, scale: 'db', values: (u, v) => v.map((x) => `${x}`), size: 34, label: 'dB', labelSize: 14, labelFont: '11px Inter, sans-serif' },
        { ...axis, scale: 'coh', side: 1, grid: { show: false }, size: 30 },
      ],
      series: [
        {},
        { scale: 'db', stroke: accent, width: 2, fill: accent + '22', points: { show: false } },
        { scale: 'coh', stroke: muted, width: 1, dash: [4, 3], points: { show: false } },
      ],
    }, [[], [], []], levelEl);

    this.sp = new uPlot({
      ...sizeOf(specEl),
      legend: { show: false },
      cursor: { show: false },
      scales: { x: { time: false }, y: { range: [-80, 0] } },
      axes: [
        { ...axis, values: (u, v) => v.map((x) => `${(x / 1000).toFixed(x % 1000 ? 1 : 0)}k`) },
        { ...axis, size: 34, label: 'dB', labelSize: 14, labelFont: '11px Inter, sans-serif' },
      ],
      series: [
        {},
        { stroke: accent, width: 2, fill: accent + '33', points: { show: false } },
        { stroke: muted, width: 1, points: { show: false } },
      ],
    }, [[], [], []], specEl);

    this.ro = new ResizeObserver(() => {
      this.lp.setSize(sizeOf(levelEl));
      this.sp.setSize(sizeOf(specEl));
    });
    this.ro.observe(levelEl);
    this.ro.observe(specEl);
  }

  clear() {
    this.t = []; this.level = []; this.coh = []; this.spec = null;
    this.lp.setData([[], [], []]);
    this.sp.setData([[], [], []]);
  }

  // One point per map (or per status line when only that is known).
  point(t, levelDb, coherence) {
    if (this.t.length && t < this.t.at(-1)) this.clear();   // the sender restarted
    this.t.push(t); this.level.push(Math.max(0, levelDb)); this.coh.push(coherence);
    while (this.t.length && this.t[0] < t - WINDOW_S) { this.t.shift(); this.level.shift(); this.coh.shift(); }
    this.dirty = true;
  }

  spectrum(m) {
    const n = m.db.length;
    if (!this.spec || this.spec.f.length !== n) {
      this.spec = { f: Float64Array.from({ length: n }, (_, i) => m.f0 + i * m.df), db: new Float64Array(n), hold: new Float64Array(n).fill(-120), t: m.t };
    }
    const s = this.spec, decay = Math.max(0, m.t - s.t) * 12;   // the hold falls 12 dB/s
    s.t = m.t;
    for (let i = 0; i < n; i++) {
      s.db[i] = m.db[i];
      s.hold[i] = Math.max(m.db[i], s.hold[i] - decay);
    }
    this.dirty = true;
  }

  // From the animation loop.
  tick(now) {
    if (!this.dirty || now - this.last < 66 || document.hidden) return;
    this.last = now;
    this.dirty = false;
    if (this.t.length) {
      const t1 = this.t.at(-1);
      this.lp.batch(() => {
        this.lp.setData([this.t, this.level, this.coh], false);
        this.lp.setScale('x', { min: t1 - WINDOW_S, max: t1 });
      });
    }
    if (this.spec) this.sp.setData([this.spec.f, this.spec.db, this.spec.hold]);
  }
}
