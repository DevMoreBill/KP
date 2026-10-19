import { RalColor } from '../layout/ral-color.js';
import { StCam } from './st-cam.js';
import { StDecal } from './st-decal.js';
import { StM4 } from './st-m4.js';
import { StMat } from './st-mat.js';
import { StSky } from './st-sky.js';
import { StV } from './st-v.js';

export class StGl {
  static VS = `#version 300 es
in vec3 aP; in vec3 aN; in vec2 aT; uniform mat4 uVP; out vec3 vP; out vec3 vN; out vec2 vT;
void main(){ vP=aP; vN=aN; vT=aT; gl_Position=uVP*vec4(aP, 1.0); }`;
  // свет одного прохода
  // наклейка — цвет из картинки (прозрачное — не рисуется)
  static FS = `#version 300 es
precision highp float; precision highp sampler2DShadow;
in vec3 vP; in vec3 vN; in vec2 vT; out vec4 o;
uniform vec3 uCam, uL, uE, uAlb, uCtr, uIn0, uIn1; uniform float uRough, uMetal, uEmis, uW, uMinA, uTexel, uR0, uR1, uFill; uniform int uKind;
uniform mat4 uLVP; uniform sampler2DShadow uSh; uniform sampler2D uTex;
float vis(vec3 p, vec3 n, float nl){
  vec3 q=p+n*(0.004+0.016*(1.0-nl)); vec4 s=uLVP*vec4(q, 1.0); vec3 c=s.xyz/s.w*0.5+0.5;
  if (c.x<0.0 || c.x>1.0 || c.y<0.0 || c.y>1.0 || c.z>1.0) return 1.0;
  float v=0.0; for (int i=-1; i<=1; i++) for (int j=-1; j<=1; j++) v+=texture(uSh, vec3(c.xy+vec2(float(i), float(j))*uTexel, c.z-0.0005));
  return v/9.0; }
void main(){
  vec3 alb=uAlb;
  if (uKind==3){ vec4 t=texture(uTex, vT); if (t.a<0.5) discard; alb=pow(t.rgb, vec3(2.2)); }
  vec3 n=normalize(vN), v=normalize(uCam-vP); if (dot(n, v)<0.0) n=-n;
  if (uKind==1){ vec2 g=vP.xy*24.0, f=fract(g)-0.5; float a=mod(floor(g.x)+floor(g.y), 2.0)<0.5 ? 1.0 : -1.0;
    vec2 d=vec2(f.x*0.92+a*f.y*0.38, f.y*0.92-a*f.x*0.38); if (length(d*vec2(1.0, 3.4))<0.36) n=normalize(n+vec3(d*1.5, 0.0)); }
  float nl=dot(n, uL); vec3 col=vec3(0.0);
  if (nl>0.0){ float V=vis(vP, n, nl);
    if (V>0.0){ vec3 h=normalize(uL+v); float nh=max(dot(n, h), 0.0), nv=max(dot(n, v), 1e-3), vh=max(dot(v, h), 0.0);
      float a=max(uRough*uRough, uMinA), a2=a*a, dd=nh*nh*(a2-1.0)+1.0, D=a2/(3.14159*dd*dd), k=(uRough+1.0)*(uRough+1.0)/8.0;
      float G=nv/(nv*(1.0-k)+k)*nl/(nl*(1.0-k)+k); vec3 F0=mix(vec3(0.04), alb, uMetal), F=F0+(1.0-F0)*pow(1.0-vh, 5.0);
      vec3 spec=D*G*F/max(4.0*nv*nl, 1e-3), dif=(1.0-uMetal)*(1.0-F)*alb/3.14159;
      col=(dif+spec)*uE*nl*V;
      if (uMinA>0.0) col+=uMetal*alb*0.7/3.14159*uE*nl*V; } }
  // внутри — мягкий заполняющий свет светильников, без теней
  if (all(greaterThan(vP, uIn0)) && all(lessThan(vP, uIn1))) col+=alb*(1.0-0.5*uMetal)*uFill*(0.62+0.38*n.z)/3.14159*uW;
  col+=alb*uEmis*uW; float w=uW;
  if (uKind==2){ float f=1.0-smoothstep(uR0, uR1, length(vP.xy-uCtr.xy)); col*=f; w*=f; }
  o=vec4(col, w); }`;
  static VS_SH = `#version 300 es
in vec3 aP; uniform mat4 uVP; void main(){ gl_Position=uVP*vec4(aP, 1.0); }`;
  static FS_SH = `#version 300 es
precision mediump float; out vec4 o; void main(){ o=vec4(1.0); }`;
  static VS_Q = `#version 300 es
out vec2 vU; void main(){ vec2 p=vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); vU=p; gl_Position=vec4(p*2.0-1.0, 0.0, 1.0); }`;
  static FS_ADD = `#version 300 es
precision highp float; in vec2 vU; uniform sampler2D uT; out vec4 o; void main(){ o=texture(uT, vU); }`;
  static FS_OUT = `#version 300 es
precision highp float; in vec2 vU; uniform sampler2D uT; uniform vec3 uBg; uniform float uExp; out vec4 o;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
void main(){ vec4 a=texture(uT, vU); float c=clamp(a.a, 0.0, 1.0); vec3 col=a.a>1e-5 ? a.rgb/a.a : vec3(0.0);
  vec3 m=pow(aces(col*uExp), vec3(1.0/2.2)); float n=(fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)))*43758.5453)-0.5)/255.0;
  o=vec4(mix(uBg, m, c)+n, 1.0); }`;
  static BG = '#f3f4f6';
  static FILL = 1.1; // заполняющий свет внутри контейнера
  static EXP = 1.15;

  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      preserveDrawingBuffer: true,
      alpha: false,
      depth: true,
    });
    if (!gl) throw new Error('WebGL2 недоступен');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('нет EXT_color_buffer_float');
    this.gl = gl;
    this.c = canvas;
    this.objs = [];
    this.fb = null;
    this.main = this.prog(StGl.VS, StGl.FS);
    this.sh = this.prog(StGl.VS_SH, StGl.FS_SH);
    this.add = this.prog(StGl.VS_Q, StGl.FS_ADD);
    this.out = this.prog(StGl.VS_Q, StGl.FS_OUT);
    this.vaoQ = gl.createVertexArray();
    this.white = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.white); // для материалов без картинки
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  }
  prog(vs, fs) {
    const gl = this.gl;
    const p = gl.createProgram();
    for (const [t, src] of [
      [gl.VERTEX_SHADER, vs],
      [gl.FRAGMENT_SHADER, fs],
    ]) {
      const s = gl.createShader(t);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`шейдер: ${gl.getShaderInfoLog(s)}`);
      gl.attachShader(p, s);
    }
    gl.bindAttribLocation(p, 0, 'aP');
    gl.bindAttribLocation(p, 1, 'aN');
    gl.bindAttribLocation(p, 2, 'aT');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`программа: ${gl.getProgramInfoLog(p)}`);
    p.loc = {};
    return p;
  }
  u(p, n) {
    if (!(n in p.loc)) p.loc[n] = this.gl.getUniformLocation(p, n);
    return p.loc[n];
  }
  /** Геометрия сцены → буферы видеокарты. */
  upload(scene) {
    const gl = this.gl;
    this.free();
    for (const { mat, mesh } of scene.groups.values()) {
      if (!mesh.i.length) continue;
      const vao = gl.createVertexArray();
      const bp = gl.createBuffer();
      const bn = gl.createBuffer();
      const bi = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, bp);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.p), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bn);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.n), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bi);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(mesh.i), gl.STATIC_DRAW);
      const bufs = [bp, bn, bi];
      if (mesh.t.length) {
        const bt = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, bt);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.t), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
        bufs.push(bt);
      }
      gl.bindVertexArray(null);
      this.objs.push({
        vao,
        bufs,
        n: mesh.i.length,
        mat,
        alb: StMat.lin(mat.c),
        tex: mat.k === 3 ? this.texture(scene.decals.get(mat.tex)) : null,
      });
    }
  }
  /** Картинка наклейки (StDecal рисует на холсте) → текстура с mip-уровнями; не нарисовалась — прозрачная. */
  texture(d) {
    const gl = this.gl;
    const t = gl.createTexture();
    let c = null;
    try {
      c = d && typeof StDecal !== 'undefined' ? StDecal.canvas(d) : null;
    } catch (e) {
      c = null;
    }
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (c) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  free() {
    const gl = this.gl;
    for (const o of this.objs) {
      gl.deleteVertexArray(o.vao);
      o.bufs.forEach(b => gl.deleteBuffer(b));
      if (o.tex) gl.deleteTexture(o.tex);
    }
    this.objs = [];
  }
  /** Кадр: накопление (RGBA16F), кадр прохода (RGBA16F + глубина), карта теней (глубина S × S). */
  targets(W, H, S) {
    const gl = this.gl;
    if (this.fb && this.fb.W === W && this.fb.H === H && this.fb.S === S) return this.fb;
    this.dropTargets();
    const tex = (w, h, fmt, ifmt, type) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const fbo = (color, depthTex, depthRb) => {
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      if (color) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
      if (depthTex) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
      if (depthRb) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb);
      if (!color) {
        gl.drawBuffers([gl.NONE]);
        gl.readBuffer(gl.NONE);
      }
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('кадр не собрался');
      return f;
    };
    const accT = tex(W, H, gl.RGBA, gl.RGBA16F, gl.HALF_FLOAT);
    const tmpT = tex(W, H, gl.RGBA, gl.RGBA16F, gl.HALF_FLOAT);
    const shT = tex(S, S, gl.DEPTH_COMPONENT, gl.DEPTH_COMPONENT24, gl.UNSIGNED_INT);
    gl.bindTexture(gl.TEXTURE_2D, shT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H);
    this.fb = { W, H, S, accT, tmpT, shT, rb, acc: fbo(accT), tmp: fbo(tmpT, null, rb), sh: fbo(null, shT) };
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this.fb;
  }
  dropTargets() {
    const gl = this.gl;
    const f = this.fb;
    if (!f) return;
    for (const t of [f.accT, f.tmpT, f.shT]) gl.deleteTexture(t);
    gl.deleteRenderbuffer(f.rb);
    for (const b of [f.acc, f.tmp, f.sh]) gl.deleteFramebuffer(b);
    this.fb = null;
  }

  /** Кадр сцены: o = {w, h, passes, shadow}; возвращает canvas с картинкой. */
  async render(scene, o = {}) {
    const gl = this.gl;
    const W = o.w || 1600;
    const H = o.h || 1000;
    const S = o.shadow || 2048;
    this.c.width = W;
    this.c.height = H;
    this.upload(scene);
    const b = scene.bounds();
    const cam = StCam.fit(b, W / H, 0.9, scene.az);
    const R = StV.len(StV.sub(b.hi, b.lo)) / 2 + 0.3;
    const fr = {
      W,
      H,
      S,
      F: this.targets(W, H, S),
      cam,
      R,
      ctr: StV.mul(StV.add(b.lo, b.hi), 0.5),
      base: StM4.persp(cam.fov, W / H, Math.max(0.05, cam.D - R * 2.2), cam.D + R * 2.2),
      reach: Math.max(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1]),
    };
    const passes = StSky.passes(o.passes || 64, scene.az < 0 ? [-StSky.SUN[0], StSky.SUN[1], StSky.SUN[2]] : StSky.SUN);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fr.F.acc);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (let i = 0; i < passes.length; i++) {
      const LVP = StM4.light(passes[i].dir, fr.ctr, R);
      this.shadowPass(fr, LVP);
      this.colorPass(scene, fr, { ...passes[i], i, n: passes.length }, LVP);
      this.accumulate(fr);
      if (o.onPass) o.onPass(i + 1, passes.length);
      if (i % 2 === 1) await this.idle();
    }
    this.present(fr, o.exposure || StGl.EXP);
    await this.idle();
    if (gl.isContextLost()) throw new Error('контекст WebGL потерян');
    return this.c;
  }

  /** Тень: глубина со стороны света (земля тень не отбрасывает). */
  shadowPass({ F, S }, LVP) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, F.sh);
    gl.viewport(0, 0, S, S);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.6, 2.0);
    gl.useProgram(this.sh);
    gl.uniformMatrix4fv(this.u(this.sh, 'uVP'), false, LVP);
    for (const ob of this.objs)
      if (ob.mat.k !== 2 && ob.mat.k !== 3) {
        gl.bindVertexArray(ob.vao);
        gl.drawElements(gl.TRIANGLES, ob.n, gl.UNSIGNED_INT, 0);
      }
    gl.disable(gl.POLYGON_OFFSET_FILL);
  }

  /** Проход: камера со сдвигом на долю пикселя (сглаживание), свет ps. */
  colorPass(scene, fr, ps, LVP) {
    const gl = this.gl;
    const { W, H, cam } = fr;
    const P = new Float32Array(fr.base);
    P[8] -= ((StSky.halton(ps.i + 1, 2) - 0.5) * 2) / W;
    P[9] -= ((StSky.halton(ps.i + 1, 3) - 0.5) * 2) / H;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fr.F.tmp);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const pr = this.main;
    gl.useProgram(pr);
    gl.uniformMatrix4fv(this.u(pr, 'uVP'), false, StM4.mul(P, cam.view));
    gl.uniformMatrix4fv(this.u(pr, 'uLVP'), false, LVP);
    gl.uniform3fv(this.u(pr, 'uCam'), cam.eye);
    gl.uniform3fv(this.u(pr, 'uL'), ps.dir);
    gl.uniform3fv(this.u(pr, 'uE'), ps.E);
    gl.uniform3fv(this.u(pr, 'uCtr'), fr.ctr);
    gl.uniform1f(this.u(pr, 'uW'), 1 / ps.n);
    gl.uniform1f(this.u(pr, 'uMinA'), ps.sun ? 0 : 0.14);
    gl.uniform1f(this.u(pr, 'uTexel'), 1 / fr.S);
    gl.uniform1f(this.u(pr, 'uR0'), fr.reach * 0.55);
    gl.uniform1f(this.u(pr, 'uR1'), fr.reach * 1.25);
    gl.uniform3fv(this.u(pr, 'uIn0'), [scene.ox - 0.01, scene.oy - 0.01, scene.base - 0.01]);
    gl.uniform3fv(this.u(pr, 'uIn1'), [scene.ox + scene.Li + 0.01, scene.oy + scene.Wi + 0.01, scene.ceil + 0.01]);
    gl.uniform1f(this.u(pr, 'uFill'), StGl.FILL);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fr.F.shT);
    gl.uniform1i(this.u(pr, 'uSh'), 0);
    gl.uniform1i(this.u(pr, 'uTex'), 1);
    this.drawObjs(pr);
  }

  drawObjs(pr) {
    const gl = this.gl;
    for (const ob of this.objs) {
      const m = ob.mat;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, ob.tex || this.white);
      gl.uniform3fv(this.u(pr, 'uAlb'), ob.alb);
      gl.uniform1f(this.u(pr, 'uRough'), m.r);
      gl.uniform1f(this.u(pr, 'uMetal'), m.m);
      gl.uniform1f(this.u(pr, 'uEmis'), m.e || 0);
      gl.uniform1i(this.u(pr, 'uKind'), m.k || 0);
      gl.bindVertexArray(ob.vao);
      gl.drawElements(gl.TRIANGLES, ob.n, gl.UNSIGNED_INT, 0);
    }
  }

  /** Проход — в накопление. */
  accumulate({ F }) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, F.acc);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.add);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, F.tmpT);
    gl.uniform1i(this.u(this.add, 'uT'), 0);
    gl.bindVertexArray(this.vaoQ);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
  }

  /** Накопленное — на экран: тон, фон, экспозиция. */
  present({ F, W, H }, exp) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.out);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, F.accT);
    gl.uniform1i(this.u(this.out, 'uT'), 0);
    gl.uniform3fv(
      this.u(this.out, 'uBg'),
      RalColor.rgb(StGl.BG).map(v => v / 255),
    );
    gl.uniform1f(this.u(this.out, 'uExp'), exp);
    gl.bindVertexArray(this.vaoQ);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /** Дождаться, пока видеокарта выполнит отданные команды, не останавливая окно. */
  async idle() {
    const gl = this.gl;
    if (!gl.fenceSync) {
      await new Promise(r => setTimeout(r, 0));
      return;
    }
    const f = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    try {
      for (let k = 0; k < 6000; k++) {
        await new Promise(r => setTimeout(r, k < 5 ? 0 : 8));
        if (gl.isContextLost() || gl.getSyncParameter(f, gl.SYNC_STATUS) === gl.SIGNALED) return;
      }
    } finally {
      gl.deleteSync(f);
    }
  }
}
