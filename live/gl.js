// The picture and the sound map in one WebGL2 pass.  The map is the board's
// 16x12 grid in direction cosines, sampled bilinearly through the pinhole
// model and coloured with the ramp acam burns into its own video
// (acam_view.hpp, Overlay), so both look the same; here it is drawn at the
// screen's refresh rate and blended between the last two maps.

const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);   // top-left origin, like the picture
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uPic, uMapA, uMapB, uLut;
uniform float uHasPic, uMix, uFade, uFx, uBeam;
uniform vec2 uSize, uN;
uniform vec4 uGrid;                  // u0, v0, du, dv
uniform vec4 uSpot[4];               // pixel x, y, radius, alpha
uniform int uSpots;
out vec4 o;
vec4 ramp(float l) { return texture(uLut, vec2(l, 0.5)); }
void main() {
  vec3 c = uHasPic > 0.5 ? texture(uPic, vUv).rgb : vec3(0.06);
  vec2 p = vUv * uSize;
  if (uBeam > 0.5 && uFade > 0.0) {
    vec2 q = p - 0.5 * uSize;
    vec2 dc = q / length(vec3(q, uFx));               // direction cosines of this pixel
    vec2 g = clamp((dc - uGrid.xy) / uGrid.zw, vec2(0.0), uN - 1.0);
    vec2 tc = (g + 0.5) / uN;
    float l = mix(texture(uMapA, tc).r, texture(uMapB, tc).r, uMix);
    vec4 r = ramp(l);
    c = mix(c, r.rgb, r.a * uFade * step(2.5 / 255.0, l));
  }
  for (int i = 0; i < 4; i++) {
    if (i >= uSpots) break;
    vec4 s = uSpot[i];
    float d2 = dot(p - s.xy, p - s.xy) / (s.z * s.z);
    float edge = 1.0 - smoothstep(1.0 - 2.0 / s.z, 1.0, sqrt(d2));   // anti-aliased rim
    vec4 r = ramp(0.3 + 0.7 * max(0.0, 1.0 - d2));
    c = mix(c, r.rgb, r.a * s.w * edge);
  }
  o = vec4(c, 1.0);
}`;

// acam's ramp: transparent -> purple -> magenta -> orange -> yellow (rgb 0..255, alpha 0..1)
const STOPS = [[0, 0, 0, 0, 0], [0.25, 59, 15, 79, 0.4], [0.55, 166, 32, 106, 0.6],
  [0.8, 239, 125, 50, 0.72], [1, 255, 212, 0, 0.82]];

function lutPixels() {
  const px = new Uint8Array(256 * 4);
  for (let l = 0; l < 256; l++) {
    const t = l / 255;
    let s = 0;
    while (s < 3 && t > STOPS[s + 1][0]) s++;
    const f = (t - STOPS[s][0]) / (STOPS[s + 1][0] - STOPS[s][0]);
    for (let q = 0; q < 4; q++) {
      const v = STOPS[s][q + 1] + f * (STOPS[s + 1][q + 1] - STOPS[s][q + 1]);
      px[l * 4 + q] = q < 3 ? Math.round(v) : Math.round(v * 255);
    }
  }
  return px;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      desynchronized: true, powerPreference: 'high-performance', preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.prog = this.program(VS, FS);
    this.loc = {};
    for (const n of ['uPic', 'uMapA', 'uMapB', 'uLut', 'uHasPic', 'uMix', 'uFade', 'uFx', 'uBeam',
      'uSize', 'uN', 'uGrid', 'uSpot', 'uSpots']) this.loc[n] = gl.getUniformLocation(this.prog, n);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(this.prog, 'aPos');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.tPic = this.texture(gl.LINEAR);
    this.tMapA = this.texture(gl.LINEAR);
    this.tMapB = this.texture(gl.LINEAR);
    this.tLut = this.texture(gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, this.tLut);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lutPixels());
    this.hasPic = false;
    this.picSize = [800, 600];
    this.geo = { w: 800, h: 600, fx: 678.6, nu: 16, nv: 12, u0: -0.508, v0: -0.404, du: 0.0677, dv: 0.0735 };
    this.mapSize = [0, 0];
    this.bitmapPath = false;      // set when this browser cannot upload a VideoFrame directly
    this.rect = { x: 0, y: 0, w: 0, h: 0 };
    this.cover = false;
  }

  program(vs, fs) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  texture(filter) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  setGeometry(g) { this.geo = { ...this.geo, ...g }; }

  // A VideoFrame, an image or a bitmap.  Returns false if the upload must
  // wait (the bitmap path is asynchronous).
  setPicture(src) {
    const gl = this.gl;
    const w = src.displayWidth || src.naturalWidth || src.width, h = src.displayHeight || src.naturalHeight || src.height;
    if (!this.bitmapPath) {
      try {
        gl.bindTexture(gl.TEXTURE_2D, this.tPic);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
        this.hasPic = true;
        this.picSize = [w, h];
        return true;
      } catch (e) {
        if (typeof VideoFrame === 'undefined' || !(src instanceof VideoFrame)) throw e;
        this.bitmapPath = true;   // older Safari: no VideoFrame upload; go through a bitmap
      }
    }
    if (this.pending) return false;
    this.pending = true;
    createImageBitmap(src).then((bmp) => {
      gl.bindTexture(gl.TEXTURE_2D, this.tPic);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
      bmp.close();
      this.hasPic = true;
      this.picSize = [w, h];
    }).finally(() => { this.pending = false; });
    return false;
  }

  // Two maps (Uint8Array nu*nv) to blend; A is the older.
  setMaps(a, b, nu, nv) {
    const gl = this.gl;
    for (const [t, cells] of [[this.tMapA, a], [this.tMapB, b]]) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, nu, nv, 0, gl.RED, gl.UNSIGNED_BYTE, cells);
    }
    this.mapSize = [nu, nv];
  }

  // Fit the picture into the canvas: contain (letterbox) or cover (crop).
  layout() {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.round(c.clientWidth * dpr), ch = Math.round(c.clientHeight * dpr);
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    const [pw, ph] = this.picSize;
    const s = this.cover ? Math.max(cw / pw, ch / ph) : Math.min(cw / pw, ch / ph);
    const w = Math.round(pw * s), h = Math.round(ph * s);
    this.rect = { x: Math.round((cw - w) / 2), y: Math.round((ch - h) / 2), w, h, dpr, scale: s };
    return this.rect;
  }

  // view: { beam: bool, mix: 0..1, fade: 0..1, spots: [{x, y, r, a}] in picture pixels }
  draw(view) {
    const gl = this.gl, L = this.loc, g = this.geo;
    const r = this.layout();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // the picture rect, in GL's bottom-left coordinates
    gl.viewport(r.x, this.canvas.height - r.y - r.h, r.w, r.h);
    gl.useProgram(this.prog);
    const bind = (unit, tex, loc) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc, unit); };
    bind(0, this.tPic, L.uPic);
    bind(1, this.tMapA, L.uMapA);
    bind(2, this.tMapB, L.uMapB);
    bind(3, this.tLut, L.uLut);
    gl.uniform1f(L.uHasPic, this.hasPic ? 1 : 0);
    gl.uniform1f(L.uMix, view.mix || 0);
    gl.uniform1f(L.uFade, this.mapSize[0] ? view.fade || 0 : 0);
    gl.uniform1f(L.uBeam, view.beam ? 1 : 0);
    // the shader works in the geometry's pixels (800x600), whatever the decoded size
    gl.uniform1f(L.uFx, g.fx);
    gl.uniform2f(L.uSize, g.w, g.h);
    gl.uniform2f(L.uN, g.nu, g.nv);
    gl.uniform4f(L.uGrid, g.u0, g.v0, g.du, g.dv);
    const spots = (view.spots || []).slice(0, 4);
    const arr = new Float32Array(16);
    spots.forEach((s, i) => arr.set([s.x, s.y, s.r, s.a], i * 4));
    gl.uniform4fv(L.uSpot, arr);
    gl.uniform1i(L.uSpots, spots.length);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
