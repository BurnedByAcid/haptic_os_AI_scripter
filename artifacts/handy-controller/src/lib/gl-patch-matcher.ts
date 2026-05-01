/**
 * GPU-accelerated patch similarity scorer using WebGL.
 *
 * Pipeline per frame:
 *   1. Upload video frame as GL texture (only touched by GPU).
 *   2. Diff shader — renders a (patchW × patchH) FBO where each pixel
 *      holds the squared grayscale difference vs the reference patch.
 *   3. Reduction passes — each pass halves both dimensions by averaging
 *      a 2×2 neighbourhood, continuing until the FBO is 1×1.
 *   4. gl.readPixels — reads exactly 4 bytes; the R channel is the
 *      mean-squared-diff encoded in [0,255].
 *   5. Returns √(msd) × 255 — same scale as the CPU patchRms helper.
 *
 * Y-flip convention
 *   • Video texture uploaded with UNPACK_FLIP_Y_WEBGL = true  (visual top → UV y=0).
 *   • Reference typed-array uploaded with UNPACK_FLIP_Y_WEBGL = false (row 0 → UV y=0).
 *   • getImageData row 0 = visual top, so both textures agree: UV y=0 = patch top.
 */

const VERT = `
attribute vec2 aPos;
varying   vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/** Per-pixel squared grayscale difference between video patch and reference. */
const FRAG_DIFF = `
precision highp float;
uniform sampler2D uVideo;
uniform sampler2D uRef;
uniform vec4      uRect;   /* nx, ny, nw, nh — patch in normalised video UV */
varying vec2      vUv;
void main() {
  vec2  sUv = vec2(uRect.x + vUv.x * uRect.z,
                   uRect.y + vUv.y * uRect.w);
  float fg   = dot(texture2D(uVideo, sUv).rgb, vec3(0.299, 0.587, 0.114));
  float rg   = texture2D(uRef,  vUv).r;
  float d    = fg - rg;
  gl_FragColor = vec4(d * d, 0.0, 0.0, 1.0);
}`;

/** 2×2 average — used for every reduction step. */
const FRAG_REDUCE = `
precision highp float;
uniform sampler2D uTex;
uniform vec2      uStep;
varying vec2      vUv;
void main() {
  float v = texture2D(uTex, vUv + uStep * vec2(-0.5,-0.5)).r
          + texture2D(uTex, vUv + uStep * vec2( 0.5,-0.5)).r
          + texture2D(uTex, vUv + uStep * vec2(-0.5, 0.5)).r
          + texture2D(uTex, vUv + uStep * vec2( 0.5, 0.5)).r;
  gl_FragColor = vec4(v * 0.25, 0.0, 0.0, 1.0);
}`;

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(s) ?? "shader error");
  return s;
}

function linkProgram(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p) ?? "link error");
  return p;
}

interface Fbo { fbo: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

function makeFbo(gl: WebGLRenderingContext, w: number, h: number): Fbo {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex, w, h };
}

export class GlPatchMatcher {
  private gl: WebGLRenderingContext;
  private diffProg: WebGLProgram;
  private reduceProg: WebGLProgram;
  private quad: WebGLBuffer;
  private videoTex: WebGLTexture;
  private refTex: WebGLTexture;
  private chain: Fbo[] = [];
  private pixel = new Uint8Array(4);

  constructor() {
    const canvas = document.createElement("canvas");
    canvas.width = 1; canvas.height = 1;
    const gl = canvas.getContext("webgl");
    if (!gl) throw new Error("WebGL unavailable");
    this.gl = gl;

    this.diffProg   = linkProgram(gl, VERT, FRAG_DIFF);
    this.reduceProg = linkProgram(gl, VERT, FRAG_REDUCE);

    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    this.quad = buf;

    this.videoTex = this.makeBlankTex();
    this.refTex   = this.makeBlankTex();
  }

  private makeBlankTex(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** Call once after sampling the patch. gray = uint8 grayscale array, w/h = patch pixel dims. */
  setReference(gray: Uint8Array, w: number, h: number) {
    const gl = this.gl;

    // Upload reference (FLIP_Y=false: row 0 of array → UV y=0 = patch top)
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < gray.length; i++) {
      rgba[i * 4] = gray[i]; rgba[i * 4 + 1] = gray[i];
      rgba[i * 4 + 2] = gray[i]; rgba[i * 4 + 3] = 255;
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, this.refTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);

    // Rebuild the reduction FBO chain for this patch size
    for (const { fbo, tex } of this.chain) {
      gl.deleteFramebuffer(fbo); gl.deleteTexture(tex);
    }
    this.chain = [];
    let cw = w, ch = h;
    for (;;) {
      this.chain.push(makeFbo(gl, cw, ch));
      if (cw === 1 && ch === 1) break;
      cw = Math.max(1, Math.ceil(cw / 2));
      ch = Math.max(1, Math.ceil(ch / 2));
    }
  }

  /**
   * Compute RMS difference vs reference in 0–255 scale (matches CPU patchRms).
   * nx/ny/nw/nh: patch rectangle in normalised video coords (0–1, top-left origin).
   */
  computeRms(video: HTMLVideoElement, nx: number, ny: number, nw: number, nh: number): number {
    const gl = this.gl;
    if (this.chain.length === 0) throw new Error("call setReference first");

    // Upload video frame (FLIP_Y=true: visual top → UV y=0)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);

    // ── Pass 0: diff shader → chain[0] (patchW × patchH) ──
    const first = this.chain[0];
    gl.bindFramebuffer(gl.FRAMEBUFFER, first.fbo);
    gl.viewport(0, 0, first.w, first.h);
    gl.useProgram(this.diffProg);

    const aPosD = gl.getAttribLocation(this.diffProg, "aPos");
    gl.enableVertexAttribArray(aPosD);
    gl.vertexAttribPointer(aPosD, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.uniform1i(gl.getUniformLocation(this.diffProg, "uVideo"), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.refTex);
    gl.uniform1i(gl.getUniformLocation(this.diffProg, "uRef"), 1);

    gl.uniform4f(gl.getUniformLocation(this.diffProg, "uRect"), nx, ny, nw, nh);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // ── Reduction passes: chain[i-1] → chain[i] ──
    gl.useProgram(this.reduceProg);
    const aPosR = gl.getAttribLocation(this.reduceProg, "aPos");
    gl.enableVertexAttribArray(aPosR);
    gl.vertexAttribPointer(aPosR, 2, gl.FLOAT, false, 0, 0);

    for (let i = 1; i < this.chain.length; i++) {
      const src = this.chain[i - 1];
      const dst = this.chain[i];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, dst.w, dst.h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(gl.getUniformLocation(this.reduceProg, "uTex"), 0);
      gl.uniform2f(gl.getUniformLocation(this.reduceProg, "uStep"), 1 / src.w, 1 / src.h);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // ── Read the single result pixel ──
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.pixel);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // R channel = mean squared diff in [0,1] mapped to [0,255]
    // RMS in [0,1] = sqrt(R/255);  scale back to [0,255] to match CPU helper
    return Math.sqrt(this.pixel[0] / 255) * 255;
  }

  destroy() {
    const gl = this.gl;
    for (const { fbo, tex } of this.chain) {
      gl.deleteFramebuffer(fbo); gl.deleteTexture(tex);
    }
    gl.deleteTexture(this.videoTex);
    gl.deleteTexture(this.refTex);
    gl.deleteBuffer(this.quad);
    gl.deleteProgram(this.diffProg);
    gl.deleteProgram(this.reduceProg);
  }
}
