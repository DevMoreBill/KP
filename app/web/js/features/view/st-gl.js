import { RalColor } from '../layout/ral-color.js';
import { StCam } from './st-cam.js';
import { StDecal } from './st-decal.js';
import { StM4 } from './st-m4.js';
import { StMat } from './st-mat.js';
import { StSky } from './st-sky.js';
import { StV } from './st-v.js';

export class StGl {
  static VERTEX_SHADER = `#version 300 es
in vec3 aP; in vec3 aN; in vec2 aT; uniform mat4 uVP; out vec3 vP; out vec3 vN; out vec2 vT;
void main(){ vP=aP; vN=aN; vT=aT; gl_Position=uVP*vec4(aP, 1.0); }`;
  // свет одного прохода
  // наклейка — цвет из картинки (прозрачное — не рисуется)
  static FRAGMENT_SHADER = `#version 300 es
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
  static BACKGROUND = '#f3f4f6';
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
    this.main = this.prog(StGl.VERTEX_SHADER, StGl.FRAGMENT_SHADER);
    this.sh = this.prog(StGl.VS_SH, StGl.FS_SH);
    this.add = this.prog(StGl.VS_Q, StGl.FS_ADD);
    this.out = this.prog(StGl.VS_Q, StGl.FS_OUT);
    this.vaoQ = gl.createVertexArray();
    this.white = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.white); // для материалов без картинки
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  }
  /** Программа шейдеров. */
  prog(vertexSrc, fragmentSrc) {
    const gl = this.gl;
    const program = gl.createProgram();
    for (const [type, src] of [
      [gl.VERTEX_SHADER, vertexSrc],
      [gl.FRAGMENT_SHADER, fragmentSrc],
    ]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`шейдер: ${gl.getShaderInfoLog(shader)}`);
      gl.attachShader(program, shader);
    }
    gl.bindAttribLocation(program, 0, 'aP');
    gl.bindAttribLocation(program, 1, 'aN');
    gl.bindAttribLocation(program, 2, 'aT');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(`программа: ${gl.getProgramInfoLog(program)}`);
    program.loc = {};
    return program;
  }
  /** Место переменной шейдера (с памятью). */
  uniform(program, name) {
    if (!(name in program.loc)) program.loc[name] = this.gl.getUniformLocation(program, name);
    return program.loc[name];
  }
  /** Геометрия сцены → буферы видеокарты. */
  upload(scene) {
    const gl = this.gl;
    this.free();
    for (const { mat, mesh } of scene.groups.values()) {
      if (!mesh.indices.length) continue;
      const vao = gl.createVertexArray();
      const posBuf = gl.createBuffer();
      const normBuf = gl.createBuffer();
      const idxBuf = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.positions), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.normals), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(mesh.indices), gl.STATIC_DRAW);
      const bufs = [posBuf, normBuf, idxBuf];
      if (mesh.uvs.length) {
        const uvBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.uvs), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
        bufs.push(uvBuf);
      }
      gl.bindVertexArray(null);
      this.objs.push({
        vao,
        bufs,
        n: mesh.indices.length,
        mat,
        alb: StMat.lin(mat.c),
        tex: mat.k === 3 ? this.texture(scene.decals.get(mat.tex)) : null,
      });
    }
  }
  /** Картинка наклейки (StDecal рисует на холсте) → текстура с mip-уровнями; не нарисовалась — прозрачная. */
  texture(decal) {
    const gl = this.gl;
    const tex = gl.createTexture();
    let canvas = null;
    try {
      canvas = decal && typeof StDecal !== 'undefined' ? StDecal.canvas(decal) : null;
    } catch (err) {
      canvas = null;
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (canvas) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }
  /** Освободить буферы сцены. */
  free() {
    const gl = this.gl;
    for (const obj of this.objs) {
      gl.deleteVertexArray(obj.vao);
      obj.bufs.forEach(buf => gl.deleteBuffer(buf));
      if (obj.tex) gl.deleteTexture(obj.tex);
    }
    this.objs = [];
  }
  _texture(texW, texH, fmt, ifmt, type) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, texW, texH, 0, fmt, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  _frameBuffer(color, depthTex, depthRb) {
    const gl = this.gl;
    const frame = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, frame);
    if (color) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
    if (depthTex) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
    if (depthRb) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb);
    if (!color) {
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
    }
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('кадр не собрался');
    return frame;
  }

  /** Кадр: накопление (RGBA16F), кадр прохода (RGBA16F + глубина), карта теней (глубина S × S). */
  targets(width, height, shadowSize) {
    const gl = this.gl;
    if (this.fb && this.fb.W === width && this.fb.H === height && this.fb.S === shadowSize) return this.fb;
    this.dropTargets();
    const accT = this._texture(width, height, gl.RGBA, gl.RGBA16F, gl.HALF_FLOAT);
    const tmpT = this._texture(width, height, gl.RGBA, gl.RGBA16F, gl.HALF_FLOAT);
    const shT = this._texture(shadowSize, shadowSize, gl.DEPTH_COMPONENT, gl.DEPTH_COMPONENT24, gl.UNSIGNED_INT);
    gl.bindTexture(gl.TEXTURE_2D, shT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    const depthBuf = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuf);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
    this.fb = {
      W: width,
      H: height,
      S: shadowSize,
      accT,
      tmpT,
      shT,
      rb: depthBuf,
      acc: this._frameBuffer(accT),
      tmp: this._frameBuffer(tmpT, null, depthBuf),
      sh: this._frameBuffer(null, shT),
    };
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this.fb;
  }
  /** Освободить кадровые буферы. */
  dropTargets() {
    const gl = this.gl;
    const frames = this.fb;
    if (!frames) return;
    for (const tex of [frames.accT, frames.tmpT, frames.shT]) gl.deleteTexture(tex);
    gl.deleteRenderbuffer(frames.rb);
    for (const buf of [frames.acc, frames.tmp, frames.sh]) gl.deleteFramebuffer(buf);
    this.fb = null;
  }

  /** Кадр сцены: o = {w, h, passes, shadow}; возвращает canvas с картинкой. */
  async render(scene, opts = {}) {
    const gl = this.gl;
    const width = opts.w || 1600;
    const height = opts.h || 1000;
    const shadowSize = opts.shadow || 2048;
    this.c.width = width;
    this.c.height = height;
    this.upload(scene);
    const bounds = scene.bounds();
    const cam = StCam.fit(bounds, width / height, 0.9, scene.azimuth);
    const reach = StV.len(StV.sub(bounds.hi, bounds.lo)) / 2 + 0.3;
    const frame = {
      W: width,
      H: height,
      S: shadowSize,
      F: this.targets(width, height, shadowSize),
      cam,
      R: reach,
      ctr: StV.mul(StV.add(bounds.lo, bounds.hi), 0.5),
      base: StM4.persp(cam.fov, width / height, Math.max(0.05, cam.D - reach * 2.2), cam.D + reach * 2.2),
      reach: Math.max(bounds.hi[0] - bounds.lo[0], bounds.hi[1] - bounds.lo[1]),
    };
    const passes = StSky.passes(
      opts.passes || 64,
      scene.azimuth < 0 ? [-StSky.SUN[0], StSky.SUN[1], StSky.SUN[2]] : StSky.SUN,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, frame.F.acc);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (let i = 0; i < passes.length; i++) {
      const LVP = StM4.light(passes[i].dir, frame.ctr, reach);
      this.shadowPass(frame, LVP);
      this.colorPass(scene, frame, { ...passes[i], i, n: passes.length }, LVP);
      this.accumulate(frame);
      if (opts.onPass) opts.onPass(i + 1, passes.length);
      if (i % 2 === 1) await this.idle();
    }
    this.present(frame, opts.exposure || StGl.EXP);
    await this.idle();
    if (gl.isContextLost()) throw new Error('контекст WebGL потерян');
    return this.c;
  }

  /** Тень: глубина со стороны света (земля тень не отбрасывает). */
  shadowPass({ F: targets, S: size }, LVP) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.sh);
    gl.viewport(0, 0, size, size);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.6, 2.0);
    gl.useProgram(this.sh);
    gl.uniformMatrix4fv(this.uniform(this.sh, 'uVP'), false, LVP);
    for (const obj of this.objs)
      if (obj.mat.k !== 2 && obj.mat.k !== 3) {
        gl.bindVertexArray(obj.vao);
        gl.drawElements(gl.TRIANGLES, obj.n, gl.UNSIGNED_INT, 0);
      }
    gl.disable(gl.POLYGON_OFFSET_FILL);
  }

  /** Проход: камера со сдвигом на долю пикселя (сглаживание), свет ps. */
  colorPass(scene, frame, pass, LVP) {
    const gl = this.gl;
    const { W: width, H: height, cam } = frame;
    const proj = new Float32Array(frame.base);
    proj[8] -= ((StSky.halton(pass.i + 1, 2) - 0.5) * 2) / width;
    proj[9] -= ((StSky.halton(pass.i + 1, 3) - 0.5) * 2) / height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, frame.F.tmp);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const program = this.main;
    gl.useProgram(program);
    gl.uniformMatrix4fv(this.uniform(program, 'uVP'), false, StM4.mul(proj, cam.view));
    gl.uniformMatrix4fv(this.uniform(program, 'uLVP'), false, LVP);
    gl.uniform3fv(this.uniform(program, 'uCam'), cam.eye);
    gl.uniform3fv(this.uniform(program, 'uL'), pass.dir);
    gl.uniform3fv(this.uniform(program, 'uE'), pass.E);
    gl.uniform3fv(this.uniform(program, 'uCtr'), frame.ctr);
    gl.uniform1f(this.uniform(program, 'uW'), 1 / pass.n);
    gl.uniform1f(this.uniform(program, 'uMinA'), pass.sun ? 0 : 0.14);
    gl.uniform1f(this.uniform(program, 'uTexel'), 1 / frame.S);
    gl.uniform1f(this.uniform(program, 'uR0'), frame.reach * 0.55);
    gl.uniform1f(this.uniform(program, 'uR1'), frame.reach * 1.25);
    gl.uniform3fv(this.uniform(program, 'uIn0'), [scene.ox - 0.01, scene.oy - 0.01, scene.base - 0.01]);
    gl.uniform3fv(this.uniform(program, 'uIn1'), [
      scene.ox + scene.Li + 0.01,
      scene.oy + scene.Wi + 0.01,
      scene.ceil + 0.01,
    ]);
    gl.uniform1f(this.uniform(program, 'uFill'), StGl.FILL);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, frame.F.shT);
    gl.uniform1i(this.uniform(program, 'uSh'), 0);
    gl.uniform1i(this.uniform(program, 'uTex'), 1);
    this.drawObjs(program);
  }

  /** Нарисовать все объекты программой. */
  drawObjs(program) {
    const gl = this.gl;
    for (const obj of this.objs) {
      const mat = obj.mat;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, obj.tex || this.white);
      gl.uniform3fv(this.uniform(program, 'uAlb'), obj.alb);
      gl.uniform1f(this.uniform(program, 'uRough'), mat.r);
      gl.uniform1f(this.uniform(program, 'uMetal'), mat.m);
      gl.uniform1f(this.uniform(program, 'uEmis'), mat.e || 0);
      gl.uniform1i(this.uniform(program, 'uKind'), mat.k || 0);
      gl.bindVertexArray(obj.vao);
      gl.drawElements(gl.TRIANGLES, obj.n, gl.UNSIGNED_INT, 0);
    }
  }

  /** Проход — в накопление. */
  accumulate({ F: targets }) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.acc);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.add);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets.tmpT);
    gl.uniform1i(this.uniform(this.add, 'uT'), 0);
    gl.bindVertexArray(this.vaoQ);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
  }

  /** Накопленное — на экран: тон, фон, экспозиция. */
  present({ F: targets, W: width, H: height }, exp) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.out);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets.accT);
    gl.uniform1i(this.uniform(this.out, 'uT'), 0);
    gl.uniform3fv(
      this.uniform(this.out, 'uBg'),
      RalColor.rgb(StGl.BACKGROUND).map(v => v / 255),
    );
    gl.uniform1f(this.uniform(this.out, 'uExp'), exp);
    gl.bindVertexArray(this.vaoQ);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /** Дождаться, пока видеокарта выполнит отданные команды, не останавливая окно. */
  async idle() {
    const gl = this.gl;
    if (!gl.fenceSync) {
      await new Promise(resolve => setTimeout(resolve, 0));
      return;
    }
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    try {
      for (let k = 0; k < 6000; k++) {
        await new Promise(resolve => setTimeout(resolve, k < 5 ? 0 : 8));
        if (gl.isContextLost() || gl.getSyncParameter(fence, gl.SYNC_STATUS) === gl.SIGNALED) return;
      }
    } finally {
      gl.deleteSync(fence);
    }
  }
}
