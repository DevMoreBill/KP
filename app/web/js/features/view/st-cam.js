import { StM4 } from './st-m4.js';
import { StV } from './st-v.js';

export class StCam {
  static AZ = 36; // от фронта влево, °
  static EL = 19; // над горизонтом, °
  static FOV = 24; // по вертикали, °
  /** B — габариты сцены {lo, hi}; asp — ширина / высота кадра; fill — доля кадра под сцену; deg — азимут (минус — справа). */
  static fit(b, asp, fill = 0.9, deg = this.AZ) {
    const az = (deg * Math.PI) / 180;
    const el = (this.EL * Math.PI) / 180;
    const d = [-Math.cos(el) * Math.sin(az), -Math.cos(el) * Math.cos(az), Math.sin(el)];
    const fov = (this.FOV * Math.PI) / 180;
    const C = [];
    for (const x of [b.lo[0], b.hi[0]])
      for (const y of [b.lo[1], b.hi[1]]) for (const z of [b.lo[2], b.hi[2]]) C.push([x, y, z]);
    let T = StV.mul(StV.add(b.lo, b.hi), 0.5);
    let D = StV.len(StV.sub(b.hi, b.lo)) * 2.2;
    let vp = null;
    let eye = null;
    let view = null;
    let proj = null;
    let span = [1, 1];
    for (let k = 0; k < 40; k++) {
      eye = StV.add(T, StV.mul(d, D));
      view = StM4.look(eye, T, [0, 0, 1]);
      proj = StM4.persp(fov, asp, 0.1, D * 4);
      vp = StM4.mul(proj, view);
      const P = C.map(p => StM4.apply(vp, p));
      const x0 = Math.min(...P.map(p => p[0]));
      const x1 = Math.max(...P.map(p => p[0]));
      const y0 = Math.min(...P.map(p => p[1]));
      const y1 = Math.max(...P.map(p => p[1]));
      const s = Math.max((x1 - x0) / (2 * fill), (y1 - y0) / (2 * fill));
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      span = [(x1 - x0) / s, (y1 - y0) / s];
      const zf = StV.norm(StV.sub(eye, T));
      const rt = StV.norm(StV.cross([0, 0, 1], zf));
      const up = StV.cross(zf, rt);
      const th = Math.tan(fov / 2);
      T = StV.add(T, StV.add(StV.mul(rt, cx * D * th * asp), StV.mul(up, cy * D * th)));
      D *= s;
      if (Math.abs(s - 1) < 1e-3 && Math.abs(cx) < 1e-3 && Math.abs(cy) < 1e-3) break;
    }
    eye = StV.add(T, StV.mul(d, D));
    view = StM4.look(eye, T, [0, 0, 1]);
    return { eye, T, D, view, fov, asp, span };
  }
}
