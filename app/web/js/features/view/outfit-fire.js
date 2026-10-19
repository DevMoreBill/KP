import { OutfitBase } from './outfit-base.js';

/** Пожарная безопасность: извещатели, модули «Буран-2,5», табло, щит ОПС, огнетушители. */
export class OutfitFire {
  constructor(o) {
    this.o = o;
  }

  /**
   * Пожарная безопасность (plan.fire): извещатели и модули «Буран-2,5» на потолке; табло «Выход» над выходами (при
   * пожаротушении рядом — «Порошок! Уходи!»); щит ОПС, ручной извещатель, оповещатель и огнетушитель — у выхода, второй
   * огнетушитель — у основного оборудования; места — не за оборудованием и не в узком проходе, видимые — в первую очередь.
   */
  fire() {
    const { s: S, p: P } = this.o;
    const F = P.fire;
    if (!this.o.inside || !F) return;
    const M = { red: S.M(StMat.paint(OutfitBase.RED, 0.4)), wh: S.M(StMat.paint('#f2f3f4', 0.35)) };
    this.o.walls.shade(P);
    if (F.ops) this.detectors(F.rooms[0], M.wh);
    for (const q of F.rooms) for (const m of q.mods) this.buran(S.P(m.x, m.y, P.int[2]));
    this.boards(F);
    const ws = ['back', 'right', 'left', 'front'];
    const door = OutfitFire.door(P, F);
    const E = OutfitBase.EXT;
    const EB = [
      [260, E - 550, E + 340],
      [500, E - 550, E + 30, 150],
      [260, E - 1050, E - 160, 400],
      [500, E - 1050, E - 470, 550],
    ];
    const e2 = F.rooms[0].ext > 1 ? this.o.near(ws, EB, OutfitFire.mainAt(P)) : null;
    if (F.ops) this.opsPanel(ws, door);
    const e1 = this.o.near(ws, EB, door, 1500);
    for (const e of [e1, e2].filter(q => q && (q.w !== 'front' || !S.cut))) this.extAt(e);
    if (F.ops) this.alarms(ws, door, M);
  }

  /** Извещатели на потолке: не меньше двух, через 3,5 м. */
  detectors(main, wh) {
    const S = this.o.s;
    const [, W, H] = this.o.p.int;
    const n = Math.max(2, Math.ceil((main.x1 - main.x0) / 3500));
    const led = S.M(StMat.glow('#ff3b30', 2));
    for (let i = 0; i < n; i++) {
      const c = S.P(main.x0 + ((main.x1 - main.x0) * (i + 0.5)) / n, W * 0.28, H);
      wh.tube(c, StV.add(c, [0, 0, -0.045]), 0.05, 18);
      wh.tube(StV.add(c, [0, 0, -0.045]), StV.add(c, [0, 0, -0.06]), 0.032, 14);
      led.sphere(StV.add(c, [0.036, 0, -0.04]), 0.006, 6);
    }
  }

  /** Табло над выходом (низ — не ниже верха проёма) и над вторым выходом. */
  boards(F) {
    const H = this.o.p.int[2];
    const ex = F.exit;
    if (ex) {
      const z = Math.max(ex.top + 90, H - 125);
      const two = F.auto && ex.w >= 800;
      const du = two ? 200 : 0;
      if (z + 75 < H - 20) {
        this.hang('EXIT', ex.wall, [ex.u - du, z], [360, 130]);
        if (two) this.hang('POW_OUT', ex.wall, [ex.u + du, z], [360, 130]);
      }
    }
    if (F.exit2) {
      const e = F.exit2;
      const z = Math.max(e.top + 90, H - 125);
      if (z + 75 < H - 20) this.hang('EXIT', e.wall, [e.u, z], [360, 130]);
    }
  }

  /** Точка плана у выхода: дверь оператора, иначе дверь в стене, иначе середина торца у входа. */
  static door(P, F) {
    const ex = F.exit;
    const x0 = P.geo.x0 || 0;
    const W = P.int[1];
    if (ex) return ex.wall === 'front' ? [ex.u, 0] : [x0, ex.u];
    const d0 = (P.doors || []).find(d => d.wall !== 'back');
    return d0 ? [(d0.x0 + d0.x1) / 2, 0] : [x0, W / 2];
  }

  /** Основное оборудование (ДГУ, самый мощный компрессор): точка у его лицевой стороны. */
  static mainAt(P) {
    const W = P.int[1];
    const I = P.items.filter(i => !i.tank && (i.mount === 'floor' || i.mount === 'frame'));
    const comp = I.filter(i => i.kind === 'compressor').sort((a, b) => (b.kw || 0) - (a.kw || 0))[0];
    const big = I.find(i => i.kind === 'dgu') || comp || I[0];
    if (!big) return [P.int[0], W / 2];
    return [big.x + big.lx / 2, big.y + big.ly / 2 > W / 2 ? big.y : big.y + big.ly];
  }

  opsPanel(ws, door) {
    const o = this.o.near(
      ws,
      [
        [340, 1030, 1470],
        [340, 930, 1370, 200],
      ],
      door,
      4500,
    );
    if (o) this.panel(o.w, o.u, o.z0 + 220);
  }

  /** Огнетушитель: верх — не выше EXT, знак F04 — над ним, на широком месте — сбоку. */
  extAt(e) {
    const side = e.wd > 260;
    const u = side ? e.u - 120 : e.u;
    this.extinguisher(this.o.at(e.w, u, e.z0 + 50), OutfitBase.N[e.w]);
    this.o.sign({ type: 'sign', id: 'F04' }, e.w, [side ? u + 250 : u, side ? e.z0 + 430 : e.z0 + 770], [200, 200]);
  }

  /** Ручной пожарный извещатель (1,5 м) и оповещатель (под потолком) — у выхода. */
  alarms(ws, door, { red, wh }) {
    const H = this.o.p.int[2];
    const m = this.o.near(ws, [[160, 1380, 1620]], door, 0);
    if (m) {
      this.o.log.push({ kind: 'mcp', wall: m.w, u: m.u });
      this.o.box(red, m.w, [m.u, 1500], [95, 95, 45], 0.006);
      this.o.box(wh, m.w, [m.u, 1508], [52, 44, 48], 0.003);
    }
    const zs = Math.min(2100, H - 190);
    const s = this.o.near(ws, [[170, zs - 150, zs + 150]], door, 0);
    if (s) {
      this.o.log.push({ kind: 'sounder', wall: s.w, u: s.u });
      this.o.box(red, s.w, [s.u, zs], [120, 140, 55], 0.012);
      this.o.box(wh, s.w, [s.u, zs + 35], [76, 36, 58], 0.008);
    }
  }

  /** Модуль «Буран-2,5» на потолке (c — точка потолка): кронштейн, красный корпус Ø 250 мм с этикеткой, распылитель снизу,
   *  тепловой замок посередине */
  buran(c) {
    const S = this.o.s;
    const red = S.M(StMat.paint('#c62d22', 0.35));
    const dk = S.M(StMat.paint('#2a2e33', 0.5));
    const gr = S.M(StMat.paint('#d3d6d9', 0.45));
    const lb = S.M(StMat.paint('#f1efe8', 0.6));
    const r = 0.125;
    const z1 = c[2] - 0.035;
    const z0 = z1 - 0.11;
    const [x, y] = c;
    this.o.log.push({ kind: 'buran', at: c });
    dk.box(x - 0.1, y - 0.022, c[2] - 0.008, x + 0.1, y + 0.022, c[2]);
    dk.tube([x, y, c[2] - 0.008], [x, y, z1], 0.018, 10); // кронштейн
    red.tube([x, y, z0], [x, y, z1], r, 32);
    lb.tube([x, y, z0 + 0.03], [x, y, z0 + 0.075], r * 1.006, 32, [false, false]);
    gr.tube([x, y, z0 - 0.014], [x, y, z0], r * 0.9, 32, [true, false]);
    dk.tube([x, y, z0 - 0.04], [x, y, z0 - 0.014], 0.022, 14, [true, false]);
  }

  /** Щит ОПС на стене (середина u, zc — середина по высоте): корпус, дисплей, индикаторы «Пожар», «Неисправность», «Питание»,
   *  табличка */
  panel(w, u, zc) {
    const S = this.o.s;
    this.o.log.push({ kind: 'ops', wall: w, u, seen: this.o.seen(w, u, zc) });
    this.o.box(S.M(StMat.paint('#e2e5e8', 0.4)), w, [u, zc], [300, 400, 120], 0.012);
    this.o.box(S.M(StMat.paint('#1d2226', 0.35)), w, [u, zc + 105], [200, 80, 123], 0.004);
    S.M(StMat.glow('#9fe6b3', 1.2)).box(...this.o.at(w, u - 85, zc + 75, 124), ...this.o.at(w, u + 85, zc + 135, 125)); // экран
    for (const [k, c] of [
      [-1, '#ff3b30'],
      [0, '#ffc21a'],
      [1, '#39d353'],
    ])
      this.o.box(S.M(StMat.glow(c, 2.4)), w, [u + k * 45, zc + 30], [22, 22, 128], 0.004);
    this.o.sign({ type: 'sign', id: 'OPS' }, w, [u, zc - 90], [220, 82], [121, 0]);
  }

  /** Табло под потолком у стены w над проёмом: корпус, надпись с обеих сторон (в разрезе стена срезана — видна и снаружи),
   *  подвес к потолку */
  hang(id, w, [u, z], [sw, sh]) {
    const S = this.o.s;
    const [, , H] = this.o.p.int;
    const b = S.M(StMat.paint('#eceeef', 0.4));
    const dk = S.M(StMat.paint('#2a2e33', 0.5));
    const o0 = 20;
    const o1 = 60;
    const n = OutfitBase.N[w];
    const m = StV.mul(n, -1);
    const a = this.o.at(w, u - sw / 2 - 15, z - sh / 2 - 15, o0);
    const c = this.o.at(w, u + sw / 2 + 15, z + sh / 2 + 15, o1);
    this.o.log.push({ kind: 'board', id, wall: w, u, z0: z - sh / 2 - 15 });
    b.box(Math.min(a[0], c[0]), Math.min(a[1], c[1]), a[2], Math.max(a[0], c[0]), Math.max(a[1], c[1]), c[2], 0.006);
    for (const k of [-1, 1]) {
      const p = this.o.at(w, u + k * (sw / 2 - 30), z + sh / 2 + 15, (o0 + o1) / 2);
      dk.tube(p, [p[0], p[1], S.base + H / 1000], 0.005, 6);
    }
    S.sticker({ type: 'sign', id }, this.o.at(w, u, z, o1), n, sw / 1000, sh / 1000, 1.4);
    S.sticker({ type: 'sign', id }, this.o.at(w, u, z, o0), m, sw / 1000, sh / 1000, 1.4);
  }

  /** Огнетушитель на стене: base — точка стены на высоте низа корпуса, n — от стены; корпус, головка с рычагом и манометром,
   *  шланг с раструбом, хомут кронштейна, этикетка */
  extinguisher(base, n) {
    const S = this.o.s;
    const r = 0.075;
    const c = StV.add(base, StV.mul(n, r + 0.03));
    const t = StV.norm(StV.cross(n, [0, 0, 1]));
    const z0 = c[2];
    const z1 = z0 + 0.36;
    const hz = z1 + r * 0.5 + 0.06;
    const red = S.M(StMat.paint(OutfitBase.RED, 0.35));
    const dk = S.M(StMat.paint('#1d2024', 0.5));
    const mt = S.M(StMat.metal('#b9bfc5', 0.3));
    const lb = S.M(StMat.paint('#f1efe8', 0.6));
    this.o.log.push({ kind: 'ext', top: Math.round((hz + 0.012 - S.base) * 1000), at: c });
    red.tube([c[0], c[1], z0], [c[0], c[1], z1], r, 24, [true, false]);
    red.dish(c[0], c[1], z1, r, 1, 24);
    lb.tube([c[0], c[1], z0 + 0.1], [c[0], c[1], z0 + 0.22], r * 1.004, 24, [false, false]);
    mt.tube([c[0], c[1], z1 + r * 0.45], [c[0], c[1], hz - 0.03], 0.018, 12);
    dk.box(c[0] - 0.022, c[1] - 0.022, hz - 0.03, c[0] + 0.022, c[1] + 0.022, hz + 0.01, 0.004);
    dk.obox(StV.add([c[0], c[1], hz], StV.mul(t, -0.02)), StV.mul(t, 0.12), StV.mul(n, 0.022), [0, 0, 0.012]); // рычаг
    S.M(StMat.paint('#f4f4f2', 0.3)).tube(
      StV.add([c[0], c[1], hz - 0.012], StV.mul(n, 0.022)),
      StV.add([c[0], c[1], hz - 0.012], StV.mul(n, 0.03)),
      0.016,
      14,
    ); // манометр
    const h0 = StV.add([c[0], c[1], hz - 0.02], StV.mul(t, -0.025));
    const h1 = StV.add([c[0], c[1], z1 - 0.04], StV.mul(t, -(r + 0.014)));
    const h2 = StV.add([c[0], c[1], z0 + 0.1], StV.mul(t, -(r + 0.014)));
    dk.tube(h0, h1, 0.009, 8);
    dk.sphere(h1, 0.009, 8);
    dk.tube(h1, h2, 0.009, 8);
    dk.tube(h2, StV.add(h2, [0, 0, -0.05]), 0.014, 10); // шланг
    dk.tube([c[0], c[1], z0 + 0.27], [c[0], c[1], z0 + 0.3], r * 1.06, 24, [false, false]);
    dk.box(
      Math.min(base[0], c[0] - t[0] * 0.03),
      Math.min(base[1], c[1] - t[1] * 0.03),
      z0 + 0.26,
      Math.max(base[0], c[0] + t[0] * 0.03),
      Math.max(base[1], c[1] + t[1] * 0.03),
      z0 + 0.31,
      0.003,
    ); // кронштейн
  }
}
