// Оснащение контейнера на 3D-виде станции (StScene, station-render.js) — всё, что видно на картинке, кроме оборудования:
// свет (светодиодные светильники, аварийный с зелёным индикатором, светильники над дверями снаружи), отопление
// (электроконвекторы на местах из расчёта StationHeat), вентиляция (снаружи — жалюзи с козырьками, изнутри — решётки
// с клапанами и электроприводами, воздуховод от радиатора ДГУ), пожарная безопасность по расчёту StationFire
// (огнетушитель у выхода — по расчёту StationFire: верх не выше 1,5 м, над ними знак F04; извещатели и модули
// порошкового пожаротушения «Буран-2,5» на потолке; щит ОПС, ручной пожарный извещатель и оповещатель у выхода; табло
// «Выход» и «Порошок! Уходи!» над входной дверью), кабельный лоток, отсек топливного бака ДГУ (перегородка, поддон,
// заливная горловина снаружи в ящике, дыхательный клапан над крышей, жалюзи отсека), снаружи — козырьки и прожекторы над
// дверями, таблички категории помещения, знаки и табло у входа, логотип организации, маркировка для подъёма (знаки № 9
// «Место строповки» и № 12 «Центр тяжести» по ГОСТ 14192-96, надпись «Масса брутто»). Места на стенах — без наложений
// (StWalls — внутри, station-systems.js; StOutfit.O — снаружи). Жалюзи — по расчёту StationVent (plan.vent): размеры и места.
// Сцена — без DOM: наклейки — описания, картинки рисует StDecal (station-decal.js) в браузере.
'use strict';

// ---------------------------------------------------------------- оснащение
class StOutfit {
  static N = { left:[1, 0, 0], right:[-1, 0, 0], back:[0, -1, 0], front:[0, 1, 0] };   // нормаль стены — внутрь
  static get EXT(){ return StationMatrix.grp('fire').ext; }   // огнетушитель: верх — не выше 1,5 м от пола (Правила противопожарного режима в РФ); раздел fire матрицы
  static RED = '#c42a20';
  static HIDE = 3000;     // место на стене, невидимое на 3D-виде, — как на 3 м дальше от цели (near)

  constructor(scene){ this.s=scene; this.p=scene.plan; this.sys=this.p.sys||{}; this.walls=new StWalls(this.p); this.inside=scene.view==='in'; this.log=[];   // log — что где поставлено (проверки)
    this.O={ left:[], right:[], back:[], front:[] }; }   // снаружи на стенах занято: [u0, u1, z0, z1] — как у StWalls, мм
  build(){ this.lights(); this.tray(); this.heaters(); this.vents(); this.exhausts(); this.fire(); this.sockets(); this.fuel(); this.doors(); this.arts(); this.lift(); this.brand(); return this; }
  /** снаружи на стене w занят участок u0…u1, z0…z1 (мм: вдоль стены помещения и от пола — как у StWalls) */
  outer(w, u0, u1, z0, z1){ this.O[w].push([u0, u1, z0, z1]); }
  /** снаружи на стене участок свободен */
  outFree(w, u0, u1, z0, z1){ return this.O[w].every(q=>!(q[0]<u1 && q[1]>u0 && q[2]<z1 && q[3]>z0)); }

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
  leftX(){ const S=this.s, G=[this.p.gates, this.p.gates2].some(q=>q && q.wall==='left') || !!(this.p.fuel && this.p.fuel.gate); return S.g.sea ? -0.034 : this.p.door==='end' || G ? -0.028 : S.g.type==='welded' ? 0.003 : 0.018; }

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

  // ---- вентиляция (размеры и места — расчёт StationVent, plan.vent): приток внизу, вытяжка вверху, у ДГУ — дверь-жалюзи
  // или жалюзи напротив радиатора и воздуховод к ним; у каждой группы жалюзи на стене — подпись размера на картинке
  vents(){
    const P=this.p, V=P.vent, dgu=P.items.filter(i=>i.kind==='dgu' && !i.tank && i.mount==='floor'); if (!V) return;
    for (const L of V.louvers){ if (L.kind==='rad' && L.door){ const d=(P.dguDoors||[]).find(q=>q.pos===L.pos && q.unit===L.unit) || P.dguDoor; if (d) this.endDoor(d); } else if (L.leaf) this.leafVent(L); else { this.vent(L.wall, L.u0, L.u1, L.z0, L.z1, L.kind==='in', L.hood); if (L.fan) this.fan(L); } }
    for (const R of V.roof||[]) this.roofHood(R);
    for (const g of dgu) this.duct(g);
    // подписей (сносок) на 3D-виде нет — размеры жалюзи на чертеже и в тексте (решение ПНЕВМОТЕХ)
  }
  /** вентилятор в проёме (вытяжной — система «Вытяжные вентиляторы», приточный — если жалюзи притока не встали): изнутри —
   *  монтажная плита с осевыми вентиляторами (обечайка, ступица с двигателем) и датчик температуры рядом; снаружи — те же
   *  жалюзи (гравитационные) с козырьком. Число вентиляторов в проёме — по его форме (ширина / высота) */
  fan(L){
    if (!this.shown(L.wall)) return;
    const S=this.s, w=L.wall, n=Math.max(1, Math.round((L.u1-L.u0)/(L.z1-L.z0))), du=(L.u1-L.u0)/n, zc=(L.z0+L.z1)/2, r=Math.min(du, L.z1-L.z0)*0.42;
    const pl=S.M(StMat.paint('#b9bfc5', 0.45)), ring=S.M(StMat.metal(StScene.GALV, 0.35)), dk=S.M(StMat.paint('#2a2f34', 0.55));
    this.box(pl, w, (L.u0+L.u1)/2, zc, L.u1-L.u0+40, L.z1-L.z0+40, 30);   // монтажная плита
    for (let i=0; i<n; i++){ const u=L.u0+du*(i+0.5);
      ring.tube(this.at(w, u, zc, 30), this.at(w, u, zc, 190), r/1000, 28, [false, false]);   // обечайка
      dk.tube(this.at(w, u, zc, 60), this.at(w, u, zc, 230), r*0.28/1000, 18);                // ступица с двигателем
      for (let k=0; k<3; k++){ const a=k*Math.PI*2/3, e=[Math.cos(a)*r*0.8, Math.sin(a)*r*0.8];   // кронштейны двигателя
        dk.tube(this.at(w, u, zc, 200), this.at(w, u+e[0], zc+e[1], 200), 0.008, 6); } }
    this.box(dk, w, L.u1+120, zc-(L.z1-L.z0)/2+60, 70, 90, 35, 0.006);   // датчик температуры (термостат)
  }
  /** приток в створке ворот или сервисной двери: жалюзи на полотне (снаружи), изнутри — решётка */
  leafVent(L){
    const S=this.s, a=L.u0/1000, b=L.u1/1000, Z0=S.base+L.z0/1000, Z1=S.base+L.z1/1000, G=this.p.gates;
    const end=L.wall==='left' || L.wall==='right', off=end ? (G && G.sea ? 0.03 : 0.03) : 0.052;   // поверх полотна
    this.outer(L.wall, L.u0-60, L.u1+60, L.z0-60, L.z1+60);
    if (L.wall==='right') S.louver(1, S.Le+off, S.oy+a, S.oy+b, Z0, Z1, 1);
    else if (L.wall==='left') S.louver(1, -off, S.oy+a, S.oy+b, Z0, Z1, -1);
    else if (L.wall==='back') S.louver(0, S.We+off, S.ox+a, S.ox+b, Z0, Z1, 1);
    else if (!S.cut) S.louver(0, -off, S.ox+a, S.ox+b, Z0, Z1, -1);
    if (L.hood) this.snow(L.wall, a, b, Z1, L.hood, off);   // маркиза на полотне — открывается вместе с ним
  }
  /** выброс через крышу: колпак над проёмом (оцинковка) — жалюзи по сторонам, крышка с выносом; внутри под проёмом —
   *  клапан (у компрессора — его воздуховод доходит до потолка) */
  roofHood(R){
    const S=this.s, g=S.M(StMat.metal(StScene.GALV, 0.38)), sl=S.M(StMat.paint('#5d646b', 0.55)), c=S.P(R.x0, R.y0, 0), d=S.P(R.x1, R.y1, 0);
    const zr=Math.max(S.roofZ(c[1]), S.roofZ(d[1]))+(S.rise>0 ? 0.04 : 0), h=0.36, x0=c[0], y0=c[1], x1=d[0], y1=d[1];
    g.box(x0-0.03, y0-0.03, Math.min(S.roofZ(c[1]), S.roofZ(d[1])), x1+0.03, y1+0.03, zr+0.06, 0.004);   // стакан
    for (const [a, b] of [[0.02, 0.04], [h-0.04, h-0.02]]) g.box(x0, y0, zr+a, x1, y1, zr+b);
    for (const k of [0, 1, 2, 3]) g.box(k%2 ? x1-0.03 : x0, k<2 ? y0 : y1-0.03, zr+0.04, k%2 ? x1 : x0+0.03, k<2 ? y0+0.03 : y1, zr+h-0.04);   // стойки по углам
    for (let z=zr+0.08; z<zr+h-0.05; z+=0.055){ sl.box(x0+0.03, y0-0.005, z, x1-0.03, y0+0.005, z+0.02); sl.box(x0+0.03, y1-0.005, z, x1-0.03, y1+0.005, z+0.02);
      sl.box(x0-0.005, y0+0.03, z, x0+0.005, y1-0.03, z+0.02); sl.box(x1-0.005, y0+0.03, z, x1+0.005, y1-0.03, z+0.02); }
    g.box(x0-0.09, y0-0.09, zr+h, x1+0.09, y1+0.09, zr+h+0.03, 0.006);   // крышка с выносом
  }
  /** проём вентиляции в стене помещения: снаружи — жалюзи с козырьком (с маркизой — маркиза вместо козырька), изнутри —
   *  решётка и клапан с электроприводом */
  vent(w, u0, u1, z0, z1, intake, mk){
    const S=this.s, a=u0/1000, b=u1/1000, Z0=S.base+z0/1000, Z1=S.base+z1/1000;
    if (mk) this.snow(w, a, b, Z1, mk);
    this.walls.busy(w, u0-90, u1+260, z0-90, z1+90);
    this.outer(w, u0-StationVent.HOOD_SIDE-20, u1+StationVent.HOOD_SIDE+20, mk ? Math.min(z0, z1+StationVent.HOOD_LAP-mk.drop)-80 : z0-80, z1+(mk ? 140 : 220));
    if (w==='right') S.louver(1, S.Le, S.oy+a, S.oy+b, Z0, Z1, 1);
    else if (w==='left') S.louver(1, 0, S.oy+a, S.oy+b, Z0, Z1, -1);
    else if (w==='back') S.louver(0, S.We, S.ox+a, S.ox+b, Z0, Z1, 1);
    else if (!S.cut) S.louver(0, 0, S.ox+a, S.ox+b, Z0, Z1, -1);
    if (!mk) this.hood(w, a-0.06, b+0.06, Z1+0.06);
    if (!this.shown(w)) return;
    const fr=S.M(StMat.paint('#9aa1a8', 0.5)), sl=S.M(StMat.paint('#6b737b', 0.55)), dk=S.M(StMat.paint('#202428', 0.6)), uc=(u0+u1)/2, zc=(z0+z1)/2, du=u1-u0, dz=z1-z0;
    for (const [u, z, a1, b1] of [[uc, z0, du+60, 30], [uc, z1, du+60, 30], [u0, zc, 30, dz+60], [u1, zc, 30, dz+60]]) this.box(fr, w, u, z, a1, b1, 25);
    for (let z=z0+40; z<z1-20; z+=55) this.box(sl, w, uc, z, du-10, 12, 18, 0);
    this.box(dk, w, u1+130, zc, 110, 150, 90, 0.008); this.box(fr, w, u1+50, zc, 50, 20, 40, 0);   // электропривод клапана
  }
  /** ДГУ: напротив радиатора — двустворчатая дверь-жалюзи (выброс горячего воздуха и проём для монтажа и демонтажа ДГУ) в
   *  торце (wall 'right' | 'left', d.y0…d.y1) или в задней стене (ДГУ поперёк, d.x0…d.x1): коробка, створки с наклонными
   *  ламелями (внизу — глухая полоса), петли по краям, запорные штанги и ручка посередине, козырёк сверху; изнутри — клапан с
   *  электроприводом */
  endDoor(d){
    const S=this.s, w=d.wall||'right', end=w!=='back', u0m=end ? d.y0 : d.x0, u1m=end ? d.y1 : d.x1, a=u0m/1000, b=u1m/1000, Z0=S.base+0.01, Z1=S.base+d.h/1000, m=(a+b)/2;
    const o=end ? S.oy : S.ox, sg=w==='left' ? -1 : 1, pl=w==='left' ? 0 : w==='right' ? S.Le : S.We;
    const P=(u, q, z)=>end ? [pl+sg*q, o+u, z] : [o+u, pl+sg*q, z], V=(du, dq, dz)=>end ? [sg*dq, du, dz] : [du, sg*dq, dz];
    const bx=(mt, ua, ub, qa, qb, za, zb, r=0)=>{ const p=P(ua, qa, za), q=P(ub, qb, zb); mt.box(p[0], p[1], p[2], q[0], q[1], q[2], r); };
    this.walls.busy(w, u0m-60, u1m+260, 0, d.h+120); this.outer(w, u0m-100, u1m+100, 0, d.h+220);
    const fr=S.M(StMat.paint(RalColor.shade(S.frame, 0.9), 0.45)), lf=S.M(StMat.paint(S.wall, 0.45)), sl=S.M(StMat.paint('#5d646b', 0.55)), dk=S.M(StMat.paint('#24292e', 0.55)), mt=S.M(StMat.metal('#c3c8cd', 0.3));
    bx(fr, a-0.05, a, 0, 0.03, Z0-0.01, Z1+0.05); bx(fr, b, b+0.05, 0, 0.03, Z0-0.01, Z1+0.05); bx(fr, a-0.05, b+0.05, 0, 0.03, Z1, Z1+0.05);   // коробка
    for (const [u0, u1, hinge] of [[a, m-0.003, a], [m+0.003, b, b]]){
      bx(lf, u0, u1, 0, 0.022, Z0, Z1-0.004, 0.004);                                                          // полотно-рама створки
      for (let z=Z0+0.24; z<Z1-0.1; z+=0.07) sl.obox(P(u0+0.06, 0.022, z), V(u1-u0-0.12, 0, 0), V(0, 0.03, -0.022), V(0, 0, 0.012));   // ламели
      for (const k of [0.15, 0.5, 0.85]){ const z=Z0+(Z1-Z0)*k, uh=hinge+(hinge===a ? 0.015 : -0.015); dk.tube(P(uh, 0.03, z), P(uh, 0.03, z+0.12), 0.016, 10); } }   // петли
    for (const u of [m-0.07, m+0.06]) mt.tube(P(u, 0.06, Z0+0.08), P(u, 0.06, Z1-0.08), 0.012, 10);           // запорные штанги
    bx(dk, m+0.02, m+0.1, 0.05, 0.075, Z0+0.95, Z0+1.17, 0.005);                                               // ручка с замком
    this.hood(w, a-0.08, b+0.08, Z1+0.08); this.log.push({ kind:'dgudoor', wall:w, u:(u0m+u1m)/2, w:d.w, h:d.h });
    if (!this.shown(w)) return;
    const zc=d.h/2; this.box(dk, w, u1m+150, zc, 110, 150, 90, 0.008); this.box(fr, w, u1m+70, zc, 50, 20, 40, 0);   // электропривод клапана
  }
  /** выхлоп ДГУ через стену (plan.exhausts, how 'wall' — глушитель встроен в ДГУ): от турбины вверх и к стене в теплоизоляции,
   *  проходка-гильза, снаружи — отвод вниз под 45° с дождевым колпаком */
  exhausts(){
    const S=this.s, P=this.p, [, W]=P.int, E=(P.exhausts||[]).filter(e=>e.how==='wall'); if (!E.length) return;
    const wrap=S.M(StMat.metal('#c4c9cd', 0.55)), st=S.M(StMat.metal('#a7adb3', 0.4)), dk=S.M(StMat.paint(StScene.DARK, 0.55)), r=55;
    for (const e of E){ const g=P.items.find(i=>i.kind==='dgu' && i.pos===e.pos && i.unit===e.unit); if (!g) continue;
      this.walls.busy('back', e.u-200, e.u+200, e.z-200, e.z+200); this.outer('back', e.u-250, e.u+250, e.z-500, e.z+250);
      if (this.inside){ const a=S.P(e.u, g.y+g.ly*0.5, g.h), b=S.P(e.u, g.y+g.ly*0.5, e.z), c=S.P(e.u, W, e.z);
        wrap.tube(a, b, r/1000*1.15, 18); wrap.sphere(b, r/1000*1.15, 14); wrap.tube(b, c, r/1000*1.15, 18); }
      const o=S.P(e.u, W, e.z), y=S.We; o[1]=y; const p1=[o[0], y+0.25, o[2]], p2=[o[0], y+0.42, o[2]-0.17];
      dk.tube([o[0], y-0.03, o[2]], [o[0], y+0.02, o[2]], r/1000*1.9, 20);                                   // гильза-проходка
      st.tube([o[0], y, o[2]], p1, r/1000, 18); st.sphere(p1, r/1000, 14); st.tube(p1, p2, r/1000, 18);        // отвод вниз под 45°
      dk.tube(p2, [p2[0], p2[1]+0.04, p2[2]-0.04], r/1000*1.5, 18);                                           // колпак
      this.log.push({ kind:'exhaust', wall:'back', u:e.u, z:e.z }); }
  }
  /** заливная горловина в нише стены w (u — вдоль стены, z — от пола, мм): снаружи — лючок заподлицо (рамка в плоскости
   *  обшивки, полотно, скрытые петли, замок под ключ), знаки; изнутри — короб ниши и горловина с крышкой */
  niche(w, u, z){
    const S=this.s, mm=S.mm, lk=S.M(StMat.paint(RalColor.shade(S.wall, 0.86), 0.45)), dk=S.M(StMat.paint('#24292e', 0.55)), mt=S.M(StMat.metal('#c3c8cd', 0.3)), zc=S.base+mm(z), a=0.2;
    // наружная плоскость стены и нормаль наружу
    const end=w==='left', X=end ? this.leftX() : null, Y=w==='back' ? S.We : this.frontY(), n=end ? [-1, 0, 0] : w==='back' ? [0, 1, 0] : [0, -1, 0];
    const c=end ? [X, S.oy+mm(u), zc] : [S.ox+mm(u), Y, zc], at=(du, dz, o)=>end ? [c[0]+n[0]*o, c[1]+du, c[2]+dz] : [c[0]+du, c[1]+n[1]*o, c[2]+dz];
    const bx=(m, d0, d1, z0, z1, o0, o1, r=0)=>{ const p=at(d0, z0, o0), q=at(d1, z1, o1); m.box(Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.min(p[2], q[2]), Math.max(p[0], q[0]), Math.max(p[1], q[1]), Math.max(p[2], q[2]), r); };
    bx(dk, -a, a, -a, a, 0, 0.003); bx(lk, -a+0.012, a-0.012, -a+0.012, a-0.012, 0.002, 0.004, 0.003);   // рамка и лючок заподлицо
    bx(mt, -0.02, 0.02, -0.12, -0.08, 0.003, 0.006, 0.004);                                                // замок под ключ
    S.sticker({ type:'sign', id:'W01' }, at(-0.08, 0.06, 0.005), n, 0.12, 0.105); S.sticker({ type:'sign', id:'DT' }, at(0.1, 0.06, 0.005), n, 0.11, 0.06);
    if (!this.inside) return;
    const t=end ? S.ox : S.oy;   // ниша — в толще стены и внутрь помещения отсека
    bx(lk, -a, a, -a, a, -(t+0.15), -t, 0.01); dk.tube(at(0, -0.02, -t-0.02), at(0, -0.02, -t-0.12), 0.04, 14);   // короб ниши, горловина
  }
  /** козырёк над жалюзи снаружи (от дождя и снега) */
  hood(w, a, b, zt){
    const S=this.s, m=S.M(StMat.paint(RalColor.shade(S.wall, 0.9), 0.45)), t=[0, 0, 0.006];
    if (w==='right') m.obox([S.Le, S.oy+a, zt], [0, b-a, 0], [0.14, 0, -0.07], t);
    else if (w==='left') m.obox([0, S.oy+a, zt], [0, b-a, 0], [-0.14, 0, -0.07], t);
    else if (w==='back') m.obox([S.ox+a, S.We, zt], [b-a, 0, 0], [0, 0.14, -0.07], t);
    else if (!S.cut) m.obox([S.ox+a, 0, zt], [b-a, 0, 0], [0, -0.14, -0.07], t);
  }
  /** маркиза над жалюзи (u a…b, верх Z1, м): откидной козырёк на петлях, открыт на угол H.a от стены; по бокам —
   *  раскрывающиеся треугольные створки-ограничители от стены до кромки (воздух проходит только снизу); закрытый козырёк
   *  ложится на проём как щит. o — от наружной плоскости (на полотне створки) */
  snow(w, a, b, Z1, H, o=0){
    if (w==='front' && this.s.cut) return;   // стена со стороны зрителя срезана
    const S=this.s, m=S.M(StMat.paint(RalColor.shade(S.wall, 0.86), 0.45)), sd=S.M(StMat.paint(RalColor.shade(S.wall, 0.78), 0.5)), dk=S.M(StMat.paint('#24292e', 0.5)), t=0.004;
    const at=(u, q, z)=>{ const x=o+q; return w==='right' ? [S.Le+x, S.oy+u, z] : w==='left' ? [-x, S.oy+u, z] : w==='back' ? [S.ox+u, S.We+x, z] : [S.ox+u, -x, z]; };
    const vec=(du, dq, dz)=>{ const p=at(du, dq, dz), z=at(0, 0, 0); return p.map((v, k)=>v-z[k]); };
    const r=H.a*Math.PI/180, d=H.d/1000, dr=H.drop/1000, sw=StationVent.HOOD_SIDE/1000, A=a-sw, B=b+sw, zh=Z1+StationVent.HOOD_LAP/1000, zl=zh-dr, q0=0.012;
    m.obox(at(A, q0, zh), vec(B-A, 0, 0), vec(0, d, -dr), vec(0, t*Math.cos(r), t*Math.sin(r)));                     // козырёк
    m.obox(at(A, q0+d, zl), vec(B-A, 0, 0), vec(0, 0, -0.035), vec(0, t, 0));                                       // отбортовка кромки
    for (const u of [A, B]){ const p1=at(u, q0, zh), p2=at(u, q0+d, zl), p3=at(u, q0, zl); sd.tri(p1, p2, p3); sd.tri(p1, p3, p2); }   // створки
    for (const u of [a, (a+b)/2-0.03, b-0.06]) dk.tube(at(u, 0.02, zh+0.01), at(u+0.06, 0.02, zh+0.01), 0.012, 8);   // петли
  }
  /** воздуховод от радиатора ДГУ к жалюзи — гибкая вставка из ткани с рамками */
  duct(it){
    const S=this.s, [L, W]=this.p.int, x0=S.g.x0||0, rad=it.rad || 'right'; if (!this.inside) return;
    const cl=S.M(StMat.paint('#3b4046', 0.85)), f=S.M(StMat.metal('#8f969d', 0.45)), za=it.h*0.1, zb=it.h*0.96;
    if (rad==='back'){ const y1=it.y+it.ly; if (W-y1<30) return;   // поперёк: радиатор к задней стене
      cl.box(...S.P(it.x+60, y1, za), ...S.P(it.x+it.lx-60, W, zb), 0.02);
      for (const y of [y1, W-40]) f.box(...S.P(it.x+50, y, it.h*0.09), ...S.P(it.x+it.lx-50, y+40, it.h*0.97), 0.006); return; }
    const [a, b]=rad==='left' ? [x0, it.x] : [it.x+it.lx, L]; if (b-a<30) return;
    cl.box(...S.P(a, it.y+60, za), ...S.P(b, it.y+it.ly-60, zb), 0.02);
    for (const x of rad==='left' ? [a, b-40] : [a, b-40]) f.box(...S.P(x, it.y+50, it.h*0.09), ...S.P(x+40, it.y+it.ly-50, it.h*0.97), 0.006);
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
    if (F.exit2){ const e=F.exit2, z=Math.max(e.top+90, H-125); if (z+75<H-20) this.hang('EXIT', e.wall, e.u, z, 360, 130); }   // над второй дверью оператора
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
    // заливная горловина утоплена в стену (решение владельца 19.10): ниша внутрь, снаружи — лючок заподлицо под замок, знак
    // «Пожароопасно», надпись «ДТ»; ничего не выступает — габарит станции не меняется
    const wl=fl.wall==='left' || fl.wall==='back' ? fl.wall : 'front', fu=wl==='left' ? fl.y : fl.x;
    this.outer(wl, fu-260, fu+260, fl.z-260, fl.z+260);
    if (wl!=='front' || !S.cut) this.niche(wl, fu, fl.z);
    // ворота отсека в торце: жалюзи внизу и вверху створок (естественная вентиляция отсека)
    if (f.gate){ const G=f.gate, lw=(G.y1-G.y0)/2, x=-0.027;
      for (let k=0; k<2; k++){ const a=S.oy+mm(G.y0+k*lw+120), b=S.oy+mm(G.y0+(k+1)*lw-120); if (b-a<0.15) continue;
        S.louver(1, x, a, b, S.base+0.15, S.base+0.45, -1); S.louver(1, x, a, b, S.base+mm(G.h)-0.45, S.base+mm(G.h)-0.2, -1); }
      this.outer('left', G.y0-100, G.y1+100, 0, G.h+150); return; }
    // жалюзи отсека вверху в торце (внизу — решётка в двери отсека); у морского в торце — его двери
    if (!S.g.sea){ const y0=S.oy+mm(W-450), y1=S.oy+mm(W-150); S.louver(1, 0, y0, y1, S.top-0.65, S.top-0.4, -1); this.hood('left', y0-S.oy-0.06, y1-S.oy+0.06, S.top-0.34);
      this.outer('left', W-510, W-90, (S.top-0.7-S.base)*1000, (S.top-0.3-S.base)*1000); }
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
    const en=P.entry;
    for (const G of [P.gates, P.gates2]) if (G && !G.sea){   // монтажные ворота в торце: козырёк над ними
      const x=G.wall==='left' ? this.leftX() : this.rightX(), nn=[G.wall==='left' ? -1 : 1, 0, 0], zt=S.base+G.h/1000;
      this.canopy([x, S.oy+(G.y0+G.y1)/2000, zt], nn, (G.y1-G.y0)/1000+0.24); this.outer(G.wall, G.y0-100, G.y1+100, 0, G.h+620); }
    if (en && en.wall==='left'){   // дверь оператора в торце: козырёк, прожектор; таблички и знаки — на полотне (у морского — на его дверях)
      const x=this.leftX(), n=[-1, 0, 0], c=cat(main), yc=S.oy+(en.y0+en.y1)/2000, zt=S.base+en.h/1000;
      this.outer('left', en.y0-100, en.y1+100, 0, en.h+620);
      if (!en.sea){ this.canopy([x, yc, zt], n, en.w/1000+0.24); if (this.room(zt)) this.flood([x, yc, zt+0.17], n); }
      const zs=S.base+(en.sea ? 1.62 : 1.38), dy=en.sea ? 0.3 : 0.12;
      if (c) S.sticker(c, [x-0.004, en.sea ? yc+0.3 : yc, en.sea ? zs+0.06 : S.base+1.72], n, 0.3, 0.2);
      S.sticker({ type:'sign', id:'W08' }, [x-0.004, yc-dy, en.sea ? zs+0.06 : zs], n, 0.2, 0.175); S.sticker({ type:'sign', id:'P06' }, [x-0.004, en.sea ? yc-dy : yc+dy, en.sea ? zs-0.19 : zs], n, 0.2, 0.2);
      if (F.auto && !en.sea && zt+0.2<S.top-0.04){ const hb=S.M(StMat.paint('#eceeef', 0.4)), W=S.Wi*1000, right=en.y1+560<=W-100, a=S.oy+(right ? en.y1+140 : en.y0-530)/1000, b=a+0.39;
        if (right || en.y0-530>=100) for (const [id, z] of [['POW_NO', zt+0.06], ['AUTO_OFF', zt-0.14]]){ hb.box(x-0.04, a, z-0.08, x, b, z+0.08, 0.006); S.sticker({ type:'sign', id }, [x-0.04, (a+b)/2, z], n, 0.36, 0.13, 0.8); } } }
    if (P.fuel && P.fuel.gate){ const G=P.fuel.gate, x=this.leftX(), n=[-1, 0, 0], zt=S.base+G.h/1000, lw=(G.y1-G.y0)/2000, ya=S.oy+G.y0/1000+lw/2, zs=S.base+1.38;   // ворота отсека бака: козырёк, таблички на левой створке
      this.canopy([x, S.oy+(G.y0+G.y1)/2000, zt], n, (G.y1-G.y0)/1000+0.24); this.outer('left', G.y0-100, G.y1+100, 0, G.h+620);
      const c=cat(tank); if (c) S.sticker(c, [x-0.03, ya, S.base+1.72], n, 0.3, 0.2);
      S.sticker({ type:'sign', id:'W01' }, [x-0.03, ya-0.12, zs], n, 0.2, 0.175); S.sticker({ type:'sign', id:'P02' }, [x-0.03, ya+0.12, zs], n, 0.2, 0.2); }
    if (P.exit){ const ex=P.exit, x=this.rightX(), n=[1, 0, 0], yc=S.oy+(ex.y0+ex.y1)/2000, zt=S.base+ex.h/1000;   // вторая дверь оператора в дальнем торце
      this.outer('right', ex.y0-100, ex.y1+100, 0, ex.h+620); this.canopy([x, yc, zt], n, ex.w/1000+0.24); if (this.room(zt)) this.flood([x, yc, zt+0.17], n); }
    for (const d of S.doorsB) this.outer('back', d.x0-170, d.x1+170, 0, d.h+620);   // двери в задней стене — с фурнитурой
    if (!S.closed){ for (const c of S.openF) this.outer('front', c.x0-60, c.x1+60, 0, c.h+620); return; }   // в разрезе открыты
    const y=-0.052, n=[0, -1, 0], fy=this.frontY();
    for (const c of S.openF){ const a=S.ox+c.x0/1000, b=S.ox+c.x1/1000, xm=(a+b)/2, zt=S.base+c.h/1000, zs=S.base+1.38;
      const xp=c.kind!=='service' ? xm : (c.leaves||1)>1 ? a+(b-a)*0.75 : xm-0.08;   // у сервисной двери — мимо запорных штанг
      this.canopy([xm, fy, zt], n, b-a+0.24);
      if (c.kind!=='service' && this.room(zt)) this.flood([xm, fy, zt+0.17], n);
      const sign=c.kind==='entry';   // таблички — на входной двери
      // снаружи занято (полотно — нет): козырёк и прожектор, ручка с замком (у сервисной — запорные штанги по высоте), таблички,
      // табло справа от входа, решётка внизу двери отсека бака
      const um=xp*1000-S.ox*1000, two=(c.leaves||1)>1, uc=(c.x0+c.x1)/2;
      this.outer('front', c.x0-170, c.x1+170, c.h-60, c.h+620); for (const e of [c.x0, c.x1]) this.outer('front', e-30, e+30, 0, c.h);   // края полотна — знак не поперёк
      if (c.kind==='service') this.outer('front', ...(two ? [uc-160, uc+160] : [c.x1-200, c.x1+20]), 0, c.h);
      else this.outer('front', two ? uc-160 : c.x1-260, two ? uc+160 : c.x1+60, 800, 1200);
      if (sign || c.kind==='tank') this.outer('front', um-290, um+290, 1240, 1850);
      // табло «Порошок! Не входи!» и «Автоматика отключена» — справа от двери, у дальнего края — слева (в габарите станции)
      const rt=b+0.56<S.ox+S.Li-0.05, tb=rt ? b+0.14 : a-0.53;
      if (sign && F.auto) this.outer('front', ...(rt ? [c.x1+120, c.x1+560] : [c.x0-560, c.x0-120]), c.h-260, c.h+170);
      if (c.kind==='tank') this.outer('front', c.x0, c.x1, 0, 520);
      const pl=c.kind==='tank' ? cat(tank) : sign ? cat(main) : null;
      if (pl) S.sticker(pl, [xp, y, S.base+1.72], n, 0.3, 0.2);
      if (sign){ S.sticker({ type:'sign', id:'W08' }, [xp-0.12, y, zs], n, 0.2, 0.175); S.sticker({ type:'sign', id:'P06' }, [xp+0.12, y, zs], n, 0.2, 0.2);
        if (F.auto && zt+0.2<S.top-0.04){ const hb=S.M(StMat.paint('#eceeef', 0.4));
          for (const [id, z] of [['POW_NO', zt+0.06], ['AUTO_OFF', zt-0.14]]){ hb.box(tb, fy-0.04, z-0.08, tb+0.39, fy, z+0.08, 0.006); S.sticker({ type:'sign', id }, [tb+0.195, fy-0.04, z], n, 0.36, 0.13, 0.8); } } }
      if (c.kind==='tank'){ S.sticker({ type:'sign', id:'W01' }, [xm-0.12, y, zs], n, 0.2, 0.175); S.sticker({ type:'sign', id:'P02' }, [xm+0.12, y, zs], n, 0.2, 0.2); }
    }
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

  /** наружная поверхность дальнего торца (виден снаружи у ДГУ с дверью-жалюзи) */
  rightX(){ const S=this.s, G=[this.p.gates, this.p.gates2].some(q=>q && q.wall==='right'); return S.Le+(S.g.sea ? 0.008 : G ? 0.028 : S.g.type==='welded' ? -0.003 : -0.018); }

  // ---- маркировка для подъёма (ГОСТ 14192-96, StationMass — plan.mass): знак № 9 «Место строповки» — у верхних углов
  // (у точек строповки) на обеих длинных стенах (п. 5.5.1), где у угла дверь с козырьком — на торце у того же угла;
  // № 12 «Центр тяжести» — в проекции центра тяжести на каждой стене, где это место свободно (п. 5.5.2, 7.9: не меньше
  // двух сторон), на стене со стороны зрителя рядом — надпись «Масса брутто». Знаки чёрные, на тёмной стене — белые
  // (п. 5.10); размер — крупнее ярлыка № 4 (148 × 210 мм): по трафарету на стене контейнера
  static SLING = [180, 300];   // знак № 9 на стене, мм
  static COG = 300;            // знак № 12 на стене, мм
  /** проекция центра тяжести на стену w: {u, z} — мм, как у StWalls (вдоль стены помещения, от пола); нет массы — null */
  cogOn(w){ const M=this.p.mass, S=this.s; if (!M) return null; const c=M.cg, zf=StationGeo.zFloor(S.g.type);
    return { u:w==='left' || w==='right' ? c.y-S.oy*1000 : c.x-S.ox*1000, z:c.z-zf }; }
  lift(){
    const S=this.s, M=this.p.mass; if (!M) return;
    const rgb=RalColor.rgb(S.wall), light=(0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2])/255<0.45, zf=StationGeo.zFloor(S.g.type);
    const ox=S.ox*1000, oy=S.oy*1000, Le=S.Le*1000, We=S.We*1000, [sw, sh]=StOutfit.SLING, cs=StOutfit.COG;
    // точка на наружной поверхности стены: u — вдоль стены помещения, z — от пола, мм
    const leaf=u=>S.closed && S.openF.some(c=>u>c.x0 && u<c.x1);   // на закрытой двери — на её полотне
    const at=(w, u, z)=>[...(w==='front' ? [(u+ox)/1000, leaf(u) ? -0.052 : this.frontY()] : w==='back' ? [(u+ox)/1000, S.We-this.frontY()] : [w==='left' ? this.leftX() : this.rightX(), (u+oy)/1000]), S.base+z/1000];
    const free=(w, u, z, a, b)=>(w!=='front' || !S.cut) && this.outFree(w, u-a/2-40, u+a/2+40, z-b/2-40, z+b/2+40);
    const put=(d, w, u, z, a, b)=>{ S.sticker(d, at(w, u, z), StOutfit.N_OUT[w], a/1000, b/1000); this.outer(w, u-a/2-40, u+a/2+40, z-b/2-40, z+b/2+40); this.log.push({ kind:d.id, wall:w, u, z }); };
    if (S.g.sea) for (const f of [0.14, 0.36, 0.64, 0.86]) this.outer('left', We*f-oy-180, We*f-oy+180, -500, S.He*1000);   // торцевые двери: штанги и ручки
    // № 9: верх — на 130 мм ниже верха контейнера; места мало — знак на 1–2 градации меньше (ГОСТ 14192-96, п. 6.9)
    corner: for (const [w, e] of [['front', 'left'], ['front', 'right'], ['back', 'left'], ['back', 'right']])
      for (const k of [1, 0.7, 0.5]) for (const c of [300, 220, 160]){ const a=sw*k, b=sh*k, z=S.He*1000-zf-b/2-130;   // от угла по наружной стене, мм
        const u=e==='left' ? c-ox : Le-c-ox, v=w==='front' ? c-oy : We-c-oy;
        if (free(w, u, z, a, b)){ put({ type:'sign', id:'SLING', light }, w, u, z, a, b); continue corner; }
        if (free(e, v, z, a, b)){ put({ type:'sign', id:'SLING', light }, e, v, z, a, b); if (e==='left') this.slingL={ ...this.slingL, [w]:true }; continue corner; } }
    let mass=false;
    for (const w of ['front', 'back', 'left', 'right']){ const c=this.cogOn(w), k=[1, 0.7, 0.5].find(k=>free(w, c.u, c.z, cs*k, cs*k)); if (!k) continue;
      const a=cs*k; put({ type:'sign', id:'COG', light }, w, c.u, c.z, a, a);
      if (w==='front') for (const [u, z] of [[c.u+a/2+325, c.z], [c.u-a/2-325, c.z], [c.u, c.z-a/2-210], [c.u, c.z+a/2+210]])   // справа, слева, ниже, выше
        if (u-225>-ox && u+225<Le-ox && z>250 && free(w, u, z, 450, 170)){ put({ type:'sign', id:'MASS', kg:M.mass, light }, w, u, z, 450, 170); mass=true; break; } }
    // «Масса брутто» рядом не встала — на стене со стороны зрителя, ближе к дальнему торцу
    if (!mass) for (let u=Le-ox-600; u>600-ox && !mass; u-=100) for (const z of [1300, 900]) if (free('front', u, z, 450, 170)){ put({ type:'sign', id:'MASS', kg:M.mass, light }, 'front', u, z, 450, 170); mass=true; break; }
  }
  static N_OUT = { left:[-1, 0, 0], right:[1, 0, 0], back:[0, 1, 0], front:[0, -1, 0] };   // нормаль стены — наружу

  // ---- рисунки заказчика (StationPaint.arts): снаружи на выбранной стене — как можно ближе к месту, заданному менеджером,
  // мимо дверей, ворот, жалюзи и знаков у дверей (не помещается — меньше, до половины ширины); не шире и не выше стены;
  // знаки строповки и логотип — мимо рисунков
  arts(){
    const S=this.s; this.artF=[]; this.artL=false;
    for (const a of this.p.arts||[]){ if (a.wall==='front' && S.cut) continue;
      const end=a.wall==='left' || a.wall==='right', len=(end ? S.We : S.Le)*1000, off=(end ? S.oy : S.ox)*1000;   // мм; координаты — как у StWalls (от угла помещения)
      const zlo=(S.dz+0.15-S.base)*1000, zhi=(S.top-0.15-S.base)*1000, f=a.wall==='back' || a.wall==='left' ? 1-a.x : a.x;   // доля — слева направо при взгляде снаружи
      let best=null, first=null;
      for (const k of [1, 0.8, 0.65, 0.5]){
        let w=Math.min(a.w*k, len-300), h=w/a.ar; if (h>zhi-zlo){ h=zhi-zlo; w=h*a.ar; }
        const lo=150+w/2-off, hi=len-150-w/2-off, u0=Math.min(hi, Math.max(lo, f*len-off)), z0=Math.min(zhi-h/2, Math.max(zlo+h/2, (S.dz+S.He*a.z-S.base)*1000));
        if (!first) first={ u:u0, z:z0, w, h };
        for (let u=lo; u<=hi+1e-6; u+=50) for (let z=zlo+h/2; z<=zhi-h/2+1e-6; z+=50){
          const cost=Math.abs(u-u0)+1.5*Math.abs(z-z0); if (best && cost>=best.cost) continue;
          if (this.outFree(a.wall, u-w/2-40, u+w/2+40, z-h/2-40, z+h/2+40)) best={ u, z, w, h, cost }; }
        if (best) break; }
      const q=best || first, wm=q.w/1000, hm=q.h/1000, x=(q.u+off)/1000, zc=S.base+q.z/1000;
      const c=a.wall==='front' ? [x, this.frontY(), zc] : a.wall==='back' ? [x, S.We-this.frontY(), zc] : [a.wall==='left' ? this.leftX() : this.rightX(), x, zc];
      S.sticker({ type:'art', src:a.src, ar:wm/hm }, c, StOutfit.N_OUT[a.wall], wm, hm);
      this.outer(a.wall, q.u-q.w/2-40, q.u+q.w/2+40, q.z-q.h/2-40, q.z+q.h/2+40);
      this.log.push({ kind:'art', wall:a.wall, u:Math.round(q.u), z:Math.round(q.z), w:Math.round(q.w), free:!!best });
      if (a.wall==='front') this.artF.push([x-wm/2-0.1, x+wm/2+0.1]); if (a.wall==='left') this.artL=true; }
  }

  // ---- логотип организации: на торце у двери (виден и в разрезе); снаружи — ещё на длинной стене в самом широком простенке
  brand(){
    const S=this.s, m=S.meta.brand, parts=Array.isArray(m) && m.length ? m : StOutfit.BRAND, txt=parts.map(p=>p[0]).join('');
    const own=/^пневмотех$/i.test(txt), rgb=RalColor.rgb(S.wall), lum=(0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2])/255;   // на тёмной стене — белыми буквами
    const d={ type:'brand', parts, tag:own ? 'ГРУППА КОМПАНИЙ' : '', globe:own, light:lum<0.5, ar:Math.max(2.6, Math.min(8, (own ? 0.5 : 0.7)*txt.length)) };
    const sl=this.slingL||{}, top=S.top-(S.g.sea ? 0.22 : 0.15);
    let y1=this.p.fuel && !S.g.sea ? S.We-0.62 : S.We-(sl.back ? 0.5 : 0.12), y0=sl.front ? 0.5 : 0.12;   // мимо жалюзи отсека бака и знаков строповки
    for (const q of [this.p.entry, this.p.gates, this.p.gates2]) if (q && q.wall==='left' && !q.sea){ const a=S.oy+q.y0/1000-0.15, b=S.oy+q.y1/1000+0.15;   // мимо двери оператора и ворот в торце
      if (a-y0>=y1-b) y1=Math.min(y1, a); else y0=Math.max(y0, b); }
    const w=Math.min(1.9, (y1-y0)*0.92, 0.42*d.ar), h=w/d.ar;
    if (w>=0.6 && !this.artL) S.sticker(d, [this.leftX(), (y0+y1)/2, top-0.1-h/2], [-1, 0, 0], w, h);   // на торце рисунок заказчика — логотипа там нет
    if (!S.closed) return;
    // мимо дверей; жалюзи под логотипом — логотип ниже ростом (над их козырьками), не выходит — мимо жалюзи; у углов — знаки строповки
    const L=((this.p.vent && this.p.vent.louvers)||[]).filter(q=>q.wall==='front').map(q=>({ a:S.ox+q.u0/1000-0.15, b:S.ox+q.u1/1000+0.15, t:S.base+q.z1/1000+0.3 }));
    const fit=cuts=>{ const gaps=[]; let x=0.5; for (const [a, b] of cuts.sort((p, q)=>p[0]-q[0])){ if (a>x) gaps.push([x, a]); x=Math.max(x, b); }
      if (S.Le-0.5>x) gaps.push([x, S.Le-0.5]);
      let best=null; for (const g of gaps){ const len=g[1]-g[0]; if (len<0.9) continue;
        const under=L.filter(q=>q.a<g[1] && q.b>g[0]), room=top-0.12-Math.max(0, ...under.map(q=>q.t));
        const w=Math.min(len*0.85, 3.2, 0.6*d.ar, (under.length ? room : 9)*d.ar); if (w>=0.6 && (!best || w>best.w)) best={ g, w }; }
      return best; };
    const doors=[...S.openF.map(c=>[S.ox+c.x0/1000-0.3, S.ox+c.x1/1000+0.75]), ...(this.artF||[])], A=fit(doors), B=fit([...doors, ...L.filter(q=>q.t>top-0.72).map(q=>[q.a, q.b])]);
    const f=A && (!B || A.w>=B.w*0.8) ? A : B; if (!f) return;
    const w2=f.w, h2=w2/d.ar;
    S.sticker(d, [(f.g[0]+f.g[1])/2, this.frontY(), top-0.12-h2/2], [0, -1, 0], w2, h2);
  }
  static BRAND = [['ПНЕВМО', '#0B45A0'], ['ТЕХ', '#3DA0EE']];
}

if (typeof module!=='undefined') module.exports={ StOutfit };
