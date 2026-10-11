// Оснащение контейнера на 3D-виде станции (StScene, station-render.js) — всё, что видно на картинке, кроме оборудования:
// свет (светодиодные светильники, аварийный с зелёным индикатором, светильники над дверями снаружи), отопление
// (электроконвекторы на местах из расчёта StationHeat), вентиляция (снаружи — жалюзи с козырьками, изнутри — решётки
// с клапанами и электроприводами, воздуховод от радиатора ДГУ), пожарная безопасность (огнетушители: верх не выше 1,5 м,
// над ними знак F04; извещатели на потолке, ручной пожарный извещатель и оповещатель у выхода, табло «Выход»; при
// автоматическом пожаротушении — модули аэрозольного тушения и табло «Аэрозоль! Уходи!» / «Не входи!»), кабельный лоток,
// отсек топливного бака ДГУ (перегородка, поддон, заливная горловина снаружи в ящике, дыхательный клапан над крышей,
// жалюзи отсека), знаки на дверях, логотип организации на контейнере. Места на стенах — без наложений (StWalls).
// Сцена — без DOM: наклейки — описания, картинки рисует StDecal (station-decal.js) в браузере.
'use strict';

// ---------------------------------------------------------------- места на стенах помещения оборудования
// Стены: left — у начала помещения (торец или перегородка отсека / тамбура), right — дальний торец, back — задняя,
// front — со стороны прохода (зрителя). u — вдоль стены (left/right — y, back/front — x), z — от пола, мм.
class StWalls {
  static NEAR = 450;      // оборудование ближе к стене — место перед ним занято (до его высоты + 150 мм)
  constructor(plan){
    const [L, W, H]=plan.int, x0=plan.geo.x0||0, I=(plan.items||[]).filter(i=>!i.tank), N=StWalls.NEAR;
    this.L=L; this.W=W; this.x0=x0; this.B={ left:[], right:[], back:[], front:[] };
    for (const i of I){
      if (i.mount==='wall'){ this.busy(i.wall, ...(i.wall==='front' || i.wall==='back' ? [i.x, i.x+i.lx] : [i.y, i.y+i.ly]), i.z, i.z+i.h); continue; }
      if (i.mount==='pipe') continue;
      const top=(i.z||0)+i.h+150;
      if (i.y<N) this.busy('front', i.x, i.x+i.lx, 0, top);
      if (W-i.y-i.ly<N) this.busy('back', i.x, i.x+i.lx, 0, top);
      if (i.x-x0<N) this.busy('left', i.y, i.y+i.ly, 0, top);
      if (L-i.x-i.lx<N) this.busy('right', i.y, i.y+i.ly, 0, top); }
    for (const h of (plan.heat && plan.heat.heaters)||[]) this.busy(h.wall, ...(h.wall==='front' || h.wall==='back' ? [h.x, h.x+h.lx] : [h.y, h.y+h.ly]), 0, h.z+h.h+100);
    if (plan.door==='side') this.busy('front', x0+StationLayout.ENTRY[0]-100, x0+StationLayout.ENTRY[1]+100, 0, StationLayout.DOOR.h+150);
    for (const d of plan.doors||[]) this.busy(d.wall==='back' ? 'back' : 'front', d.x0-100, d.x1+100, 0, d.h+150);
    for (const l of plan.lines||[]) if (W-l.y<500) for (const [a, b] of StationLayout.runs(l)) this.busy('back', a, b, l.z-150, l.z+150);
    if ((plan.sys||{}).power!==false) this.busy('back', x0, L, H-320, H);   // кабельный лоток под потолком
  }
  busy(w, u0, u1, z0, z1){ if (this.B[w]) this.B[w].push([u0, u1, z0, z1]); }
  free(w, u0, u1, z0, z1){ return (this.B[w]||[]).every(([a, b, c, d])=>!(a<u1 && b>u0 && c<z1 && d>z0)); }
  range(w){ return w==='left' || w==='right' ? [0, this.W] : [this.x0, this.L]; }
  /** начало свободного участка шириной wd на высоте z0…z1: от начала стены (lo) или от конца (hi); нет — null */
  find(w, wd, z0, z1, from='lo'){
    const [lo, hi]=this.range(w);
    if (from==='lo'){ for (let u=lo+120; u+wd<=hi-120; u+=50) if (this.free(w, u, u+wd, z0, z1)) return u; }
    else for (let u=hi-120-wd; u>=lo+120; u-=50) if (this.free(w, u, u+wd, z0, z1)) return u;
    return null;
  }
}

// ---------------------------------------------------------------- оснащение
class StOutfit {
  static N = { left:[1, 0, 0], right:[-1, 0, 0], back:[0, -1, 0], front:[0, 1, 0] };   // нормаль стены — внутрь
  static EXT = 1500;      // огнетушитель: верх — не выше 1,5 м от пола (Правила противопожарного режима в РФ)
  static RED = '#c42a20';

  constructor(scene){ this.s=scene; this.p=scene.plan; this.sys=this.p.sys||{}; this.walls=new StWalls(this.p); this.inside=scene.view==='in'; this.log=[]; }   // log — что где поставлено (проверки)
  build(){ this.lights(); this.tray(); this.heaters(); this.vents(); this.fire(); this.fuel(); this.doors(); this.brand(); return this; }

  /** точка у стены помещения: u — вдоль стены, z — от пола, o — от стены внутрь, мм → мир, м */
  at(w, u, z, o=0){ const S=this.s, x0=S.g.x0||0, [L, W]=this.p.int;
    return w==='left' ? S.P(x0+o, u, z) : w==='right' ? S.P(L-o, u, z) : w==='back' ? S.P(u, W-o, z) : S.P(u, o, z); }
  /** короб на стене: середина u, z; ширина du, высота dz, глубина d — от стены, мм */
  box(m, w, u, z, du, dz, d, r=0.004){ const a=this.at(w, u-du/2, z-dz/2, 0), b=this.at(w, u+du/2, z+dz/2, d);
    m.box(Math.min(a[0], b[0]), Math.min(a[1], b[1]), a[2], Math.max(a[0], b[0]), Math.max(a[1], b[1]), b[2], r); }
  /** наклейка на стене (знак, табло): середина u, z, размер sw × sh, на расстоянии o от стены, мм; e — свечение */
  sign(d, w, u, z, sw, sh, o=0, e=0){ this.s.sticker(d, this.at(w, u, z, o), StOutfit.N[w], sw/1000, sh/1000, e); }
  /** стена видна: снаружи внутреннего не видно, стена со стороны зрителя в разрезе срезана */
  shown(w){ return this.inside && !(w==='front' && this.s.cut); }
  /** первое свободное место на стенах ws (по порядку), место занимается: [стена, середина] или null */
  spot(ws, wd, z0, z1, from='lo'){
    for (const w of ws){ if (!this.shown(w)) continue; const u=this.walls.find(w, wd, z0, z1, from);
      if (u!=null){ this.walls.busy(w, u, u+wd, z0, z1); return [w, u+wd/2]; } }
    return null;
  }
  /** наружная поверхность стены со стороны зрителя (y) и торца у двери (x): гофр и профлист выступают */
  frontY(){ const S=this.s; return S.g.sea ? -0.008 : S.g.type==='welded' ? 0.003 : 0.018; }
  leftX(){ const S=this.s; return S.g.sea ? -0.034 : this.p.door==='end' ? -0.023 : S.g.type==='welded' ? 0.003 : 0.018; }

  // ---- свет: светильники вдоль помещения, у первого — аварийный блок (зелёный индикатор); в отсеке бака и тамбуре — круглый
  lights(){
    const S=this.s, P=this.p, [L, W, H]=P.int, x0=S.g.x0||0; if (this.sys.light===false || !this.inside) return;
    const lamp=S.M(StMat.glow('#fffdf4', 5)), body=S.M(StMat.paint('#e9ecee', 0.4)), n=Math.max(1, Math.round((L-x0)/2600)), y=W/2;
    for (let i=0; i<n; i++){ const x=x0+(L-x0)*(i+0.5)/n; body.box(...S.P(x-600, y-90, H-60), ...S.P(x+600, y+90, H), 0.01); lamp.box(...S.P(x-570, y-70, H-62), ...S.P(x+570, y+70, H-55)); }
    const xe=x0+(L-x0)*0.5/n; S.M(StMat.glow('#39d353', 3)).box(...S.P(xe+520, y-104, H-48), ...S.P(xe+565, y-92, H-28));
    const fu=P.fuel, rooms=[], tb=x0-(fu ? fu.x1+fu.part : 0); if (fu) rooms.push([0, fu.x1]); if (tb>0) rooms.push([x0-tb, x0-60]);
    for (const [a, b] of rooms){ const c=S.P((a+b)/2, W/2, H); body.tube(c, StV.add(c, [0, 0, -0.06]), 0.13, 20); lamp.tube(StV.add(c, [0, 0, -0.06]), StV.add(c, [0, 0, -0.068]), 0.1, 20); }
  }
  /** кабельный лоток вдоль задней стены под потолком */
  tray(){
    const S=this.s, [L, W, H]=this.p.int, x0=S.g.x0||0; if (this.sys.power===false || !this.inside) return;
    const tr=S.M(StMat.metal(StScene.GALV, 0.45)); tr.box(...S.P(x0+150, W-220, H-260), ...S.P(L-150, W-20, H-210), 0.003);
    for (let x=x0+600; x<L-300; x+=1500) tr.box(...S.P(x, W-240, H-280), ...S.P(x+30, W, H-260));
  }

  // ---- отопление: конвекторы на местах из расчёта (решётка сверху, терморегулятор, кронштейны)
  heaters(){
    const S=this.s, h=this.p.heat; if (!h || !h.heaters || !this.inside) return;
    const cv=S.M(StMat.paint('#f4f5f6', 0.35)), gr=S.M(StMat.paint('#aab0b6', 0.5)), dk=S.M(StMat.paint('#2b3036', 0.5)), D=StationHeat.CONV.d;
    for (const q of h.heaters){ if (!this.shown(q.wall)) continue;
      const al=q.wall==='front' || q.wall==='back', u0=al ? q.x : q.y, du=al ? q.lx : q.ly, uc=u0+du/2, zc=q.z+q.h/2; this.log.push({ kind:'heater', wall:q.wall, u0, u1:u0+du });
      this.box(cv, q.wall, uc, zc, du, q.h, D, 0.012);
      for (let k=0; k<5; k++) this.box(dk, q.wall, uc, q.z+q.h-45-k*24, du-70, 9, D+2, 0);       // решётка тёплого воздуха
      this.box(gr, q.wall, u0+du-55, q.z+q.h-110, 34, 34, D+14, 0.008);                           // терморегулятор
      for (const u of [u0+90, u0+du-90]) this.box(dk, q.wall, u, q.z+q.h+18, 40, 36, 24, 0); }   // кронштейны
  }

  // ---- вентиляция: у ДГУ — жалюзи с электроприводом напротив радиатора и воздуховод к ним, приток внизу; без ДГУ — вытяжка
  // вверху в дальнем торце, приток внизу у входа (в своём торце или в задней стене)
  vents(){
    const P=this.p, [, W, H]=P.int, x0=this.s.g.x0||0, dgu=P.items.find(i=>i.kind==='dgu' && !i.tank);
    const leftOut=x0===0 && P.door!=='end' && !this.s.g.sea;
    const intake=(wd, hh)=>{ if (leftOut) return this.vent('left', W*0.25, W*0.25+wd, 200, 200+hh);
      const u=this.walls.find('back', wd+260, 120, 260+hh, 'lo'); if (u!=null) this.vent('back', u+130, u+130+wd, 200, 200+hh); };
    if (dgu){ this.vent('right', dgu.y+80, dgu.y+dgu.ly-80, Math.round(dgu.h*0.12), Math.round(dgu.h*0.95)); this.duct(dgu); intake(900, 750); return; }
    if (this.sys.vent===false) return;
    const rc=P.items.filter(i=>i.wall==='right'), y0=rc.length ? Math.max(W*0.3, Math.max(...rc.map(i=>i.y+i.ly))+150) : W*0.3, y1=Math.min(W-120, y0+W*0.4);
    if (y1-y0>=250) this.vent('right', Math.round(y0), Math.round(y1), H-750, H-200);
    intake(Math.round(W*0.3), 450);
  }
  /** проём вентиляции в стене помещения: снаружи — жалюзи с козырьком, изнутри — решётка и клапан с электроприводом */
  vent(w, u0, u1, z0, z1){
    const S=this.s, a=u0/1000, b=u1/1000, Z0=S.base+z0/1000, Z1=S.base+z1/1000;
    this.walls.busy(w, u0-90, u1+260, z0-90, z1+90);
    if (w==='right') S.louver(1, S.Le, S.oy+a, S.oy+b, Z0, Z1, 1);
    else if (w==='left') S.louver(1, 0, S.oy+a, S.oy+b, Z0, Z1, -1);
    else if (w==='back') S.louver(0, S.We, S.ox+a, S.ox+b, Z0, Z1, 1);
    else if (!S.cut) S.louver(0, 0, S.ox+a, S.ox+b, Z0, Z1, -1);
    this.hood(w, a-0.06, b+0.06, Z1+0.06);
    if (!this.shown(w)) return;
    const fr=S.M(StMat.paint('#9aa1a8', 0.5)), sl=S.M(StMat.paint('#6b737b', 0.55)), dk=S.M(StMat.paint('#202428', 0.6)), uc=(u0+u1)/2, zc=(z0+z1)/2, du=u1-u0, dz=z1-z0;
    for (const [u, z, a1, b1] of [[uc, z0, du+60, 30], [uc, z1, du+60, 30], [u0, zc, 30, dz+60], [u1, zc, 30, dz+60]]) this.box(fr, w, u, z, a1, b1, 25);
    for (let z=z0+40; z<z1-20; z+=55) this.box(sl, w, uc, z, du-10, 12, 18, 0);
    this.box(dk, w, u1+130, zc, 110, 150, 90, 0.008); this.box(fr, w, u1+50, zc, 50, 20, 40, 0);   // электропривод клапана
  }
  /** козырёк над жалюзи снаружи (от дождя и снега) */
  hood(w, a, b, zt){
    const S=this.s, m=S.M(StMat.paint(RalColor.shade(S.wall, 0.9), 0.45)), t=[0, 0, 0.006];
    if (w==='right') m.obox([S.Le, S.oy+a, zt], [0, b-a, 0], [0.14, 0, -0.07], t);
    else if (w==='left') m.obox([0, S.oy+a, zt], [0, b-a, 0], [-0.14, 0, -0.07], t);
    else if (w==='back') m.obox([S.ox+a, S.We, zt], [b-a, 0, 0], [0, 0.14, -0.07], t);
    else if (!S.cut) m.obox([S.ox+a, 0, zt], [b-a, 0, 0], [0, -0.14, -0.07], t);
  }
  /** воздуховод от радиатора ДГУ к жалюзи — гибкая вставка из ткани с рамками */
  duct(it){
    const S=this.s, [L]=this.p.int, x1=it.x+it.lx; if (!this.inside || L-x1<30) return;
    S.M(StMat.paint('#3b4046', 0.85)).box(...S.P(x1, it.y+60, it.h*0.1), ...S.P(L, it.y+it.ly-60, it.h*0.96), 0.02);
    const f=S.M(StMat.metal('#8f969d', 0.45)); for (const x of [x1, L-40]) f.box(...S.P(x, it.y+50, it.h*0.09), ...S.P(x+40, it.y+it.ly-50, it.h*0.97), 0.006);
  }

  // ---- пожарная безопасность
  fire(){
    const S=this.s, P=this.p, [L, W, H]=P.int, x0=S.g.x0||0, sys=this.sys; if (!this.inside) return;
    const red=S.M(StMat.paint(StOutfit.RED, 0.4)), wh=S.M(StMat.paint('#f2f3f4', 0.35)), dgu=P.items.some(i=>i.kind==='dgu');
    // извещатели на потолке: не меньше двух, через 3,5 м (у ДГУ — тепловые), индикатор
    if (sys.ops || sys.fire){ const n=Math.max(2, Math.ceil((L-x0)/3500)), led=S.M(StMat.glow('#ff3b30', 2));
      for (let i=0; i<n; i++){ const c=S.P(x0+(L-x0)*(i+0.5)/n, W*0.28, H); wh.tube(c, StV.add(c, [0, 0, -0.045]), 0.05, 18); wh.tube(StV.add(c, [0, 0, -0.045]), StV.add(c, [0, 0, -0.06]), 0.032, 14); led.sphere(StV.add(c, [0.036, 0, -0.04]), 0.006, 6); } }
    // у выхода — табло «Выход» (с аккумулятором — аварийное освещение), при пожаротушении — «Аэрозоль! Уходи!» (раньше
    // огнетушителей: на видимой стене)
    const gTop=S.g.sea ? H : 160+Math.min(2200, S.He*1000-400)-StationGeo.zFloor(S.g.type, S.g.t);   // верх ворот в торце
    if (P.door==='end' && x0===0 && gTop+300<H) this.board('EXIT', 'left', W/2, gTop+150, 360, 140);
    else { const x=this.spot(['back', 'right', 'left'], 380, H-440, H-270, 'lo'); if (x) this.board('EXIT', x[0], x[1], H-355, 360, 140); }
    if (sys.fire){ const t=this.spot(['back', 'right', 'left'], 440, H-440, H-270, 'lo'); if (t) this.board('AERO_OUT', t[0], t[1], H-355, 420, 120); }
    // огнетушители: у выхода и в дальней части (у ДГУ и в помещении больше 15 м² — два), над каждым — знак F04
    // (стены по порядку: видимые на разрезе — задняя и дальний торец — раньше ближнего торца)
    const two=dgu || (L-x0)*W/1e6>15, e1=this.spot(['back', 'right', 'left'], 260, 950, 1840, 'lo');
    const e2=two ? this.spot(['right', 'back', 'left'], 260, 950, 1840, e1 && e1[0]==='back' ? 'hi' : 'lo') : null;
    for (const e of [e1, e2]) if (e){ this.extinguisher(this.at(e[0], e[1], StOutfit.EXT-500), StOutfit.N[e[0]]); this.sign({ type:'sign', id:'F04' }, e[0], e[1], 1720, 200, 200); }
    if (sys.ops || sys.fire){
      const m=this.spot(['back', 'right', 'left'], 160, 1380, 1620, 'lo'); if (m){ this.box(red, m[0], m[1], 1500, 95, 95, 45, 0.006); this.box(wh, m[0], m[1], 1508, 52, 44, 48, 0.003); }
      const o=this.spot(['back', 'right', 'left'], 170, 1950, 2250, 'lo'); if (o){ this.box(red, o[0], o[1], 2100, 120, 140, 55, 0.012); this.box(wh, o[0], o[1], 2135, 76, 36, 58, 0.008); } }
    // автоматическое пожаротушение: модули аэрозольного тушения на стенах под потолком (не меньше двух, через 3 м; сопло —
    // вниз в помещение)
    if (sys.fire){
      const n=Math.max(2, Math.ceil((L-x0)/3000)), dk=S.M(StMat.paint('#202428', 0.6)), mr=S.M(StMat.paint('#c8302a', 0.4));
      for (let i=0; i<n; i++){ const m=this.spot(['back', 'right', 'left'], 360, H-1000, H-560, i%2 ? 'hi' : 'lo'); if (!m) break;
        const [w, u]=m, a=this.at(w, u, H-660, 90), b=this.at(w, u, H-860, 400);
        this.box(dk, w, u, H-650, 80, 160, 100, 0.004); mr.tube(a, b, 0.075, 18, [true, false]); dk.tube(b, StV.add(b, StV.mul(StV.norm(StV.sub(b, a)), 0.025)), 0.062, 16); }
    }
  }
  /** огнетушитель на стене: base — точка стены на высоте низа корпуса, n — от стены; корпус, головка с рычагом и манометром,
   *  шланг с раструбом, хомут кронштейна, этикетка */
  extinguisher(base, n){
    const S=this.s, r=0.075, c=StV.add(base, StV.mul(n, r+0.03)), t=StV.norm(StV.cross(n, [0, 0, 1])), z0=c[2], z1=z0+0.36, hz=z1+r*0.5+0.06;
    const red=S.M(StMat.paint(StOutfit.RED, 0.35)), dk=S.M(StMat.paint('#1d2024', 0.5)), mt=S.M(StMat.metal('#b9bfc5', 0.3)), lb=S.M(StMat.paint('#f1efe8', 0.6));
    this.log.push({ kind:'ext', top:Math.round((hz+0.012-S.base)*1000), at:c });
    red.tube([c[0], c[1], z0], [c[0], c[1], z1], r, 24, [true, false]); red.dish(c[0], c[1], z1, r, 1, 24);
    lb.tube([c[0], c[1], z0+0.1], [c[0], c[1], z0+0.22], r*1.004, 24, [false, false]);
    mt.tube([c[0], c[1], z1+r*0.45], [c[0], c[1], hz-0.03], 0.018, 12);
    dk.box(c[0]-0.022, c[1]-0.022, hz-0.03, c[0]+0.022, c[1]+0.022, hz+0.01, 0.004);
    dk.obox(StV.add([c[0], c[1], hz], StV.mul(t, -0.02)), StV.mul(t, 0.12), StV.mul(n, 0.022), [0, 0, 0.012]);   // рычаг
    S.M(StMat.paint('#f4f4f2', 0.3)).tube(StV.add([c[0], c[1], hz-0.012], StV.mul(n, 0.022)), StV.add([c[0], c[1], hz-0.012], StV.mul(n, 0.03)), 0.016, 14);   // манометр
    const h0=StV.add([c[0], c[1], hz-0.02], StV.mul(t, -0.025)), h1=StV.add([c[0], c[1], z1-0.04], StV.mul(t, -(r+0.014))), h2=StV.add([c[0], c[1], z0+0.1], StV.mul(t, -(r+0.014)));
    dk.tube(h0, h1, 0.009, 8); dk.sphere(h1, 0.009, 8); dk.tube(h1, h2, 0.009, 8); dk.tube(h2, StV.add(h2, [0, 0, -0.05]), 0.014, 10);   // шланг
    dk.tube([c[0], c[1], z0+0.27], [c[0], c[1], z0+0.3], r*1.06, 24, [false, false]);
    dk.box(Math.min(base[0], c[0]-t[0]*0.03), Math.min(base[1], c[1]-t[1]*0.03), z0+0.26, Math.max(base[0], c[0]+t[0]*0.03), Math.max(base[1], c[1]+t[1]*0.03), z0+0.31, 0.003);   // кронштейн
  }
  /** световое табло на стене: корпус и светящаяся надпись */
  board(id, w, u, z, sw, sh){
    this.box(this.s.M(StMat.paint('#eceeef', 0.4)), w, u, z, sw+30, sh+30, 45, 0.006);
    this.sign({ type:'sign', id }, w, u, z, sw, sh, 46, 1.4);
  }

  // ---- отсек топливного бака ДГУ: перегородка (в разрезе — утеплитель), поддон, заливная труба к горловине снаружи,
  // дыхательный клапан с огнепреградителем над крышей, огнетушитель, жалюзи отсека; дверь — в стене прохода (StScene.shut)
  fuel(){
    const S=this.s, P=this.p, f=P.fuel; if (!f) return;
    const [, W, H]=P.int, mm=S.mm, T=P.items.filter(i=>i.tank), dk=S.M(StMat.paint('#2b3036', 0.6)), st=S.M(StMat.metal(StScene.GALV, 0.4)), fl=f.fill;
    const t=T[0], top=t ? t.z+t.h : 1000, tx=t ? t.x+t.lx*0.25 : f.x1/2, ty=t ? t.y+t.ly/2 : W/2;
    if (this.inside){
      const a=S.P(f.x1, 0, 0), b=S.P(f.x1+f.part, W, H); S.M(StMat.paint(S.lining, 0.55)).box(...a, ...b);
      if (S.cut) S.M(StMat.paint(StScene.INS, 0.9)).quad([a[0], S.oy-0.001, a[2]], [b[0], S.oy-0.001, a[2]], [b[0], S.oy-0.001, b[2]], [a[0], S.oy-0.001, b[2]], [0, -1, 0]);
      for (const q of T){ const p0=S.P(q.x-60, q.y-60, 0), p1=S.P(q.x+q.lx+60, Math.min(W-20, q.y+q.ly+60), 180), w=0.006;   // поддон
        dk.box(p0[0], p0[1], p0[2], p1[0], p1[1], p0[2]+0.008);
        for (const [x0, y0, x1, y1] of [[p0[0], p0[1], p1[0], p0[1]+w], [p0[0], p1[1]-w, p1[0], p1[1]], [p0[0], p0[1], p0[0]+w, p1[1]], [p1[0]-w, p0[1], p1[0], p1[1]]]) dk.box(x0, y0, p0[2], x1, y1, p1[2]); }
      // заливная труба: от горловины в стене — к баку сверху
      if (t){ const zr=Math.max(fl.z, top+150), bx=fl.wall==='left' ? tx : Math.max(t.x+100, Math.min(t.x+t.lx-100, fl.x)), yb=W-50;
        const Q=fl.wall==='left' ? [S.P(0, fl.y, fl.z), S.P(120, fl.y, fl.z), S.P(120, fl.y, zr), S.P(bx, fl.y, zr), S.P(bx, ty, zr), S.P(bx, ty, top)]
          : fl.wall==='back' ? [S.P(fl.x, W, fl.z), S.P(fl.x, yb, fl.z), S.P(fl.x, yb, zr), S.P(bx, yb, zr), S.P(bx, ty, zr), S.P(bx, ty, top)]
          : [S.P(fl.x, 0, fl.z), S.P(fl.x, 120, fl.z), S.P(fl.x, 120, zr), S.P(fl.x, ty, zr), S.P(bx, ty, zr), S.P(bx, ty, top)];
        for (let k=1; k<Q.length; k++){ st.tube(Q[k-1], Q[k], 0.026, 12); if (k<Q.length-1) st.sphere(Q[k], 0.027, 10); } }
      const ex=S.P(f.x1, 350, StOutfit.EXT-500); this.extinguisher(ex, [-1, 0, 0]); S.sticker({ type:'sign', id:'F04' }, S.P(f.x1, 350, 1720), [-1, 0, 0], 0.2, 0.2);
    }
    // дыхательный клапан с огнепреградителем — над крышей
    if (t){ const p=S.P(t.x+t.lx*0.8, t.y+t.ly*0.7, top), zr=S.roofZ(p[1])+(S.rise>0 ? 0.04 : 0);
      if (this.inside) st.tube(p, [p[0], p[1], S.ceil], 0.02, 10);
      st.tube([p[0], p[1], zr-0.02], [p[0], p[1], zr+0.32], 0.02, 10); st.tube([p[0], p[1], zr+0.32], [p[0], p[1], zr+0.4], 0.042, 14);
      dk.tube([p[0], p[1], zr+0.42], [p[0], p[1], zr+0.435], 0.075, 18); st.tube([p[0], p[1], zr+0.4], [p[0], p[1], zr+0.42], 0.014, 8); }
    // заливная горловина снаружи: запираемый ящик, знак «Пожароопасно», надпись «ДТ»
    const box=S.M(StMat.paint(RalColor.shade(S.wall, 0.86), 0.45)), lock=S.M(StMat.metal('#c3c8cd', 0.3));
    if (fl.wall==='left'){ const x=this.leftX(), y=S.oy+mm(fl.y), z=S.base+mm(fl.z);
      box.box(x-0.15, y-0.2, z-0.2, x, y+0.2, z+0.2, 0.012); dk.box(x-0.156, y-0.19, z+0.11, x-0.148, y+0.19, z+0.118);
      lock.box(x-0.18, y-0.025, z-0.12, x-0.15, y+0.025, z-0.06, 0.006);
      S.sticker({ type:'sign', id:'W01' }, [x-0.15, y-0.07, z-0.02], [-1, 0, 0], 0.14, 0.123); S.sticker({ type:'sign', id:'DT' }, [x-0.15, y+0.1, z-0.02], [-1, 0, 0], 0.13, 0.07);
    } else if (fl.wall==='back'){ const x=S.ox+mm(fl.x), y=S.We+0.006, z=S.base+mm(fl.z);
      box.box(x-0.2, y, z-0.2, x+0.2, y+0.15, z+0.2, 0.012); dk.box(x-0.19, y+0.148, z+0.11, x+0.19, y+0.156, z+0.118);
      lock.box(x-0.025, y+0.15, z-0.12, x+0.025, y+0.18, z-0.06, 0.006);
      S.sticker({ type:'sign', id:'W01' }, [x+0.07, y+0.15, z-0.02], [0, 1, 0], 0.14, 0.123); S.sticker({ type:'sign', id:'DT' }, [x-0.1, y+0.15, z-0.02], [0, 1, 0], 0.13, 0.07);
    } else if (!S.cut){ const x=S.ox+mm(fl.x), y=this.frontY(), z=S.base+mm(fl.z);
      box.box(x-0.2, y-0.15, z-0.2, x+0.2, y, z+0.2, 0.012); dk.box(x-0.19, y-0.156, z+0.11, x+0.19, y-0.148, z+0.118);
      lock.box(x-0.025, y-0.18, z-0.12, x+0.025, y-0.15, z-0.06, 0.006);
      S.sticker({ type:'sign', id:'W01' }, [x-0.07, y-0.15, z-0.02], [0, -1, 0], 0.14, 0.123); S.sticker({ type:'sign', id:'DT' }, [x+0.1, y-0.15, z-0.02], [0, -1, 0], 0.13, 0.07); }
    // жалюзи отсека вверху в торце (внизу — решётка в двери отсека); у морского в торце — его двери
    if (!S.g.sea){ const y0=S.oy+mm(W-450), y1=S.oy+mm(W-150); S.louver(1, 0, y0, y1, S.top-0.65, S.top-0.4, -1); this.hood('left', y0-S.oy-0.06, y1-S.oy+0.06, S.top-0.34); }
  }

  // ---- двери: светильник над дверью снаружи, знаки (вход — «Опасность поражения электрическим током», отсек бака —
  // «Пожароопасно» и «Запрещается пользоваться открытым огнём»), при пожаротушении — табло «Аэрозоль! Не входи!» и
  // «Автоматика отключена»; ворота в торце — светильник над ними
  doors(){
    const S=this.s, P=this.p;
    if (P.door==='end'){ const zg=S.dz+0.16+Math.min(2.2, S.He-0.4); if (zg+0.3<S.top-0.04) this.lamp([this.leftX(), S.We/2, zg+0.2], [-1, 0, 0]); }
    if (!S.closed) return;
    const y=-0.052, n=[0, -1, 0];
    for (const c of S.openF){ const a=S.ox+c.x0/1000, b=S.ox+c.x1/1000, xm=(a+b)/2, zt=S.base+c.h/1000, zs=S.base+1.6;
      if (c.kind!=='service' && zt+0.36<S.top-0.04) this.lamp([xm, this.frontY(), zt+0.27], n);
      if (c.kind==='entry'){ S.sticker({ type:'sign', id:'W08' }, [xm, y, zs], n, 0.22, 0.193);
        if (this.sys.fire && zt+0.25<S.top-0.04){ const hb=S.M(StMat.paint('#eceeef', 0.4)), fy=this.frontY();
          for (const [id, z] of [['AERO_NO', zt+0.16], ['AUTO_OFF', zt-0.02]]){ hb.box(b+0.13, fy-0.04, z-0.075, b+0.59, fy, z+0.075, 0.006); S.sticker({ type:'sign', id }, [b+0.36, fy-0.04, z], n, 0.42, 0.12, 1.2); } } }
      if (c.kind==='tank'){ S.sticker({ type:'sign', id:'W01' }, [xm-0.12, y, zs], n, 0.2, 0.175); S.sticker({ type:'sign', id:'P02' }, [xm+0.12, y, zs], n, 0.18, 0.18); } }
  }
  /** светильник на наружной стене: корпус, светящийся рассеиватель снизу; c — точка крепления, n — от стены */
  lamp(c, n){
    const S=this.s, r=StV.norm(StV.cross(StV.mul(n, -1), [0, 0, 1])), U=StV.mul(r, 0.12), D=StV.mul(n, 0.14);
    const box=(m, o, u, d, z0, z1)=>{ const Q=[StV.sub(o, u), StV.add(o, u), StV.add(StV.add(o, u), d), StV.add(StV.sub(o, u), d)];
      m.box(Math.min(...Q.map(p=>p[0])), Math.min(...Q.map(p=>p[1])), z0, Math.max(...Q.map(p=>p[0])), Math.max(...Q.map(p=>p[1])), z1, 0.008); };
    const g=S.M(StMat.glow('#fff4d6', 3.2)); box(S.M(StMat.paint('#30363c', 0.5)), c, U, D, c[2]-0.04, c[2]+0.05); box(g, StV.add(c, StV.mul(n, 0.02)), StV.mul(U, 0.85), StV.mul(D, 0.78), c[2]-0.047, c[2]-0.039);
    box(g, StV.add(c, StV.mul(n, 0.135)), StV.mul(U, 0.8), StV.mul(n, 0.012), c[2]-0.038, c[2]-0.012);   // рассеиватель виден и спереди
  }

  // ---- логотип организации: на торце у двери (виден и в разрезе); снаружи — ещё на длинной стене в самом широком простенке
  brand(){
    const S=this.s, m=S.meta.brand, parts=Array.isArray(m) && m.length ? m : StOutfit.BRAND, txt=parts.map(p=>p[0]).join('');
    const own=/^пневмотех$/i.test(txt), rgb=RalColor.rgb(S.wall), lum=(0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2])/255;   // на тёмной стене — белыми буквами
    const d={ type:'brand', parts, tag:own ? 'ГРУППА КОМПАНИЙ' : '', globe:own, light:lum<0.5, ar:Math.max(2.6, Math.min(8, (own ? 0.5 : 0.7)*txt.length)) };
    const top=S.top-(S.g.sea ? 0.22 : 0.15), y1=this.p.fuel && !S.g.sea ? S.We-0.62 : S.We-0.12, w=Math.min(1.9, (y1-0.12)*0.92, 0.42*d.ar), h=w/d.ar;   // мимо жалюзи отсека бака
    S.sticker(d, [this.leftX(), (0.12+y1)/2, top-0.1-h/2], [-1, 0, 0], w, h);
    if (!S.closed) return;
    const gaps=[], cuts=S.openF.map(c=>[S.ox+c.x0/1000-0.3, S.ox+c.x1/1000+0.75]).sort((a, b)=>a[0]-b[0]); let x=0.35;
    for (const [a, b] of cuts){ if (a>x) gaps.push([x, a]); x=Math.max(x, b); }
    if (S.Le-0.35>x) gaps.push([x, S.Le-0.35]);
    const g=gaps.reduce((a, b)=>b[1]-b[0]>a[1]-a[0] ? b : a, [0, 0]), len=g[1]-g[0]; if (len<0.9) return;
    const w2=Math.min(len*0.85, 3.2, 0.6*d.ar), h2=w2/d.ar;
    S.sticker(d, [(g[0]+g[1])/2, this.frontY(), top-0.12-h2/2], [0, -1, 0], w2, h2);
  }
  static BRAND = [['ПНЕВМО', '#0B45A0'], ['ТЕХ', '#3DA0EE']];
}

if (typeof module!=='undefined') module.exports={ StWalls, StOutfit };
