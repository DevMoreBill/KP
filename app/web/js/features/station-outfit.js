// Оснащение контейнера на 3D-виде станции (StScene, station-render.js) — всё, что видно на картинке, кроме оборудования:
// свет (светодиодные светильники, аварийный с зелёным индикатором, светильники над дверями снаружи), отопление
// (электроконвекторы на местах из расчёта StationHeat), вентиляция (снаружи — жалюзи с козырьками, изнутри — решётки
// с клапанами и электроприводами, воздуховод от радиатора ДГУ), пожарная безопасность по расчёту StationFire
// (огнетушитель у выхода — по расчёту StationFire: верх не выше 1,5 м, над ними знак F04; извещатели и модули
// порошкового пожаротушения «Буран-2,5» на потолке; щит ОПС, ручной пожарный извещатель и оповещатель у выхода; табло
// «Выход» и «Порошок! Уходи!» над входной дверью), кабельный лоток, отсек топливного бака ДГУ (перегородка, поддон,
// заливная горловина снаружи в ящике, дыхательный клапан над крышей, жалюзи отсека), снаружи — козырьки и прожекторы над
// дверями, таблички категории помещения, знаки и табло у входа, логотип организации. Места на стенах — без наложений (StWalls).
// Сцена — без DOM: наклейки — описания, картинки рисует StDecal (station-decal.js) в браузере.
'use strict';

// ---------------------------------------------------------------- места на стенах помещения оборудования
// Стены: left — у начала помещения (торец или перегородка отсека / тамбура), right — дальний торец, back — задняя,
// front — со стороны прохода (зрителя). u — вдоль стены (left/right — y, back/front — x), z — от пола, мм.
class StWalls {
  static NEAR = 450;      // оборудование ближе к стене — место перед ним занято (до его высоты + 150 мм)
  constructor(plan){
    const [L, W, H]=plan.int, x0=plan.geo.x0||0, I=(plan.items||[]).filter(i=>!i.tank), N=StWalls.NEAR;
    this.L=L; this.W=W; this.x0=x0; this.B={ left:[], right:[], back:[], front:[] }; this.S={ left:[], right:[], back:[], front:[] };   // S — «мягкие» запреты (shade)
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
    for (const l of plan.lines||[]) if (W-l.y<500) for (const [a, b] of StationLayout.runs(l)) this.busy('back', a, b, l.z-100, l.z+100);
    if ((plan.sys||{}).power!==false) this.busy('back', x0, L, H-320, H);   // кабельный лоток под потолком
  }
  busy(w, u0, u1, z0, z1){ if (this.B[w]) this.B[w].push([u0, u1, z0, z1]); }
  /** для огнетушителей и щитов — «мягкие» запреты: стены за оборудованием (на любом расстоянии от стены — к месту не
   *  подойти, из прохода его не видно) и стена прохода там, где проход узкий (огнетушитель сузит путь эвакуации) */
  shade(plan){
    const [L, W]=plan.int, x0=plan.geo.x0||0, a=(plan.aisleRule||[1000, 800])[1]+250, S=(w, u0, u1, z1)=>this.S[w].push([u0, u1, 0, z1]);
    for (const i of plan.items||[]){ if (i.tank || i.mount==='pipe' || i.mount==='wall') continue; const top=(i.z||0)+i.h+150;
      if (i.y+i.ly>W/2) S('back', i.x-50, i.x+i.lx+50, top);
      if (i.y<a) S('front', i.x-50, i.x+i.lx+50, top);
      if (L-i.x-i.lx<1200) S('right', i.y-50, i.y+i.ly+50, top);
      if (i.x-x0<1200) S('left', i.y-50, i.y+i.ly+50, top); }
  }
  /** участок свободен; soft — с «мягкими» запретами */
  free(w, u0, u1, z0, z1, soft=true){ const ok=q=>!(q[0]<u1 && q[1]>u0 && q[2]<z1 && q[3]>z0); return (this.B[w]||[]).every(ok) && (!soft || (this.S[w]||[]).every(ok)); }
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
  static HIDE = 3000;     // место на стене, невидимое на 3D-виде, — как на 3 м дальше от цели (near)

  constructor(scene){ this.s=scene; this.p=scene.plan; this.sys=this.p.sys||{}; this.walls=new StWalls(this.p); this.inside=scene.view==='in'; this.log=[]; }   // log — что где поставлено (проверки)
  build(){ this.lights(); this.tray(); this.heaters(); this.vents(); this.fire(); this.sockets(); this.fuel(); this.doors(); this.brand(); return this; }

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
  /** наружная поверхность стены со стороны зрителя (y) и торца у двери (x): гофр и профлист выступают */
  frontY(){ const S=this.s; return S.g.sea ? -0.008 : S.g.type==='welded' ? 0.003 : 0.018; }
  leftX(){ const S=this.s; return S.g.sea ? -0.034 : this.p.door==='end' ? -0.023 : S.g.type==='welded' ? 0.003 : 0.018; }

  // ---- свет (расчёт — StationLight, plan.light): светильники в ряд по оси помещения, у аварийных (каждый второй, первый — у
  // выхода) — зелёный индикатор блока аварийного питания; в отсеке бака и тамбуре — круглый
  lights(){
    const S=this.s, P=this.p, [L, W, H]=P.int, x0=S.g.x0||0, Lt=P.light; if (!Lt || !Lt.on || !this.inside) return;
    const lamp=S.M(StMat.glow('#fffdf4', 5)), body=S.M(StMat.paint('#e9ecee', 0.4)), led=S.M(StMat.glow('#39d353', 3)), n=Lt.n, y=W/2, hl=StationLight.LAMP.len/2;
    for (let i=0; i<n; i++){ const x=x0+(L-x0)*(i+0.5)/n; body.box(...S.P(x-hl, y-90, H-60), ...S.P(x+hl, y+90, H), 0.01); lamp.box(...S.P(x-hl+30, y-70, H-62), ...S.P(x+hl-30, y+70, H-55));
      if (i%2===0 && i/2<Lt.em) led.box(...S.P(x+hl-80, y-104, H-48), ...S.P(x+hl-35, y-92, H-28)); }
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
  // вверху в дальнем торце ближе к задней стене, приток внизу у входа (в своём торце или в задней стене)
  vents(){
    const P=this.p, [, W, H]=P.int, x0=this.s.g.x0||0, dgu=P.items.find(i=>i.kind==='dgu' && !i.tank);
    const leftOut=x0===0 && P.door!=='end' && !this.s.g.sea;
    const intake=(wd, hh)=>{ if (leftOut) return this.vent('left', W*0.25, W*0.25+wd, 200, 200+hh, true);
      const u=this.walls.find('back', wd+260, 120, 260+hh, 'lo'); if (u!=null) this.vent('back', u+130, u+130+wd, 200, 200+hh, true); };
    if (dgu){ if (P.dguDoor) this.endDoor(P.dguDoor); else this.vent('right', dgu.y+80, dgu.y+dgu.ly-80, Math.round(dgu.h*0.12), Math.round(dgu.h*0.95));
      this.duct(dgu); intake(900, 750); return; }
    if (this.sys.vent===false) return;
    const rc=P.items.filter(i=>i.wall==='right'), y0=rc.length ? Math.max(W*0.45, Math.max(...rc.map(i=>i.y+i.ly))+150) : W*0.45, y1=Math.min(W-120, y0+W*0.4);
    if (y1-y0>=250) this.vent('right', Math.round(y0), Math.round(y1), H-750, H-200);
    intake(Math.round(W*0.3), 450);
  }
  /** проём вентиляции в стене помещения: снаружи — жалюзи с козырьком (приток при снегозащите — с откидным коробом),
   *  изнутри — решётка и клапан с электроприводом */
  vent(w, u0, u1, z0, z1, intake){
    const S=this.s, a=u0/1000, b=u1/1000, Z0=S.base+z0/1000, Z1=S.base+z1/1000;
    if (intake && this.sys.snow) this.snow(w, a, b, Z0, Z1);
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
  /** ДГУ: в торце напротив радиатора — двустворчатая дверь-жалюзи (выброс горячего воздуха и проём для монтажа и демонтажа
   *  ДГУ): коробка, створки с наклонными ламелями (внизу — глухая полоса), петли по краям, запорные штанги и ручка посередине,
   *  козырёк сверху; изнутри — клапан с электроприводом */
  endDoor(d){
    const S=this.s, a=d.y0/1000, b=d.y1/1000, Z0=S.base+0.01, Z1=S.base+d.h/1000, x=S.Le, m=(a+b)/2, Y=u=>S.oy+u;
    this.walls.busy('right', d.y0-60, d.y1+260, 0, d.h+120);
    const fr=S.M(StMat.paint(RalColor.shade(S.frame, 0.9), 0.45)), lf=S.M(StMat.paint(S.wall, 0.45)), sl=S.M(StMat.paint('#5d646b', 0.55)), dk=S.M(StMat.paint('#24292e', 0.55)), mt=S.M(StMat.metal('#c3c8cd', 0.3));
    fr.box(x, Y(a)-0.05, Z0-0.01, x+0.03, Y(a), Z1+0.05); fr.box(x, Y(b), Z0-0.01, x+0.03, Y(b)+0.05, Z1+0.05); fr.box(x, Y(a)-0.05, Z1, x+0.03, Y(b)+0.05, Z1+0.05);   // коробка
    for (const [u0, u1, hinge] of [[a, m-0.003, a], [m+0.003, b, b]]){
      lf.box(x, Y(u0), Z0, x+0.022, Y(u1), Z1-0.004, 0.004);                                                  // полотно-рама створки
      for (let z=Z0+0.24; z<Z1-0.1; z+=0.07) sl.obox([x+0.022, Y(u0)+0.06, z], [0, u1-u0-0.12, 0], [0.03, 0, -0.022], [0, 0, 0.012]);   // ламели
      for (const k of [0.15, 0.5, 0.85]){ const z=Z0+(Z1-Z0)*k, yh=Y(hinge)+(hinge===a ? 0.015 : -0.015); dk.tube([x+0.03, yh, z], [x+0.03, yh, z+0.12], 0.016, 10); } }   // петли
    for (const u of [m-0.07, m+0.06]) mt.tube([x+0.06, Y(u), Z0+0.08], [x+0.06, Y(u), Z1-0.08], 0.012, 10);   // запорные штанги
    dk.box(x+0.05, Y(m)+0.02, Z0+0.95, x+0.075, Y(m)+0.1, Z0+1.17, 0.005);                                     // ручка с замком
    this.hood('right', a-0.08, b+0.08, Z1+0.08); this.log.push({ kind:'dgudoor', u:(d.y0+d.y1)/2, w:d.w, h:d.h });
    if (!this.shown('right')) return;
    const zc=d.h/2; this.box(dk, 'right', d.y1+150, zc, 110, 150, 90, 0.008); this.box(fr, 'right', d.y1+70, zc, 50, 20, 40, 0);   // электропривод клапана
  }
  /** козырёк над жалюзи снаружи (от дождя и снега) */
  hood(w, a, b, zt){
    const S=this.s, m=S.M(StMat.paint(RalColor.shade(S.wall, 0.9), 0.45)), t=[0, 0, 0.006];
    if (w==='right') m.obox([S.Le, S.oy+a, zt], [0, b-a, 0], [0.14, 0, -0.07], t);
    else if (w==='left') m.obox([0, S.oy+a, zt], [0, b-a, 0], [-0.14, 0, -0.07], t);
    else if (w==='back') m.obox([S.ox+a, S.We, zt], [b-a, 0, 0], [0, 0.14, -0.07], t);
    else if (!S.cut) m.obox([S.ox+a, 0, zt], [b-a, 0, 0], [0, -0.14, -0.07], t);
  }
  /** снегозащитный короб перед приточными жалюзи: крышка и боковины, снизу открыт, откидывается на петлях вверху (для
   *  обслуживания) — от снега и дождя */
  snow(w, a, b, Z0, Z1){
    const S=this.s, m=S.M(StMat.paint(RalColor.shade(S.wall, 0.86), 0.45)), dk=S.M(StMat.paint('#24292e', 0.5)), d=0.34, t=0.006, zt=Z1+0.1, zb=Z0-0.12;
    const at=(u, o, z)=>w==='right' ? [S.Le+o, S.oy+u, z] : w==='left' ? [-o, S.oy+u, z] : w==='back' ? [S.ox+u, S.We+o, z] : [S.ox+u, -o, z];
    const box=(u0, u1, o0, o1, z0, z1)=>{ const p=at(u0, o0, z0), q=at(u1, o1, z1); m.box(Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.min(p[2], q[2]), Math.max(p[0], q[0]), Math.max(p[1], q[1]), Math.max(p[2], q[2]), 0.003); };
    box(a-0.08, b+0.08, 0.01, d, zt, zt+t);                              // крышка
    box(a-0.08, b+0.08, d-t, d, zb+0.18, zt);                            // лицевой лист (снизу — открыт)
    for (const u of [a-0.08, b+0.08-t]) box(u, u+t, 0.01, d, zb, zt);    // боковины
    for (const u of [a, b-0.06]){ const p=at(u, 0.02, zt+0.01), q=at(u+0.06, 0.02, zt+0.01); dk.tube(p, q, 0.012, 8); }   // петли
  }
  /** воздуховод от радиатора ДГУ к жалюзи — гибкая вставка из ткани с рамками */
  duct(it){
    const S=this.s, [L]=this.p.int, x1=it.x+it.lx; if (!this.inside || L-x1<30) return;
    S.M(StMat.paint('#3b4046', 0.85)).box(...S.P(x1, it.y+60, it.h*0.1), ...S.P(L, it.y+it.ly-60, it.h*0.96), 0.02);
    const f=S.M(StMat.metal('#8f969d', 0.45)); for (const x of [x1, L-40]) f.box(...S.P(x, it.y+50, it.h*0.09), ...S.P(x+40, it.y+it.ly-50, it.h*0.97), 0.006);
  }

  // ---- пожарная безопасность (расчёт — StationFire, plan.fire): извещатели и модули «Буран-2,5» — на потолке; над входной
  // дверью — табло «Выход» (при пожаротушении рядом — «Порошок! Уходи!»), двустороннее: в разрезе читается и со стороны
  // зрителя; щит ОПС, ручной извещатель, оповещатель и огнетушитель — у выхода, второй огнетушитель — у основного
  // оборудования: на свободных местах стен не за оборудованием и не в узком проходе, видимые на 3D-виде — в первую очередь
  fire(){
    const S=this.s, P=this.p, [, W, H]=P.int, F=P.fire; if (!this.inside || !F) return;
    const red=S.M(StMat.paint(StOutfit.RED, 0.4)), wh=S.M(StMat.paint('#f2f3f4', 0.35)), main=F.rooms[0], ex=F.exit;
    this.walls.shade(P);
    if (F.ops){ const n=Math.max(2, Math.ceil((main.x1-main.x0)/3500)), led=S.M(StMat.glow('#ff3b30', 2));   // извещатели: не меньше двух, через 3,5 м
      for (let i=0; i<n; i++){ const c=S.P(main.x0+(main.x1-main.x0)*(i+0.5)/n, W*0.28, H); wh.tube(c, StV.add(c, [0, 0, -0.045]), 0.05, 18); wh.tube(StV.add(c, [0, 0, -0.045]), StV.add(c, [0, 0, -0.06]), 0.032, 14); led.sphere(StV.add(c, [0.036, 0, -0.04]), 0.006, 6); } }
    for (const q of F.rooms) for (const m of q.mods) this.buran(S.P(m.x, m.y, H));
    // табло над выходом: низ — не ниже верха проёма
    if (ex){ const z=Math.max(ex.top+90, H-125), two=F.auto && ex.w>=800, du=two ? 200 : 0;
      if (z+75<H-20){ this.hang('EXIT', ex.wall, ex.u-du, z, 360, 130); if (two) this.hang('POW_OUT', ex.wall, ex.u+du, z, 360, 130); } }
    const d0=(P.doors||[]).find(d=>d.wall!=='back'), door=ex ? (ex.wall==='front' ? [ex.u, 0] : [P.geo.x0||0, ex.u]) : d0 ? [(d0.x0+d0.x1)/2, 0] : [P.geo.x0||0, W/2], ws=['back', 'right', 'left', 'front'];
    // огнетушители — у основного оборудования (ДГУ, самый мощный компрессор; видное место — в первую очередь) и у выхода, щит
    // ОПС — у входа или на видном месте: верх огнетушителя — не выше 1,5 м, знак F04 — над ним, нет места — сбоку; ниже — если
    // на обычной высоте места нет
    const I=P.items.filter(i=>!i.tank && (i.mount==='floor' || i.mount==='frame')), big=I.find(i=>i.kind==='dgu') || I.filter(i=>i.kind==='compressor').sort((a, b)=>(b.kw||0)-(a.kw||0))[0] || I[0];
    const E=StOutfit.EXT, EB=[[260, E-550, E+340], [500, E-550, E+30, 150], [260, E-1050, E-160, 400], [500, E-1050, E-470, 550]];
    const e2=main.ext>1 ? this.near(ws, EB, big ? [big.x+big.lx/2, big.y+big.ly/2>W/2 ? big.y : big.y+big.ly] : [P.int[0], W/2]) : null;
    if (F.ops){ const o=this.near(ws, [[340, 1030, 1470], [340, 930, 1370, 200]], door, 4500); if (o) this.panel(o.w, o.u, o.z0+220); }
    const e1=this.near(ws, EB, door, 1500);
    for (const e of [e1, e2]) if (e && (e.w!=='front' || !S.cut)){ const side=e.wd>260, u=side ? e.u-120 : e.u;
      this.extinguisher(this.at(e.w, u, e.z0+50), StOutfit.N[e.w]); this.sign({ type:'sign', id:'F04' }, e.w, side ? u+250 : u, side ? e.z0+430 : e.z0+770, 200, 200); }
    // ручной пожарный извещатель (1,5 м) и оповещатель (под потолком) — у выхода
    if (F.ops){ const m=this.near(ws, [[160, 1380, 1620]], door, 0); if (m){ this.log.push({ kind:'mcp', wall:m.w, u:m.u }); this.box(red, m.w, m.u, 1500, 95, 95, 45, 0.006); this.box(wh, m.w, m.u, 1508, 52, 44, 48, 0.003); }
      const zs=Math.min(2100, H-190), s=this.near(ws, [[170, zs-150, zs+150]], door, 0); if (s){ this.log.push({ kind:'sounder', wall:s.w, u:s.u }); this.box(red, s.w, s.u, zs, 120, 140, 55, 0.012); this.box(wh, s.w, s.u, zs+35, 76, 36, 58, 0.008); } }
  }
  /** точка стены видна на 3D-виде: луч к камере не упирается в торец (перегородку) помещения, оборудование и потолок у
   *  среза; стена со стороны зрителя изнутри не видна; при сервисных дверях (стена стоит) — только через проёмы */
  seen(w, u, z){
    if (w==='front' || !this.inside) return false;
    const S=this.s, p=this.at(w, u, z, 70), az=StCam.AZ*Math.PI/180, el=StCam.EL*Math.PI/180, d=[-Math.cos(el)*Math.sin(az), -Math.cos(el)*Math.cos(az), Math.sin(el)];
    const t0=(0-p[1])/d[1], q=StV.add(p, StV.mul(d, t0)), xl=S.ox+(S.g.x0||0)/1000, tl=(xl-p[0])/d[0];
    if (tl>0 && tl<t0) return false;                           // торец или перегородка помещения
    if (q[2]>S.ceil-0.01) return false;                        // за потолком у среза
    if (!S.cut && !S.openF.some(c=>q[0]>S.ox+c.x0/1000+0.03 && q[0]<S.ox+c.x1/1000-0.03 && q[2]<S.base+c.h/1000-0.03)) return false;
    for (const it of this.p.items){ if (it.mount==='pipe' || it.tank) continue; const b=S.B(it); let t1=1e-4, t2=t0, hit=true;
      for (let k=0; k<3 && hit; k++){ if (Math.abs(d[k])<1e-9){ if (p[k]<b[k] || p[k]>b[k+3]) hit=false; continue; }
        let a1=(b[k]-p[k])/d[k], a2=(b[k+3]-p[k])/d[k]; if (a1>a2) [a1, a2]=[a2, a1]; t1=Math.max(t1, a1); t2=Math.min(t2, a2); if (t1>t2) hit=false; }
      if (hit) return false; }
    return true;
  }
  /** место у точки t = [x, y] плана на стенах ws: свободный участок одной из полос bands ([ширина, z0, z1, штраф], мм),
   *  ближайший к ней; видимое на 3D-виде — в первую очередь (невидимое — как на hide мм дальше); место занимается:
   *  {w — стена, u — середина, wd, z0, z1} или null */
  near(ws, bands, t, hide=StOutfit.HIDE){
    const [L, W]=this.p.int, x0=this.s.g.x0||0; let best=null;
    for (const soft of [true, false]){ if (best) break;     // места нет — без «мягких» запретов (тесный контейнер)
    for (const [wd, z0, z1, pen=0] of bands) for (const w of ws){ const [lo, hi]=this.walls.range(w), zv=z0+Math.min(z1-z0, 900)*0.35;
      for (let u=lo+120; u+wd<=hi-120; u+=50){ if (!this.walls.free(w, u, u+wd, z0, z1, soft)) continue;
        const c=u+wd/2, x=w==='left' ? x0 : w==='right' ? L : c, y=w==='back' ? W : w==='front' ? 0 : c;
        const sc=Math.hypot(x-t[0], y-t[1])+pen+(this.seen(w, c, zv) ? 0 : hide); if (!best || sc<best.sc) best={ w, u:c, wd, z0, z1, sc }; } } }
    if (best) this.walls.busy(best.w, best.u-best.wd/2, best.u+best.wd/2, best.z0, best.z1);
    return best;
  }
  /** модуль «Буран-2,5» на потолке (c — точка потолка): кронштейн, красный корпус Ø 250 мм с этикеткой, распылитель снизу,
   *  тепловой замок посередине */
  buran(c){
    const S=this.s, red=S.M(StMat.paint('#c62d22', 0.35)), dk=S.M(StMat.paint('#2a2e33', 0.5)), gr=S.M(StMat.paint('#d3d6d9', 0.45)), lb=S.M(StMat.paint('#f1efe8', 0.6));
    const r=0.125, z1=c[2]-0.035, z0=z1-0.11, [x, y]=c; this.log.push({ kind:'buran', at:c });
    dk.box(x-0.1, y-0.022, c[2]-0.008, x+0.1, y+0.022, c[2]); dk.tube([x, y, c[2]-0.008], [x, y, z1], 0.018, 10);   // кронштейн
    red.tube([x, y, z0], [x, y, z1], r, 32); lb.tube([x, y, z0+0.03], [x, y, z0+0.075], r*1.006, 32, [false, false]);
    gr.tube([x, y, z0-0.014], [x, y, z0], r*0.9, 32, [true, false]); dk.tube([x, y, z0-0.04], [x, y, z0-0.014], 0.022, 14, [true, false]);
  }
  /** щит ОПС на стене (середина u, zc — середина по высоте): корпус, дисплей, индикаторы «Пожар», «Неисправность», «Питание»,
   *  табличка */
  panel(w, u, zc){
    const S=this.s; this.log.push({ kind:'ops', wall:w, u, seen:this.seen(w, u, zc) }); this.box(S.M(StMat.paint('#e2e5e8', 0.4)), w, u, zc, 300, 400, 120, 0.012);
    this.box(S.M(StMat.paint('#1d2226', 0.35)), w, u, zc+105, 200, 80, 123, 0.004);
    S.M(StMat.glow('#9fe6b3', 1.2)).box(...this.at(w, u-85, zc+75, 124), ...this.at(w, u+85, zc+135, 125));   // экран
    for (const [k, c] of [[-1, '#ff3b30'], [0, '#ffc21a'], [1, '#39d353']]) this.box(S.M(StMat.glow(c, 2.4)), w, u+k*45, zc+30, 22, 22, 128, 0.004);
    this.sign({ type:'sign', id:'OPS' }, w, u, zc-90, 220, 82, 121);
  }
  /** табло под потолком у стены w над проёмом: корпус, надпись с обеих сторон (в разрезе стена срезана — видна и снаружи),
   *  подвес к потолку */
  hang(id, w, u, z, sw, sh){
    const S=this.s, [, , H]=this.p.int, b=S.M(StMat.paint('#eceeef', 0.4)), dk=S.M(StMat.paint('#2a2e33', 0.5)), o0=20, o1=60, n=StOutfit.N[w], m=StV.mul(n, -1);
    const a=this.at(w, u-sw/2-15, z-sh/2-15, o0), c=this.at(w, u+sw/2+15, z+sh/2+15, o1); this.log.push({ kind:'board', id, wall:w, u, z0:z-sh/2-15 });
    b.box(Math.min(a[0], c[0]), Math.min(a[1], c[1]), a[2], Math.max(a[0], c[0]), Math.max(a[1], c[1]), c[2], 0.006);
    for (const k of [-1, 1]){ const p=this.at(w, u+k*(sw/2-30), z+sh/2+15, (o0+o1)/2); dk.tube(p, [p[0], p[1], S.base+H/1000], 0.005, 6); }
    S.sticker({ type:'sign', id }, this.at(w, u, z, o1), n, sw/1000, sh/1000, 1.4);
    S.sticker({ type:'sign', id }, this.at(w, u, z, o0), m, sw/1000, sh/1000, 1.4);
  }
  // ---- сервисные розетки (StationSockets, plan.sockets) на высоте 1,0 м: 230 В — у входа и вдоль помещения у оборудования,
  // 380 В (красная) — у основного оборудования, ЯТП-0,25 (36 В) — у входа; видимые места — в первую очередь
  sockets(){
    const S=this.s, P=this.p, K=P.sockets, [L, W]=P.int, x0=S.g.x0||0, F=P.fire||{}, ex=F.exit; if (!K || !this.inside) return;
    const ws=['back', 'right', 'left', 'front'], door=ex ? (ex.wall==='front' ? [ex.u, 0] : [x0, ex.u]) : [x0, W/2], z=K.z;
    const I=P.items.filter(i=>!i.tank && (i.mount==='floor' || i.mount==='frame')), big=I.find(i=>i.kind==='dgu') || I.filter(i=>i.kind==='compressor').sort((a, b)=>(b.kw||0)-(a.kw||0))[0] || I[0];
    const gr=S.M(StMat.paint('#d9dcdf', 0.45)), lid=S.M(StMat.paint('#c3c7cb', 0.4)), red=S.M(StMat.paint('#c8352c', 0.4)), dk=S.M(StMat.paint('#2a2e33', 0.5)), yl=S.M(StMat.paint('#f2c230', 0.45));
    const put=(w, u, kind)=>{ if (w==='front' && S.cut) return; this.log.push({ kind:'socket', type:kind, wall:w, u });
      if (kind==='230'){ this.box(gr, w, u, z, 85, 85, 45, 0.008); this.box(lid, w, u, z+4, 66, 62, 52, 0.006); return; }
      if (kind==='380'){ const zc=z-40; this.box(red, w, u, zc, 110, 140, 70, 0.01); const a=this.at(w, u, zc-30, 70), b=this.at(w, u, zc-85, 115); red.tube(a, b, 0.032, 16); dk.tube(b, StV.add(b, StV.mul(StV.norm(StV.sub(b, a)), 0.01)), 0.026, 14); return; }
      this.box(gr, w, u, z+40, 230, 330, 190, 0.01); this.box(yl, w, u+60, z-60, 60, 60, 196, 0.006); this.sign({ type:'sign', id:'W08' }, w, u-40, z+120, 70, 61, 191); };
    const t=this.near(ws, [[260, z-140, z+220]], door, 1500); if (t) put(t.w, t.u, 'ytp');
    const a=this.near(ws, [[140, z-50, z+50]], door, 1500); if (a) put(a.w, a.u, '230');
    for (let k=1; k<K.n230; k++){ const q=this.near(ws, [[140, z-50, z+50]], [x0+(L-x0)*(k+0.5)/K.n230, W]); if (q) put(q.w, q.u, '230'); }
    const r=this.near(ws, [[160, z-115, z+35]], big ? [big.x+big.lx/2, big.y+big.ly/2>W/2 ? big.y : big.y+big.ly] : [L, W/2]); if (r) put(r.w, r.u, '380');
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

  // ---- отсек топливного бака ДГУ: перегородка (в разрезе — утеплитель), поддон, заливная труба к горловине снаружи,
  // насос перекачки топлива в бак ДГУ, дыхательный клапан с огнепреградителем над крышей, огнетушитель, жалюзи отсека; дверь —
  // в стене прохода (StScene.shut)
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
      if (t) this.transfer(t, f, st, dk);
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

  /** насос перекачки топлива из дополнительного бака в бак ДГУ: на раме у бака перед перегородкой, всасывание — из нижнего
   *  патрубка бака с краном, нагнетание — вверх к топливопроводу у задней стены */
  transfer(t, f, st, dk){
    const S=this.s, [, W]=this.p.int, x=Math.min(f.x1-130, t.x+t.lx+170), y0=Math.max(220, t.y-330), y1=y0+240, zc=170, red=S.M(StMat.paint('#c83a2e', 0.4)), mo=S.M(StMat.paint('#4f5d6b', 0.45));
    if (x-100<t.x+t.lx+40) return;
    this.log.push({ kind:'fuelpump', x, y:y0 });
    dk.box(...S.P(x-100, y0, 0), ...S.P(x+100, y1, 60), 0.006);                                      // рама
    mo.tube(S.P(x, y0+20, zc), S.P(x, y0+170, zc), 0.07, 20); dk.tube(S.P(x, y0+15, zc), S.P(x, y0+22, zc), 0.072, 20);   // двигатель
    red.tube(S.P(x, y0+170, zc), S.P(x, y1-10, zc), 0.06, 20); dk.box(...S.P(x-60, y0+40, 60), ...S.P(x+60, y0+150, zc-60));   // насос, опора
    const ty=t.y-1, a=S.P(t.x+t.lx-120, ty, 120), b=S.P(t.x+t.lx-120, y1+60, 120), c=S.P(x, y1+60, 120), d=S.P(x, y1-10, zc);   // всасывание из бака
    st.tube(a, b, 0.016, 10); st.sphere(b, 0.017, 8); st.tube(b, c, 0.016, 10); st.sphere(c, 0.017, 8); st.tube(c, d, 0.016, 10);
    st.sphere(b, 0.026, 10); red.box(b[0]-0.01, b[1]-0.01, b[2]+0.03, b[0]+0.09, b[1]+0.01, b[2]+0.045, 0.003);   // кран
    const l=(this.p.lines||[]).find(q=>q.medium==='fuel'), zl=l ? l.z : 1150, yl=l ? l.y : W-50, u=S.P(x, (y0+y1)/2, zc+70), v=S.P(x, (y0+y1)/2, zl), w=S.P(x, yl, zl);   // нагнетание
    st.tube(u, v, 0.016, 10); st.sphere(v, 0.017, 8); st.tube(v, w, 0.016, 10); st.sphere(w, 0.022, 8);
  }

  // ---- двери снаружи: над каждой — съёмный козырёк (водостоков нет), под ним — светодиодный прожектор. На входной двери —
  // табличка категории помещения (кроме категории Д; ППР в РФ, п. 12), знаки W08 «Опасность поражения электрическим током»
  // и P06 «Доступ посторонним запрещён», при пожаротушении справа от входа — табло «Порошок! Не входи!» и «Автоматика
  // отключена»; на двери отсека бака — табличка категории, W01 «Пожароопасно» и P02 «Запрещается открытый огонь»; ворота
  // и двери в торце — так же
  doors(){
    const S=this.s, P=this.p, F=P.fire||{}, R=F.rooms||[], main=R[0], tank=R.find(q=>q.id==='tank'), cat=q=>q && q.cat && q.cat!=='Д' ? { type:'sign', id:'CAT', cat:q.cat, zone:q.zone||'' } : null;
    if (P.door==='end'){ const x=this.leftX(), zs=S.base+1.62;
      if (!S.g.sea){ const zg=S.dz+0.16+Math.min(2.2, S.He-0.4), w=Math.min(1.8, S.We-0.4); this.canopy([x, S.We/2, zg], [-1, 0, 0], w+0.2); if (this.room(zg)) this.flood([x, S.We/2, zg+0.17], [-1, 0, 0]); }
      const n=[-1, 0, 0], c=cat(main), y0=S.We/2;
      if (c) S.sticker(c, [x-0.004, y0+0.3, zs+0.06], n, 0.3, 0.2);
      S.sticker({ type:'sign', id:'W08' }, [x-0.004, y0-0.3, zs+0.06], n, 0.2, 0.175); S.sticker({ type:'sign', id:'P06' }, [x-0.004, y0-0.3, zs-0.19], n, 0.2, 0.2); }
    if (!S.closed) return;
    const y=-0.052, n=[0, -1, 0], fy=this.frontY(), entry=P.door!=='service'; let first=true;
    for (const c of S.openF){ const a=S.ox+c.x0/1000, b=S.ox+c.x1/1000, xm=(a+b)/2, zt=S.base+c.h/1000, zs=S.base+1.38;
      const xp=c.kind!=='service' ? xm : (c.leaves||1)>1 ? a+(b-a)*0.75 : xm-0.08;   // у сервисной двери — мимо запорных штанг
      this.canopy([xm, fy, zt], n, b-a+0.24);
      if (c.kind!=='service' && this.room(zt)) this.flood([xm, fy, zt+0.17], n);
      const sign=c.kind==='entry' || (c.kind==='service' && !entry && first);   // таблички — на входной двери; входа нет — на первой сервисной
      const pl=c.kind==='tank' ? cat(tank) : sign ? cat(main) : null;
      if (pl) S.sticker(pl, [xp, y, S.base+1.72], n, 0.3, 0.2);
      if (sign){ S.sticker({ type:'sign', id:'W08' }, [xp-0.12, y, zs], n, 0.2, 0.175); S.sticker({ type:'sign', id:'P06' }, [xp+0.12, y, zs], n, 0.2, 0.2);
        if (F.auto && zt+0.2<S.top-0.04){ const hb=S.M(StMat.paint('#eceeef', 0.4));
          for (const [id, z] of [['POW_NO', zt+0.06], ['AUTO_OFF', zt-0.14]]){ hb.box(b+0.14, fy-0.04, z-0.08, b+0.53, fy, z+0.08, 0.006); S.sticker({ type:'sign', id }, [b+0.335, fy-0.04, z], n, 0.36, 0.13, 0.8); } } }
      if (c.kind==='tank'){ S.sticker({ type:'sign', id:'W01' }, [xm-0.12, y, zs], n, 0.2, 0.175); S.sticker({ type:'sign', id:'P02' }, [xm+0.12, y, zs], n, 0.2, 0.2); }
      if (c.kind!=='tank') first=false; }
  }
  /** над дверью хватает места для прожектора под козырьком */
  room(zt){ return zt+0.34<this.s.top-0.04; }
  /** съёмный козырёк над дверью: лист с уклоном наружу и бортом, два кронштейна; c — середина над проёмом (верх двери), n — наружу */
  canopy(c, n, w){
    const S=this.s, r=StV.norm(StV.cross(StV.mul(n, -1), [0, 0, 1])), z=Math.min(S.top-0.07, c[2]+0.42), d=0.32, m=S.M(StMat.paint(RalColor.shade(S.wall, 0.9), 0.45)), br=S.M(StMat.paint(RalColor.shade(S.frame, 0.85), 0.5));
    const o=StV.sub([c[0], c[1], z], StV.mul(r, w/2)), v=StV.add(StV.mul(n, d), [0, 0, -0.06]);
    m.obox(o, StV.mul(r, w), v, [0, 0, 0.008]); m.obox(StV.add(o, v), StV.mul(r, w), StV.mul(n, 0.008), [0, 0, -0.05]);   // лист и борт
    for (const k of [0.06, w-0.06]){ const p=StV.add(o, StV.mul(r, k)); br.tube(StV.add(p, [0, 0, -0.2]), StV.add(StV.add(p, StV.mul(n, d*0.85)), [0, 0, -0.05]), 0.01, 8); }
  }
  /** светодиодный прожектор над дверью: корпус с рёбрами на скобе, наклонён вниз на 30°, светящееся стекло; c — точка на стене */
  flood(c, n){
    const S=this.s, r=StV.norm(StV.cross(StV.mul(n, -1), [0, 0, 1])), t=30*Math.PI/180, f=StV.norm(StV.add(StV.mul(n, Math.cos(t)), [0, 0, -Math.sin(t)])), up=StV.cross(f, r);
    const body=S.M(StMat.paint('#2d3237', 0.45)), W=0.2, H=0.15, D=0.05, o=StV.add(c, StV.mul(n, 0.08)), C=StV.sub(StV.sub(StV.sub(o, StV.mul(r, W/2)), StV.mul(up, H/2)), StV.mul(f, D/2));
    body.obox(C, StV.mul(r, W), StV.mul(up, H), StV.mul(f, D));
    S.M(StMat.glow('#fff6dc', 3.4)).obox(StV.add(C, StV.add(StV.add(StV.mul(r, 0.016), StV.mul(up, 0.016)), StV.mul(f, D))), StV.mul(r, W-0.032), StV.mul(up, H-0.032), StV.mul(f, 0.004));
    for (let k=1; k<6; k++) body.obox(StV.add(C, StV.add(StV.mul(r, W*k/6-0.003), StV.mul(f, -0.018))), StV.mul(r, 0.006), StV.mul(up, H), StV.mul(f, 0.018));   // рёбра охлаждения
    for (const k of [-1, 1]) body.box(...[0, 1, 2].map(i=>Math.min(c[i]+r[i]*k*(W/2+0.008), c[i]+r[i]*k*(W/2+0.008)+n[i]*0.09)-(i===2 ? 0.015 : 0)), ...[0, 1, 2].map(i=>Math.max(c[i]+r[i]*k*(W/2+0.008), c[i]+r[i]*k*(W/2+0.008)+n[i]*0.09)+(i===2 ? 0.015 : 0.004)));   // скоба
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
