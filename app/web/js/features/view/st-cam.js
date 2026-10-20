import { StM4 } from './st-m4.js';
import { StV } from './st-v.js';

export class StCam {
  static AZIMUTH = 36; // от фронта влево, °
  static ELEVATION = 19; // над горизонтом, °
  static FOV = 24; // по вертикали, °
  /** B — габариты сцены {lo, hi}; asp — ширина / высота кадра; fill — доля кадра под сцену; deg — азимут (минус — справа). */
  static fit(bounds, asp, fill = 0.9, deg = this.AZIMUTH) {
    const azimuth = (deg * Math.PI) / 180;
    const el = (this.ELEVATION * Math.PI) / 180;
    const dir = [-Math.cos(el) * Math.sin(azimuth), -Math.cos(el) * Math.cos(azimuth), Math.sin(el)];
    const fov = (this.FOV * Math.PI) / 180;
    const corners = [];
    for (const x of [bounds.lo[0], bounds.hi[0]])
      for (const y of [bounds.lo[1], bounds.hi[1]])
        for (const z of [bounds.lo[2], bounds.hi[2]]) corners.push([x, y, z]);
    let target = StV.mul(StV.add(bounds.lo, bounds.hi), 0.5);
    let dist = StV.len(StV.sub(bounds.hi, bounds.lo)) * 2.2;
    let viewProj = null;
    let eye = null;
    let view = null;
    let proj = null;
    let span = [1, 1];
    for (let k = 0; k < 40; k++) {
      eye = StV.add(target, StV.mul(dir, dist));
      view = StM4.look(eye, target, [0, 0, 1]);
      proj = StM4.persp(fov, asp, 0.1, dist * 4);
      viewProj = StM4.mul(proj, view);
      const projected = corners.map(point => StM4.apply(viewProj, point));
      const x0 = Math.min(...projected.map(point => point[0]));
      const x1 = Math.max(...projected.map(point => point[0]));
      const y0 = Math.min(...projected.map(point => point[1]));
      const y1 = Math.max(...projected.map(point => point[1]));
      const half = Math.max((x1 - x0) / (2 * fill), (y1 - y0) / (2 * fill));
      const midX = (x0 + x1) / 2;
      const midY = (y0 + y1) / 2;
      span = [(x1 - x0) / half, (y1 - y0) / half];
      const back = StV.norm(StV.sub(eye, target));
      const right = StV.norm(StV.cross([0, 0, 1], back));
      const upward = StV.cross(back, right);
      const tanHalf = Math.tan(fov / 2);
      target = StV.add(
        target,
        StV.add(StV.mul(right, midX * dist * tanHalf * asp), StV.mul(upward, midY * dist * tanHalf)),
      );
      dist *= half;
      if (Math.abs(half - 1) < 1e-3 && Math.abs(midX) < 1e-3 && Math.abs(midY) < 1e-3) break;
    }
    eye = StV.add(target, StV.mul(dir, dist));
    view = StM4.look(eye, target, [0, 0, 1]);
    return { eye, T: target, D: dist, view, fov, asp, span };
  }
}
