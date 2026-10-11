// Реалистичный 3D-вид станции — главное фото в КП. Сцена (StScene) — по расстановке StationLayout (station-layout.js):
// контейнер (морской — гофрированные стены, рама, угловые фитинги, торцевые двери; блок-контейнер — сэндвич-панели),
// стена со стороны зрителя срезана (без прохода — стена с открытыми сервисными дверями), оборудование с деталями,
// трубопровод с опорами и арматурой, глушитель на крыше, свет, отопление, жалюзи. Отрисовка (StGl) — WebGL2 без
// библиотек: перспектива, свет неба и солнца с накоплением теней (мягкие тени и затенение в углах), краска и металл,
// сглаживание. Нет WebGL2 — station-ui.js рисует прежний вид (StationView3D, station-draw.js).
// Сцена — без DOM (проверяется node-тестом), размеры в метрах: x — вдоль контейнера от торца у двери, y — поперёк от
// стены прохода (её срезанной стороны), z — вверх от земли.
'use strict';

// ---------------------------------------------------------------- векторы
class StV {
  static add(a, b){ return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
  static sub(a, b){ return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
  static mul(a, k){ return [a[0]*k, a[1]*k, a[2]*k]; }
  static dot(a, b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
  static cross(a, b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
  static len(a){ return Math.hypot(a[0], a[1], a[2]); }
  static norm(a){ const l=this.len(a)||1; return [a[0]/l, a[1]/l, a[2]/l]; }
  /** два перпендикуляра к направлению d */
  static basis(d){ const t=Math.abs(d[2])<0.9 ? [0, 0, 1] : [1, 0, 0], u=this.norm(this.cross(d, t)); return [u, this.cross(d, u)]; }
}

// ---------------------------------------------------------------- геометрия одного материала: треугольники с нормалями
class StMesh {
  constructor(){ this.p=[]; this.n=[]; this.i=[]; this.t=[]; }   // t — координаты текстуры (только у наклеек)
  get count(){ return this.p.length/3; }
  vert(p, n){ this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); return this.p.length/3-1; }
  /** плоский четырёхугольник a-b-c-d (по кругу) с нормалью n (не задана — по обходу) */
  quad(a, b, c, d, n){ n=n || StV.norm(StV.cross(StV.sub(b, a), StV.sub(d, a))); const k=this.vert(a, n); this.vert(b, n); this.vert(c, n); this.vert(d, n); this.i.push(k, k+1, k+2, k, k+2, k+3); }
  tri(a, b, c, n){ n=n || StV.norm(StV.cross(StV.sub(b, a), StV.sub(c, a))); const k=this.vert(a, n); this.vert(b, n); this.vert(c, n); this.i.push(k, k+1, k+2); }
  /** наклейка: четырёхугольник a-b-c-d (a — левый нижний, по кругу) с текстурой (строка 0 картинки — вверху) */
  decal(a, b, c, d, n){ const k=this.vert(a, n); this.vert(b, n); this.vert(c, n); this.vert(d, n); this.t.push(0, 1, 1, 1, 1, 0, 0, 0); this.i.push(k, k+1, k+2, k, k+2, k+3); }
  /** наклейка на цилиндре (ось z в точке cx, cy, радиус r): по дуге от угла a0 до a1, по высоте z0…z1 */
  decalArc(cx, cy, r, a0, a1, z0, z1, seg=12){
    const k0=this.count;
    for (let j=0; j<=seg; j++){ const a=a0+(a1-a0)*j/seg, n=[Math.cos(a), Math.sin(a), 0], u=j/seg;
      this.vert([cx+r*n[0], cy+r*n[1], z0], n); this.t.push(u, 1); this.vert([cx+r*n[0], cy+r*n[1], z1], n); this.t.push(u, 0); }
    for (let j=0; j<seg; j++){ const q=k0+j*2; this.i.push(q, q+2, q+3, q, q+3, q+1); }
  }
  /** короб от (x0, y0, z0) до (x1, y1, z1); r — фаска по рёбрам (блик на гранях, как у гнутого листа) */
  box(x0, y0, z0, x1, y1, z1, r=0){
    const lo=[Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)], hi=[Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)];
    if (hi.some((v, k)=>v-lo[k]<1e-5)) return;
    r=Math.max(0, Math.min(r, ...hi.map((v, k)=>(v-lo[k])/2.2)));
    const ext=(k, s)=>s>0 ? hi[k] : lo[k], ins=(k, s)=>s>0 ? hi[k]-r : lo[k]+r;
    const pt=(a, va, b, vb, c, vc)=>{ const p=[0, 0, 0]; p[a]=va; p[b]=vb; p[c]=vc; return p; };
    for (let a=0; a<3; a++){ const b=(a+1)%3, c=(a+2)%3;
      for (const s of [-1, 1]){ const n=[0, 0, 0]; n[a]=s;
        this.quad(pt(a, ext(a, s), b, lo[b]+r, c, lo[c]+r), pt(a, ext(a, s), b, hi[b]-r, c, lo[c]+r), pt(a, ext(a, s), b, hi[b]-r, c, hi[c]-r), pt(a, ext(a, s), b, lo[b]+r, c, hi[c]-r), n); } }
    if (!r) return;
    for (let a=0; a<3; a++) for (let b=a+1; b<3; b++){ const c=3-a-b;
      for (const sa of [-1, 1]) for (const sb of [-1, 1]){ const n=[0, 0, 0]; n[a]=sa*Math.SQRT1_2; n[b]=sb*Math.SQRT1_2;
        this.quad(pt(a, ext(a, sa), b, ins(b, sb), c, lo[c]+r), pt(a, ins(a, sa), b, ext(b, sb), c, lo[c]+r), pt(a, ins(a, sa), b, ext(b, sb), c, hi[c]-r), pt(a, ext(a, sa), b, ins(b, sb), c, hi[c]-r), n); } }
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1])
      this.tri([ext(0, sx), ins(1, sy), ins(2, sz)], [ins(0, sx), ext(1, sy), ins(2, sz)], [ins(0, sx), ins(1, sy), ext(2, sz)], StV.norm([sx, sy, sz]));
  }
  /** повёрнутый короб: угол o и рёбра u, v, w (векторы) — створки дверей и наклонные детали */
  obox(o, u, v, w){
    const P=(a, b, c)=>StV.add(o, StV.add(StV.mul(u, a), StV.add(StV.mul(v, b), StV.mul(w, c)))), nu=StV.norm(u), nv=StV.norm(v), nw=StV.norm(w);
    this.quad(P(0, 0, 0), P(0, 1, 0), P(0, 1, 1), P(0, 0, 1), StV.mul(nu, -1)); this.quad(P(1, 0, 0), P(1, 1, 0), P(1, 1, 1), P(1, 0, 1), nu);
    this.quad(P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1), StV.mul(nv, -1)); this.quad(P(0, 1, 0), P(1, 1, 0), P(1, 1, 1), P(0, 1, 1), nv);
    this.quad(P(0, 0, 0), P(1, 0, 0), P(1, 1, 0), P(0, 1, 0), StV.mul(nw, -1)); this.quad(P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1), nw);
  }
  /** цилиндр (конус, если r2) от точки a до точки b; caps — донышки [в a, в b] */
  tube(a, b, r, seg=20, caps=[true, true], r2){
    const d=StV.sub(b, a), L=StV.len(d); if (L<1e-5) return; const ax=StV.mul(d, 1/L), [u, v]=StV.basis(ax), R2=r2==null ? r : r2, k0=this.count;
    for (let k=0; k<=seg; k++){ const t=k/seg*Math.PI*2, n=StV.add(StV.mul(u, Math.cos(t)), StV.mul(v, Math.sin(t)));
      this.vert(StV.add(a, StV.mul(n, r)), n); this.vert(StV.add(b, StV.mul(n, R2)), n); }
    for (let k=0; k<seg; k++){ const q=k0+k*2; this.i.push(q, q+1, q+3, q, q+3, q+2); }
    for (const [c, rr, s] of [[a, r, -1], [b, R2, 1]]){ if (!caps[s<0 ? 0 : 1] || rr<=0) continue;
      const n=StV.mul(ax, s), m=this.vert(c, n);
      for (let k=0; k<=seg; k++){ const t=k/seg*Math.PI*2; this.vert(StV.add(c, StV.add(StV.mul(u, Math.cos(t)*rr), StV.mul(v, Math.sin(t)*rr))), n); }
      for (let k=0; k<seg; k++) this.i.push(m, m+1+k, m+2+k); }
  }
  sphere(c, r, seg=16){
    const k0=this.count, rows=Math.max(4, seg>>1);
    for (let i=0; i<=rows; i++){ const th=i/rows*Math.PI, st=Math.sin(th), ct=Math.cos(th);
      for (let j=0; j<=seg; j++){ const ph=j/seg*Math.PI*2, n=[st*Math.cos(ph), st*Math.sin(ph), ct]; this.vert(StV.add(c, StV.mul(n, r)), n); } }
    for (let i=0; i<rows; i++) for (let j=0; j<seg; j++){ const a=k0+i*(seg+1)+j, b=a+seg+1; this.i.push(a, b, a+1, a+1, b, b+1); }
  }
  /** эллиптическое днище (2:1): от кольца радиуса r на высоте z вверх (dir 1) или вниз (−1), по оси z в точке (cx, cy) */
  dish(cx, cy, z, r, dir, seg=24){
    const k0=this.count, rows=8, h=r*0.5;
    for (let i=0; i<=rows; i++){ const a=i/rows*Math.PI/2, rr=r*Math.cos(a), zz=z+dir*h*Math.sin(a);
      for (let j=0; j<=seg; j++){ const ph=j/seg*Math.PI*2, n=StV.norm([Math.cos(a)*Math.cos(ph)/r, Math.cos(a)*Math.sin(ph)/r, dir*Math.sin(a)/h]); this.vert([cx+rr*Math.cos(ph), cy+rr*Math.sin(ph), zz], n); } }
    for (let i=0; i<rows; i++) for (let j=0; j<seg; j++){ const a=k0+i*(seg+1)+j, b=a+seg+1; this.i.push(a, b, a+1, a+1, b, b+1); }
  }
  /** гофр (трапеция) вдоль оси along (0 — x, 1 — y) от u0 до u1, по высоте z0…z1; плоскость стены — на координате w
   *  поперёк, наружу — out (±1); шаг, глубина гофра */
  corr(along, u0, u1, w, out, z0, z1, pitch=0.278, depth=0.036){
    const P=(u, o, z)=>along===0 ? [u, w+out*o, z] : [w+out*o, u, z];
    const prof=[[0, 0], [0.26, 0], [0.37, depth], [0.63, depth], [0.74, 0], [1, 0]];   // доли шага: наружная грань — выступ
    for (let u=u0; u<u1-1e-6; u+=pitch){ const span=Math.min(pitch, u1-u);
      for (let k=0; k<prof.length-1; k++){ const a=prof[k], b=prof[k+1], ua=u+a[0]*pitch, ub=Math.min(u+b[0]*pitch, u+span); if (ub<=ua) continue;
        const t=StV.norm(along===0 ? [ub-ua, out*(b[1]-a[1]), 0] : [out*(b[1]-a[1]), ub-ua, 0]), n=[t[1], -t[0], 0];   // перпендикуляр к грани — наружу
        const nn=StV.dot(n, along===0 ? [0, out, 0] : [out, 0, 0])<0 ? StV.mul(n, -1) : n;
        this.quad(P(ua, a[1], z0), P(ub, b[1], z0), P(ub, b[1], z1), P(ua, a[1], z1), StV.norm(nn)); } }
  }
}

// ---------------------------------------------------------------- материалы
// c — цвет (sRGB), r — шероховатость, m — металл, e — свечение, k — рисунок: 1 — рифлёный лист пола, 2 — земля (уходит в фон),
// 3 — наклейка (tex — описание картинки в сцене: логотип, знак, табло)
class StMat {
  static paint(c, r=0.45){ return { c, r, m:0 }; }
  static metal(c, r=0.35){ return { c, r, m:1 }; }
  static glow(c, e=4){ return { c, r:0.3, m:0, e }; }
  static decal(tex, e=0){ return { c:'#ffffff', r:0.5, m:0, e, k:3, tex }; }
  static key(m){ return [m.c, m.r, m.m, m.e||0, m.k||0, m.tex||''].join('|'); }
  static lin(hex){ return RalColor.rgb(hex).map(v=>{ const c=v/255; return c<=0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); }); }
}

// ---------------------------------------------------------------- сцена по расстановке
class StScene {
  static INS = '#d9c48a';     // разрез стены: минеральная вата
  static DARK = '#2b3036';    // рамы, решётки, основания
  static GALV = '#b9c0c6';    // оцинковка
  static INOX = '#c9cfd5';
  static SEA_P = [0.278, 0.036];   // гофр морского контейнера: шаг, глубина, м
  static WELD_P = [0.2, 0.02];     // профлист цельносварного

  /** plan — StationLayout.solve(...), meta: {deck — высота шасси, мм; view — 'in' (разрез: стена со стороны зрителя
   *  срезана) или 'out' (вид снаружи, двери закрыты); brand — [[текст, цвет]] логотипа на контейнере; logos — {производитель:
   *  пропорция таблички}} */
  constructor(plan, meta={}){
    this.plan=plan; this.meta=meta; this.groups=new Map(); this.decals=new Map();   // decals: ключ → описание картинки наклейки
    const g=plan.geo, mm=v=>v/1000;
    this.g=g; this.mm=mm; [this.Le, this.We, this.He]=g.ext.map(mm); [this.Li, this.Wi, this.Hi]=plan.int.map(mm);
    this.ox=(this.Le-this.Li)/2; this.oy=(this.We-this.Wi)/2;
    this.dz=plan.chassis ? mm(meta.deck||1150) : 0;
    this.base=this.dz+mm(StationGeo.zFloor(g.type, g.t)); this.ceil=this.base+this.Hi; this.top=this.dz+this.He; this.rise=g.sea ? 0 : mm(g.rise||0);
    this.wall=plan.wallColor||'#CBD0CC'; this.frame=plan.frameColor||RalColor.shade(this.wall, 0.72);
    this.lining=g.sea ? '#e3e6e8' : '#eef0f1';
    // сервисные двери: без прохода — у каждого агрегата (в разрезе открыты), с проходом — только для монтажа и демонтажа
    // (закрыты); входная дверь оператора и дверь отсека бака — отдельно
    const sd=plan.doors||[]; this.svc=plan.door==='service';
    this.doorsF=sd.filter(d=>d.wall!=='back'); this.doorsB=sd.filter(d=>d.wall==='back');
    this.view=meta.view==='out' ? 'out' : 'in'; this.closed=this.view==='out';
    this.cut=this.view==='in' && !(this.svc && this.doorsF.length);   // стена со стороны зрителя срезана (без прохода — стоит, двери открыты)
    // ДГУ с дверью-жалюзи или ворота для демонтажа в дальнем торце: снаружи — вид спереди справа (на этот торец)
    this.az=this.closed && (plan.dguDoor || (plan.gates && plan.gates.wall==='right' && !plan.gates.sea)) ? -StCam.AZ : StCam.AZ;
    // проёмы стены со стороны зрителя: сервисные двери; снаружи — ещё дверь оператора и дверь отсека топливного бака
    this.openF=this.cut ? [] : this.doorsF.map(d=>({ x0:d.x0, x1:d.x1, h:d.h, leaves:d.leaves, kind:'service', open:this.svc }));
    if (this.closed){ const D=StationLayout.DOOR.h, en=plan.entry;
      if (en && en.wall==='front') this.openF.push({ x0:en.x0, x1:en.x1, h:en.h, leaves:1, kind:'entry' });
      if (plan.fuel) this.openF.push({ x0:plan.fuel.door.x0, x1:plan.fuel.door.x1, h:D, leaves:1, kind:'tank' });
      this.openF.sort((a, b)=>a.x0-b.x0); }
  }
  /** наклейка: описание d (картинку рисует StDecal), центр c, нормаль n (наружу от поверхности), размер w × h, м;
   *  e — свечение (световое табло) */
  sticker(d, c, n, w, h, e=0){
    const key=JSON.stringify(d); this.decals.set(key, d);
    const r=StV.norm(StV.cross(StV.mul(n, -1), [0, 0, 1])), o=StV.add(c, StV.mul(n, 0.002)), U=StV.mul(r, w/2), V=[0, 0, h/2];
    this.M(StMat.decal(key, e)).decal(StV.sub(StV.sub(o, U), V), StV.sub(StV.add(o, U), V), StV.add(StV.add(o, U), V), StV.add(StV.sub(o, U), V), n);
  }
  /** пропорция таблички логотипа (ширина / высота): картинка из каталога или название производителя */
  logoAr(mk){ const r=(this.meta.logos||{})[mk.toLowerCase()]; return r>0 ? r : Math.max(1.6, Math.min(7, 0.62*mk.length+0.5)); }
  /** логотип производителя на лицевой стороне — там, где он у изделий этого вида: над решёткой компрессора, у пульта
   *  осушителя, на радиаторе ДГУ, на корпусе ресивера */
  badge(it){
    const mk=String(it.maker || (this.meta.makers||{})[it.id] || '').trim(); if (!mk || it.mount==='pipe' || it.mount==='wall') return;
    const [x0, y0, z0, x1, y1, z1]=this.B(it), s=this.side(it), ar=this.logoAr(mk), d={ type:'logo', maker:mk, bg:it.color, ar };
    const fit=(mw, mh)=>{ const w=Math.min(mw, mh*ar); return [w, w/ar]; };
    if (it.kind==='receiver' && it.shape!=='hcyl'){ const cx=(x0+x1)/2, cy=(y0+y1)/2, r=Math.min(x1-x0, y1-y0)/2, [w, h]=fit(r*1.3, 0.1), a=w/2/r, ac=s<0 ? -Math.PI/2 : Math.PI/2, z=z0+(z1-z0)*0.62;
      const key=JSON.stringify(d); this.decals.set(key, d);
      return this.M(StMat.decal(key)).decalArc(cx, cy, r+0.003, ac+(s<0 ? -a : a), ac+(s<0 ? a : -a), z-h/2, z+h/2); }
    const at={ compressor:[0.06, 0.3, 0.84, 0.93], dryer:[0.52, 0.9, 0.77, 0.9], other:[0.06, 0.4, 0.85, 0.94], receiver:[0.3, 0.7, 0.55, 0.75] }[it.kind];
    if (it.kind==='dgu'){ const L=x1-x0, H=z1-z0, xr=x0+L*0.84, [w, h]=fit((x1-xr)*0.85, H*0.1), y=s<0 ? y0+(y1-y0)*0.04 : y1-(y1-y0)*0.04;
      return this.sticker(d, [(xr+x1)/2, y, z0+H*0.8], [0, s, 0], w, h); }
    if (!at || (it.kind==='dryer' && /адсорбц/i.test(it.name||''))) return;
    const span=this.endwise(it) ? y1-y0 : x1-x0, [w, h]=fit((at[1]-at[0])*span, (at[3]-at[2])*(z1-z0));
    this.sticker(d, this.front(it, (at[0]+at[1])/2, (at[2]+at[3])/2, 0.001), this.out(it, 1), w, h);
  }
  /** геометрия материала m */
  M(m){ const k=StMat.key(m); let e=this.groups.get(k); if (!e){ e={ mat:m, mesh:new StMesh() }; this.groups.set(k, e); } return e.mesh; }
  /** точка внутри контейнера (мм от внутренних стен и пола) → мир, м */
  P(x, y, z){ return [this.ox+x/1000, this.oy+y/1000, this.base+z/1000]; }

  build(){
    this.ground(); if (this.dz) this.chassis();
    this.container(); this.outfit=new StOutfit(this).build();
    if (this.view==='in'){ for (const it of this.plan.items) this.equip(it); for (const pp of this.plan.piping||[]) this.piping(pp); }   // снаружи внутреннего не видно
    for (const m of this.plan.roof||[]) this.muffler(m);
    if ((this.plan.outside||[]).length) this.outside();
    return this;
  }
  /** ресиверы снаружи: бетонная площадка, ресивер; трубопровод от выхода через торец — коллектором к входам ресиверов
   *  (сбоку внизу), с краном у стены; выход — сверху к потребителю */
  outside(){
    const E=this.plan.outside, pad=this.M(StMat.paint('#b9b6ae', 0.95)), mm=this.mm, P=mm(StationLayout.PAD);
    for (const it of E){ const [x0, y0, z0, x1, y1]=this.B(it); pad.box(x0-0.2, y0-0.2, z0-P, x1+0.2, y1+0.2, z0, 0.01); this.equip(it); }
    const pp=(this.plan.piping||[])[0], l=pp && pp.lines.find(q=>q.medium==='air' && !q.header && q.x1>=this.plan.int[0]-1); if (!l) return;
    const m=this.M(pp.mat==='inox' ? StMat.metal(StScene.INOX, 0.22) : { c:pp.color, r:0.38, m:0.35 }), red=this.M(StMat.paint('#c83a2e', 0.4)), dn=+(String(pp.dn||'').match(/\d+/)||[0])[0];
    const r=Math.max(0.012, Math.min(0.08, (dn || 50)/2000+0.006)), o=this.P(l.x1, l.y, l.z), x0=Math.min(...E.map(i=>this.B(i)[0])), xm=(this.Le+0.07+x0)/2;
    const run=(...Q)=>{ for (let k=1; k<Q.length; k++){ m.tube(Q[k-1], Q[k], r, 18); m.sphere(Q[k], r*1.03, 12); } };
    const zin=it=>{ const [, , z0, , , z1]=this.B(it); return it.shape==='vcyl' && it.h>=900 ? z0+Math.max(0.25, mm(it.h)*0.22) : (z0+z1)/2; };
    run([this.Le+0.07, o[1], o[2]], [xm, o[1], o[2]]);
    m.sphere([xm, o[1], o[2]], r*1.03, 12); red.box(this.Le+0.25, o[1]-0.012, o[2]+r*1.3, this.Le+0.38, o[1]+0.012, o[2]+r*1.3+0.018, 0.004);   // кран у стены
    for (const it of E){ const [ix0, iy0, , , iy1]=this.B(it), y=(iy0+iy1)/2, z=zin(it); run([xm, o[1], o[2]], [xm, y, o[2]], [xm, y, z], [ix0, y, z]); m.tube([ix0-0.02, y, z], [ix0+0.01, y, z], r*1.6, 18); }
    const far=E.reduce((a, c)=>c.x+c.lx>a.x+a.lx ? c : a), [fx0, fy0, , fx1, fy1, fz1]=this.B(far), cx=(fx0+fx1)/2, cy=(fy0+fy1)/2;
    run([cx, cy, fz1+0.09], [cx, cy, fz1+0.25], [fx1+0.4, cy, fz1+0.25]); m.tube([fx1+0.38, cy, fz1+0.25], [fx1+0.42, cy, fz1+0.25], r*1.7, 20);
  }
  /** габариты сцены (м): контейнер, глушитель, открытые двери */
  bounds(){
    const R=this.plan.roof||[], up=R.reduce((s, m)=>Math.max(s, (m.gap+m.d)/1000+0.05), 0), sw=this.closed || !this.svc ? 0 : Math.max(0, ...[...this.doorsF, ...this.doorsB].map(d=>d.w/d.leaves/1000));
    const E=(this.plan.outside||[]).map(i=>this.B(i)), xo=Math.max(this.Le, ...E.map(b=>b[3]+0.45), ...R.map(m=>this.ox+(m.x+m.lx+m.outlet)/1000+0.03)), yo=Math.min(0, ...E.map(b=>b[1]-0.2)), yi=Math.max(this.We, ...E.map(b=>b[4]+0.2)), zo=Math.max(0, ...E.map(b=>b[5]+0.3));
    return { lo:[-0.15, Math.min(yo, -0.15-(this.doorsF.length ? sw*0.8 : 0)), 0], hi:[xo+0.15, Math.max(yi, this.We+0.15+(this.doorsB.length ? sw*0.8 : 0)), Math.max(zo, this.top+this.rise+up+0.05)] };
  }
  /** число треугольников (проверка и замер) */
  tris(){ let n=0; for (const e of this.groups.values()) n+=e.mesh.i.length/3; return n; }

  // ---- земля
  ground(){ const m=this.M({ c:'#e7e8ea', r:0.9, m:0, k:2 }), R=Math.max(this.Le, this.We)*3;
    m.quad([this.Le/2-R, this.We/2-R, 0], [this.Le/2+R, this.We/2-R, 0], [this.Le/2+R, this.We/2+R, 0], [this.Le/2-R, this.We/2+R, 0], [0, 0, 1]); }

  // ---- шасси: рама, оси с колёсами, опоры
  chassis(){
    const d=this.M(StMat.paint('#30353b', 0.6)), tire=this.M(StMat.paint('#1d1f22', 0.85)), rim=this.M(StMat.metal('#9ea4aa', 0.4)), z=this.dz, L=this.Le, W=this.We;
    d.box(0.2, W*0.18, z-0.28, L-0.2, W*0.3, z, 0.01); d.box(0.2, W*0.7, z-0.28, L-0.2, W*0.82, z, 0.01);
    for (let x=0.6; x<L-0.4; x+=1.2) d.box(x, W*0.18, z-0.22, x+0.08, W*0.82, z-0.06);
    for (const k of L<=7 ? [0.62, 0.78] : [0.66, 0.76, 0.86]){ const x=L*k;
      d.tube([x, W*0.12, 0.43], [x, W*0.88, 0.43], 0.06, 12);
      for (const y of [0.0, W-0.32]){ tire.tube([x, y, 0.43], [x, y+0.32, 0.43], 0.43, 28); rim.tube([x, y-0.004, 0.43], [x, y+0.324, 0.43], 0.24, 20); } }
    for (const y of [W*0.2, W*0.75]) d.box(L*0.18, y, 0, L*0.18+0.12, y+0.12, z-0.28);
  }

  // ---- контейнер
  container(){
    if (this.g.sea) this.sea(); else if (this.g.type==='welded') this.welded(); else this.block();
    this.inside();
  }
  /** морской контейнер: рама, угловые фитинги, гофрированные стены, крыша, торцевые двери */
  sea(){
    const L=this.Le, W=this.We, z0=this.dz, H=this.He, zt=z0+H, f=this.M(StMat.paint(this.frame, 0.5)), w=this.M(StMat.paint(this.wall, 0.5));
    const cast=this.M(StMat.paint(RalColor.shade(this.frame, 0.85), 0.55)), post=0.15, rail=0.16;
    // стойки, нижние и верхние балки, фитинги
    for (const x of [0, L-post]) for (const y of [0, W-post]) f.box(x, y, z0, x+post, y+post, zt, 0.008);
    for (const y of [0, W-0.16]){ f.box(0, y, z0, L, y+0.16, z0+rail, 0.006); f.box(0, y, zt-0.11, L, y+0.16, zt, 0.006); }
    for (const x of [0, L-0.2]){ f.box(x, 0, z0, x+0.2, W, z0+0.2, 0.006); f.box(x, 0, zt-0.12, x+0.2, W, zt, 0.006); }
    for (const x of [0, L-0.178]) for (const y of [0, W-0.162]) for (const z of [z0, zt-0.118]){ cast.box(x-0.004, y-0.004, z, x+0.182, y+0.166, z+0.118, 0.01);
      const dk=this.M(StMat.paint('#15181b', 0.8)); dk.box(x+0.05, y-0.006, z+0.035, x+0.13, y+0.004, z+0.085, 0.01); }
    // задняя стена и дальний торец — гофр наружу; передняя — срезана или с проёмами дверей
    if (this.doorsB.length) this.backWall(w, z0+rail, zt-0.11, StScene.SEA_P); else w.corr(0, post, L-post, W-0.03, 1, z0+rail, zt-0.11);
    w.corr(1, post, W-post, L-0.03, 1, z0+0.2, zt-0.12, 0.28, 0.045);
    if (!this.cut) this.frontWall(w, z0+rail, zt-0.11, StScene.SEA_P);
    // крыша: лист с неглубокими поперечными гофрами
    const roof=this.M(StMat.paint(this.frame, 0.5)); roof.box(post, 0.06, zt-0.02, L-post, W-0.06, zt-0.004);   // крыша — в цвет каркаса
    for (let x=post+0.25; x<L-post-0.1; x+=0.5) roof.box(x, 0.08, zt-0.004, x+0.2, W-0.08, zt+0.008, 0.004);
    this.cargoDoors();
  }
  /** торцевые двери морского контейнера (торец у двери, x = 0): две створки, четыре запорные штанги, ручки, петли */
  cargoDoors(){
    const W=this.We, z0=this.dz+0.2, z1=this.dz+this.He-0.12, w=this.M(StMat.paint(this.wall, 0.5)), bar=this.M(StMat.metal(StScene.GALV, 0.4)), dk=this.M(StMat.paint('#202428', 0.6));
    w.corr(1, 0.15, W/2-0.01, 0.0, -1, z0, z1, 0.32, 0.03); w.corr(1, W/2+0.01, W-0.15, 0.0, -1, z0, z1, 0.32, 0.03);
    for (const y of [W/2-0.012, W/2+0.012]) dk.box(-0.035, y-0.006, z0, -0.02, y+0.006, z1);
    for (const f of [0.14, 0.36, 0.64, 0.86]){ const y=W*f;
      bar.tube([-0.06, y, z0+0.05], [-0.06, y, z1-0.05], 0.016, 10);
      for (const z of [z0+0.06, z1-0.06]) dk.box(-0.075, y-0.03, z-0.03, -0.035, y+0.03, z+0.03, 0.005);
      dk.box(-0.09, y-0.012, this.dz+this.He*0.42, -0.06, y+0.15*(f<0.5 ? 1 : -1), this.dz+this.He*0.42+0.03, 0.006); }
    for (const y of [0.17, W-0.19]) for (const k of [0.2, 0.5, 0.8]) dk.box(-0.05, y, z0+(z1-z0)*k, -0.02, y+0.04, z0+(z1-z0)*k+0.1, 0.004);
  }
  /** блок-контейнер: каркас из профильной трубы, стены и кровля — сэндвич-панели со швами */
  block(){
    const L=this.Le, W=this.We, z0=this.dz, zt=z0+this.He, f=this.M(StMat.paint(this.frame, 0.45)), w=this.M(StMat.paint(this.wall, 0.42)), seam=this.M(StMat.paint(RalColor.shade(this.wall, 0.82), 0.6)), t=0.1;
    for (const x of [0, L-t]) for (const y of [0, W-t]) f.box(x, y, z0, x+t, y+t, zt, 0.006);
    for (const y of [0, W-t]){ f.box(0, y, z0, L, y+t, z0+0.16, 0.006); f.box(0, y, zt-t, L, y+t, zt, 0.006); }
    for (const x of [0, L-t]){ f.box(x, 0, z0, x+t, W, z0+0.16, 0.006); f.box(x, 0, zt-t, x+t, W, zt, 0.006); }
    // стены: задняя, торцы; швы панелей шагом около 1,15 м
    const panel=(along, u0, u1, wv, out)=>{ const P=(u, z)=>along===0 ? [u, wv, z] : [wv, u, z], n=along===0 ? [0, out, 0] : [out, 0, 0];
      w.quad(P(u0, z0+0.16), P(u1, z0+0.16), P(u1, zt-t), P(u0, zt-t), n);
      const k=Math.max(1, Math.round((u1-u0)/1.15)); for (let i=1; i<k; i++){ const u=u0+(u1-u0)*i/k, o=out*0.004;
        seam.box(...(along===0 ? [u-0.006, wv+o-0.002, z0+0.16, u+0.006, wv+o+0.002, zt-t] : [wv+o-0.002, u-0.006, z0+0.16, wv+o+0.002, u+0.006, zt-t])); } };
    if (this.doorsB.length) this.backWall(w, z0+0.16, zt-t, null); else panel(0, t, L-t, W-0.02, 1);
    panel(1, t, W-t, L-0.02, 1); panel(1, t, W-t, 0.02, -1);
    if (!this.cut) this.frontWall(w, z0+0.16, zt-t, null);
    this.roof(zt, this.frame);   // крыша — в цвет каркаса
    this.endDoors();
  }
  /** цельносварной: рама из гнутого швеллера и стойки, стены — профилированный лист (трапеция), приваренный к раме */
  welded(){
    const L=this.Le, W=this.We, z0=this.dz, zt=z0+this.He, f=this.M(StMat.paint(this.frame, 0.45)), w=this.M(StMat.paint(this.wall, 0.45)), t=0.12, b=0.2, P=StScene.WELD_P;
    for (const x of [0, L-t]) for (const y of [0, W-t]) f.box(x, y, z0, x+t, y+t, zt, 0.006);
    for (const y of [0, W-t]){ f.box(0, y, z0, L, y+t, z0+b, 0.006); f.box(0, y, zt-0.1, L, y+t, zt, 0.006); }
    for (const x of [0, L-t]){ f.box(x, 0, z0, x+t, W, z0+b, 0.006); f.box(x, 0, zt-0.1, x+t, W, zt, 0.006); }
    if (this.doorsB.length) this.backWall(w, z0+b, zt-0.1, P); else w.corr(0, t, L-t, W-0.025, 1, z0+b, zt-0.1, ...P);
    w.corr(1, t, W-t, L-0.025, 1, z0+b, zt-0.1, ...P); w.corr(1, t, W-t, 0.025, -1, z0+b, zt-0.1, ...P);
    if (!this.cut) this.frontWall(w, z0+b, zt-0.1, P);
    this.roof(zt, this.frame);   // крыша — в цвет каркаса
    this.endDoors();
  }
  /** высота крыши над поперечной координатой y (м): плоская — верх контейнера; скатная — по скату (без толщины кровли) */
  roofZ(y){
    const R=this.rise, W=this.We, t=Math.max(0, Math.min(W, y)); if (!(R>0)) return this.top;
    if (this.g.roof==='arch'){ const rc=this.arcR(); return this.top+R-rc+Math.sqrt(Math.max(0, rc*rc-(t-W/2)*(t-W/2))); }
    return this.top+(this.g.roof==='gable' ? R*(1-Math.abs(t-W/2)/(W/2)) : R*(1-t/W));
  }
  /** радиус дуги арочной крыши: хорда — ширина контейнера, стрела — подъём */
  arcR(){ const R=this.rise, h=this.We/2; return (h*h+R*R)/(2*R); }
  /** крыша блок-контейнера и цельносварного: плоская — с отливом; двускатная — конёк вдоль контейнера, фронтоны в торцах;
   *  односкатная — выше у стены с дверью, скат — к задней стене (вода не льётся на вход); арочная (покатая) — дуга поперёк
   *  контейнера; кровельные панели — с рёбрами по скату. Водостоков нет (над дверями — съёмные козырьки) */
  roof(zt, col){
    const L=this.Le, W=this.We, R=this.rise, m=this.M(StMat.paint(col, 0.45));
    if (!(R>0)){ m.box(-0.03, -0.03, zt-0.02, L+0.03, W+0.03, zt+0.03, 0.01); this.lugs(zt); return; }
    const o=0.06, t=0.04, rib=this.M(StMat.paint(RalColor.shade(col, 0.93), 0.45)), gb=this.M(StMat.paint(this.wall, 0.42)), gable=this.g.roof==='gable';
    if (this.g.roof==='arch'){ this.arch(zt, m, rib, gb, o, t); this.lugs(zt); return; }
    const slope=(ya, za, yb, zb)=>{ const dy=yb-ya, dz=zb-za, l=Math.hypot(dy, dz), s=Math.sign(dy), n=[0, -dz*s/l, dy*s/l], v=[0, dy, dz], w=StV.mul(n, t);
      m.obox([-o, ya, za], [L+2*o, 0, 0], v, w);
      for (let x=0.12; x<L+2*o-0.08; x+=0.333) rib.obox(StV.add([x-o, ya, za], w), [0.035, 0, 0], v, StV.mul(n, 0.028)); };
    if (gable){ const k=R/(W/2), ze=zt-o*k;
      slope(-o, ze, W/2, zt+R); slope(W+o, ze, W/2, zt+R);
      m.box(-o, W/2-0.09, zt+R+t*0.3, L+o, W/2+0.09, zt+R+t+0.02, 0.01);   // конёк
      for (const [x, n] of [[0, -1], [L, 1]]) gb.tri([x, 0, zt], [x, W, zt], [x, W/2, zt+R], [n, 0, 0]);
    } else { const k=R/W;
      slope(W+o, zt-o*k, -o, zt+R+o*k);
      for (const [x, n] of [[0, -1], [L, 1]]) gb.tri([x, 0, zt], [x, W, zt], [x, 0, zt+R], [n, 0, 0]);
      if (!this.cut) gb.quad([0, 0, zt], [L, 0, zt], [L, 0, zt+R], [0, 0, zt+R], [0, -1, 0]); }
    this.lugs(zt);
  }
  /** арочная крыша: лист по дуге (гладкие нормали) толщиной t со свесами o, рёбра по дуге, торцы под дугой — стеной */
  arch(zt, m, rib, gb, o, t){
    const L=this.Le, W=this.We, R=this.rise, rc=this.arcR(), zc=zt+R-rc, N=20;
    const P=[]; for (let k=0; k<=N; k++){ const y=-o+(W+2*o)*k/N, z=zc+Math.sqrt(Math.max(0, rc*rc-(y-W/2)*(y-W/2))), n=StV.norm([0, y-W/2, z-zc]); P.push({ y, z, n }); }
    const strip=(mesh, x0, x1, off, flip)=>{ for (let k=0; k<N; k++){ const a=P[k], b=P[k+1], q=(p, x)=>[x, p.y+p.n[1]*off, p.z+p.n[2]*off], s=flip ? -1 : 1, i=mesh.count;
      mesh.vert(q(a, x0), StV.mul(a.n, s)); mesh.vert(q(a, x1), StV.mul(a.n, s)); mesh.vert(q(b, x1), StV.mul(b.n, s)); mesh.vert(q(b, x0), StV.mul(b.n, s)); mesh.i.push(i, i+1, i+2, i, i+2, i+3); } };
    strip(m, -o, L+o, 0, false); strip(m, -o, L+o, -t, true);
    for (const [x, sx] of [[-o, -1], [L+o, 1]]) for (let k=0; k<N; k++){ const a=P[k], b=P[k+1];   // торцы листа
      m.quad([x, a.y, a.z], [x, b.y, b.z], [x, b.y-b.n[1]*t, b.z-b.n[2]*t], [x, a.y-a.n[1]*t, a.z-a.n[2]*t], [sx, 0, 0]); }
    for (let x=0.12; x<L+2*o-0.08; x+=0.333){ const x0=x-o, x1=x0+0.035; strip(rib, x0, x1, 0.026, false);
      for (const xs of [x0, x1]) for (let k=0; k<N; k++){ const a=P[k], b=P[k+1]; rib.quad([xs, a.y, a.z], [xs, b.y, b.z], [xs, b.y+b.n[1]*0.026, b.z+b.n[2]*0.026], [xs, a.y+a.n[1]*0.026, a.z+a.n[2]*0.026], [xs===x0 ? -1 : 1, 0, 0]); } }
    for (const [x, sx] of [[0, -1], [L, 1]]) for (let k=0; k<N; k++){ const a=P[k], b=P[k+1]; if (a.y<0 || b.y>W) continue;   // торец под дугой
      gb.tri([x, W/2, zt], [x, a.y, Math.max(zt, a.z-t)], [x, b.y, Math.max(zt, b.z-t)], [sx, 0, 0]); }
  }
  /** строповочные петли в верхних углах рамы (блок-контейнер, цельносварной): пластина с отверстием над крышей у угла */
  lugs(zt){
    const L=this.Le, W=this.We, m=this.M(StMat.paint(RalColor.shade(this.frame, 0.9), 0.45)), dk=this.M(StMat.paint('#15181b', 0.8));
    for (const x of [0.09, L-0.09]) for (const y of [0.05, W-0.05]){ const z0=this.rise>0 ? this.roofZ(y)+0.03 : zt+0.03;
      m.box(x-0.08, y-0.012, z0-0.02, x+0.08, y+0.012, z0+0.12, 0.008); dk.tube([x, y-0.015, z0+0.07], [x, y+0.015, z0+0.07], 0.03, 16); }
  }
  /** стена со стороны зрителя, когда она не срезана: панели между проёмами сервисных дверей, двери открыты */
  frontWall(w, z0, z1, prof){ this.wallWithDoors(w, z0, z1, prof, this.openF, 0, -1); }
  backWall(w, z0, z1, prof){ this.wallWithDoors(w, z0, z1, prof, this.doorsB, this.We, 1); }
  /** длинная стена (yw — наружная плоскость, out — наружу) с проёмами: панели (prof — гофр [шаг, глубина] или гладкие),
   *  обрамление, открытые наружу створки */
  wallWithDoors(w, z0, z1, prof, doors, yw, out){
    const L=this.Le, cuts=doors.map(d=>({ a:this.ox+d.x0/1000, b:this.ox+d.x1/1000, h:this.base+d.h/1000, n:d.leaves||1, kind:d.kind||'service', open:d.open!=null ? d.open : this.svc })).sort((p, q)=>p.a-q.a), wy=yw-out*0.03;
    const sheet=(a, b, za, zb)=>{ if (b<=a+0.005 || zb<=za) return; if (prof) w.corr(0, a, b, wy, out, za, zb, ...prof); else w.quad([a, yw-out*0.02, za], [b, yw-out*0.02, za], [b, yw-out*0.02, zb], [a, yw-out*0.02, zb], [0, out, 0]); };
    let x=0.16;
    for (const c of cuts){ sheet(x, c.a, z0, z1); sheet(c.a, c.b, c.h, z1); x=Math.max(x, c.b); }
    sheet(x, L-0.16, z0, z1);
    const fr=this.M(StMat.paint(this.frame, 0.45)), leaf=this.M(StMat.paint(this.wall, 0.45)), inner=this.M(StMat.paint(this.lining, 0.55)), dk=this.M(StMat.paint('#24292e', 0.55)), t=0.045, depth=this.oy+0.01;
    const y0=out<0 ? 0 : yw-depth, y1=out<0 ? depth : yw;
    for (const c of cuts){
      fr.box(c.a-0.05, y0, this.base-0.02, c.a, y1, c.h+0.05, 0.004); fr.box(c.b, y0, this.base-0.02, c.b+0.05, y1, c.h+0.05, 0.004); fr.box(c.a-0.05, y0, c.h, c.b+0.05, y1, c.h+0.05, 0.004);
      if (this.closed || !c.open){ this.shut(c, yw, out, leaf, dk); continue; }
      const lw=(c.b-c.a)/c.n, H=c.h-this.base-0.02;
      for (let k=0; k<c.n; k++){ const left=k===0, hx=left ? c.a : c.b, sx=left ? 1 : -1, ph=100*Math.PI/180;   // створка открыта наружу на 100°
        const d=[sx*Math.cos(ph)*lw, out*Math.sin(ph)*lw, 0], o=[hx, yw+out*0.005, this.base+0.01], thick=StV.mul(StV.norm([-d[1], d[0], 0]), t*(left ? 1 : -1)*(-out));
        leaf.obox(o, d, thick, [0, 0, H]);
        inner.obox(StV.add(o, StV.mul(thick, 1.02)), StV.mul(d, 0.96), StV.mul(thick, 0.06), [0, 0, H*0.98]);
        for (let i=0; i<6; i++){ const zz=this.base+H*(0.18+i*0.045); dk.obox(StV.add([hx, yw+out*0.005, zz], StV.mul(d, 0.2)), StV.mul(d, 0.6), StV.mul(thick, -0.15), [0, 0, 0.018]); }   // жалюзи створки
        const hp=StV.add([hx, yw+out*0.005, this.base+H*0.5], StV.mul(d, 0.9)); dk.obox(StV.add(hp, StV.mul(thick, -0.6)), StV.mul(StV.norm(d), 0.025), StV.mul(thick, -0.8), [0, 0, 0.2]);
        for (const z of [0.15, 0.85]) dk.tube([hx, yw+out*0.01, this.base+H*z], [hx, yw+out*0.01, this.base+H*z+0.12], 0.018, 10); }
      // откос проёма: утеплитель между обшивками
      const ins=this.M(StMat.paint(StScene.INS, 0.9)); ins.quad([c.a, y0, c.h], [c.b, y0, c.h], [c.b, y1, c.h], [c.a, y1, c.h], [0, 0, -1]);
    }
  }
  /** закрытая дверь в проёме (вид снаружи): полотно, ручка с замком, доводчик сверху на стороне петель (дверь открывается
   *  наружу), у сервисных — запорная штанга; у двери отсека бака — решётка внизу (приток воздуха в отсек) */
  shut(c, yw, out, leaf, dk){
    const t=0.045, z0=this.base+0.01, z1=c.h-0.005, lw=(c.b-c.a)/c.n, yo=yw+out*0.005, yi=yo+out*t, mt=this.M(StMat.metal('#c3c8cd', 0.3)), sm=this.M(StMat.paint(RalColor.shade(this.wall, 0.82), 0.5));
    for (let k=0; k<c.n; k++){ const a=c.a+k*lw+0.004, b=c.a+(k+1)*lw-0.004; leaf.box(a, Math.min(yo, yi), z0, b, Math.max(yo, yi), z1, 0.006);
      for (const z of [z0+0.12, z1-0.12]) sm.box(a+0.05, Math.min(yi, yi+out*0.003), z-0.004, b-0.05, Math.max(yi, yi+out*0.003), z+0.004); }   // рёбра полотна
    const hingeA=c.n===1 ? c.a : null, lock=c.n===1 ? c.b-0.09 : (c.a+c.b)/2+0.06, zh=this.base+1.0, yf=yi+out*0.004;
    if (c.kind==='service'){ for (const x of c.n===1 ? [lock] : [(c.a+c.b)/2-0.07, lock]){ mt.tube([x, yf+out*0.02, z0+0.08], [x, yf+out*0.02, z1-0.08], 0.012, 10);
        dk.box(x-0.03, Math.min(yf, yf+out*0.05), zh-0.12, x+0.03, Math.max(yf, yf+out*0.05), zh+0.12, 0.005); } return; }
    // ручка-скоба с замком
    dk.box(lock-0.025, Math.min(yf, yf+out*0.012), zh-0.09, lock+0.025, Math.max(yf, yf+out*0.012), zh+0.09, 0.006);
    mt.box(lock-0.13, Math.min(yf+out*0.035, yf+out*0.055), zh+0.03, lock+0.01, Math.max(yf+out*0.035, yf+out*0.055), zh+0.05, 0.008);
    mt.box(lock-0.008, Math.min(yf, yf+out*0.055), zh+0.025, lock+0.012, Math.max(yf, yf+out*0.055), zh+0.055, 0.004);
    mt.tube([lock, yf, zh-0.05], [lock, yf+out*0.015, zh-0.05], 0.011, 12);
    // доводчик — всегда внутри: корпус у петель со стороны помещения, рычаг к верху коробки
    if (hingeA!=null){ const x=hingeA+0.07, zc=z1-0.07, si=-out, yin=yw+si*this.oy, bd=this.M(StMat.metal('#9aa1a8', 0.35));
      bd.box(x, Math.min(yin, yin+si*0.06), zc-0.035, x+0.27, Math.max(yin, yin+si*0.06), zc+0.035, 0.012);
      const p0=[x+0.24, yin+si*0.05, zc+0.01], p1=[x+0.4, yin+si*0.07, zc+0.02], p2=[x+0.46, yin+si*0.03, c.h+0.03];
      dk.tube(p0, p1, 0.009, 8); dk.sphere(p1, 0.012, 8); dk.tube(p1, p2, 0.008, 8); }
    if (c.kind==='tank') for (let i=0; i<7; i++){ const z=z0+0.12+i*0.045; dk.box(c.a+0.12, Math.min(yf, yf+out*0.012), z, c.b-0.12, Math.max(yf, yf+out*0.012), z+0.022); }   // решётка внизу
  }
  /** обшивка изнутри стены с проёмами */
  holes(m, y, n, doors, b, c){
    const cuts=doors.map(d=>[this.ox+d.x0/1000, this.ox+d.x1/1000, this.base+d.h/1000]).sort((p, q)=>p[0]-q[0]);
    let x=this.ox; const q=(a, z, za, zb)=>{ if (z>a+0.005 && zb>za) m.quad([a, y, za], [z, y, za], [z, y, zb], [a, y, zb], [0, n, 0]); };
    for (const [a, z, h] of cuts){ q(x, a, b, c); q(a, z, h, c); x=Math.max(x, z); }
    q(x, this.ox+this.Li, b, c);
  }
  /** ворота в торце блок-контейнера (два ряда оборудования — дверь в торце) */
  /** в торцах блок-контейнера: распашные ворота для демонтажа (plan.gates) и одностворчатая дверь оператора (plan.entry в
   *  торце) — полотна поверх торцевой стены, ручки; у морского — его штатные двери (cargoDoors) */
  endDoors(){
    const P=this.plan, G=P.gates, en=P.entry;
    if (G && !G.sea) this.endLeaves(G, G.wall, 2);
    if (en && en.wall==='left' && !en.sea) this.endLeaves(en, 'left', 1);
  }
  /** створки в торце side ('left' — x = 0, 'right' — x = Le): проём d.y0…d.y1 (мм внутри), высота d.h от пола; n — створок */
  endLeaves(d, side, n){
    const s=side==='left' ? -1 : 1, xw=side==='left' ? 0 : this.Le, y0=this.oy+d.y0/1000, w=(d.y1-d.y0)/1000, lw=w/n, z0=this.base, z1=this.base+d.h/1000;
    const lf=this.M(StMat.paint(RalColor.shade(this.wall, 0.95), 0.45)), dk=this.M(StMat.paint('#23272b', 0.6)), fr=this.M(StMat.paint(RalColor.shade(this.frame, 0.9), 0.45));
    const X=(a, b)=>[Math.min(xw+s*a, xw+s*b), Math.max(xw+s*a, xw+s*b)];
    const [fa, fb]=X(0, 0.03); fr.box(fa, y0-0.05, z0, fb, y0, z1+0.05); fr.box(fa, y0+w, z0, fb, y0+w+0.05, z1+0.05); fr.box(fa, y0-0.05, z1, fb, y0+w+0.05, z1+0.05);   // коробка
    const [la, lb]=X(0, 0.025); for (let i=0; i<n; i++) lf.box(la, y0+lw*i+0.004, z0+0.01, lb, y0+lw*(i+1)-0.004, z1-0.004, 0.004);
    const [ha, hb]=X(0.025, 0.055), yh=n>1 ? [y0+w/2-0.08, y0+w/2+0.06] : [y0+w-0.12];
    for (const y of yh) dk.box(ha, y, z0+0.95, hb, y+0.02, z0+1.15, 0.004);   // ручки (у ворот — запорные, по сторонам притвора)
    if (n>1){ const mt=this.M(StMat.metal('#c3c8cd', 0.3)), [ba, bb]=X(0.04, 0.06); for (const y of [y0+w/2-0.07, y0+w/2+0.05]) mt.box(ba, y, z0+0.08, bb, y+0.02, z1-0.08, 0.004); }   // запорные штанги
  }

  /** внутри: обшивка стен и потолка, пол из рифлёного листа, разрез стены со стороны зрителя (утеплитель) */
  inside(){
    const ox=this.ox, oy=this.oy, Li=this.Li, Wi=this.Wi, b=this.base, c=this.ceil, lin=this.M(StMat.paint(this.lining, 0.6)), sea=this.g.sea;
    if (!this.doorsB.length) lin.quad([ox, oy+Wi, b], [ox+Li, oy+Wi, b], [ox+Li, oy+Wi, c], [ox, oy+Wi, c], [0, -1, 0]);
    lin.quad([ox+Li, oy, b], [ox+Li, oy+Wi, b], [ox+Li, oy+Wi, c], [ox+Li, oy, c], [-1, 0, 0]);
    lin.quad([ox, oy, b], [ox, oy+Wi, b], [ox, oy+Wi, c], [ox, oy, c], [1, 0, 0]);
    lin.quad([ox, oy, c], [ox+Li, oy, c], [ox+Li, oy+Wi, c], [ox, oy+Wi, c], [0, 0, -1]);
    if (!this.cut) this.holes(lin, oy, 1, this.openF, b, c);
    if (this.doorsB.length) this.holes(lin, oy+Wi, -1, this.doorsB, b, c);
    // швы обшивки
    const sm=this.M(StMat.paint(RalColor.shade(this.lining, 0.86), 0.6)), step=sea ? 1.2 : 1.15;
    for (let x=ox+step; x<ox+Li-0.2; x+=step){ sm.box(x-0.004, oy+Wi-0.004, b, x+0.004, oy+Wi, c); sm.box(x-0.004, oy, c-0.004, x+0.004, oy+Wi, c); }
    // пол
    const F=StationGeo.FLOORS[this.g.floor] || StationGeo.FLOORS.steel, fl=this.M({ c:F.color, r:F.r, m:F.m, k:1 });   // рифлёный лист: сталь чёрная или алюминий
    fl.quad([ox, oy, b], [ox+Li, oy, b], [ox+Li, oy+Wi, b], [ox, oy+Wi, b], [0, 0, 1]);
    // разрез на месте срезанной стены: крыша, пол и торцевые стены в сечении — утеплитель между обшивками
    if (this.cut){ const ins=this.M(StMat.paint(StScene.INS, 0.9)), y=0.002, n=[0, -1, 0], x0=0.15, x1=this.Le-0.15, zr=this.g.roof==='mono' && this.rise>0 ? this.top+this.rise : this.top-(this.g.sea ? 0.11 : 0.1);
      if (zr>c) ins.quad([x0, y, c], [x1, y, c], [x1, y, zr], [x0, y, zr], n);
      if (b>this.dz+0.16) ins.quad([x0, y, this.dz+0.16], [x1, y, this.dz+0.16], [x1, y, b], [x0, y, b], n);
      for (const [a, z] of [[x0, ox], [this.Le-ox, x1]]) if (z>a) ins.quad([a, y, b], [z, y, b], [z, y, c], [a, y, c], n); }
    // тамбур «Север»: перегородка с дверью (после отсека бака, если он есть)
    const fu=this.plan.fuel, tamb=(this.g.x0||0)-(fu ? fu.x1+fu.part : 0);
    if (tamb>0){ const x=ox+this.g.x0/1000, d=this.M(StMat.paint(this.lining, 0.55)), dw=this.M(StMat.paint(RalColor.shade(this.wall, 0.95), 0.45));
      d.box(x-0.06, oy, b, x, oy+Wi-1.0, c); d.box(x-0.06, oy+Wi-0.1, b, x, oy+Wi, c); d.box(x-0.06, oy+Wi-1.0, b+2.0, x, oy+Wi-0.1, c);
      dw.box(x-0.05, oy+Wi-0.98, b, x-0.01, oy+Wi-0.12, b+1.98, 0.004);
      const cl=this.M(StMat.metal('#9aa1a8', 0.35)), dk=this.M(StMat.paint('#24292e', 0.55)); cl.box(x-0.11, oy+Wi-0.92, b+1.84, x-0.05, oy+Wi-0.65, b+1.91, 0.01);   // доводчик
      dk.tube([x-0.09, oy+Wi-0.68, b+1.9], [x-0.12, oy+Wi-0.55, b+1.94], 0.008, 8); dk.tube([x-0.12, oy+Wi-0.55, b+1.94], [x-0.07, oy+Wi-0.5, b+2.0], 0.008, 8); }
  }

  /** жалюзи в стене: along 1 — в торце (x = w), 0 — в длинной стене (y = w); out — наружу (±1) */
  louver(along, w, u0, u1, z0, z1, out){
    const fr=this.M(StMat.paint('#8f969d', 0.5)), sl=this.M(StMat.paint('#5d646b', 0.55)), n=Math.max(3, Math.round((z1-z0)/0.07)), P=(u, o, z)=>along===1 ? [w+out*o, u, z] : [u, w+out*o, z];
    const B=(a, b)=>{ const lo=a.map((v, k)=>Math.min(v, b[k])), hi=a.map((v, k)=>Math.max(v, b[k])); return [...lo, ...hi]; };
    fr.box(...B(P(u0-0.04, 0, z0-0.04), P(u1+0.04, 0.03, z0))); fr.box(...B(P(u0-0.04, 0, z1), P(u1+0.04, 0.03, z1+0.04)));
    fr.box(...B(P(u0-0.04, 0, z0), P(u0, 0.03, z1))); fr.box(...B(P(u1, 0, z0), P(u1+0.04, 0.03, z1)));
    for (let i=0; i<n; i++){ const z=z0+(z1-z0)*(i+0.5)/n; sl.quad(P(u0, 0.035, z+0.018), P(u1, 0.035, z+0.018), P(u1, 0.005, z-0.018), P(u0, 0.005, z-0.018)); }
  }
  // ---- оборудование
  equip(it){
    if (it.mount==='wall' && it.wall==='front' && this.cut) return;   // на стене со стороны зрителя: срезана вместе со стеной (на чертеже — есть)
    this.body(it); this.badge(it);
  }
  body(it){
    const k=it.kind;
    if (k==='cabinet') return this.cabinet(it);
    if (it.mount==='pipe') return this.filter(it);
    if (k==='receiver') return it.shape==='hcyl' ? this.receiverH(it) : this.receiver(it);
    if (k==='compressor') return this.compressor(it);
    if (k==='dryer') return /адсорбц/i.test(it.name) ? this.dryerAds(it) : this.dryer(it);
    if (k==='pump') return this.pump(it);
    if (k==='dgu') return this.dgu(it);
    if (k==='tank') return this.tank(it);
    if (k==='filter') return this.receiver(it);
    return this.other(it);
  }
  /** габарит в мире: [x0, y0, z0, x1, y1, z1] и сторона обслуживания (−1 — к стене прохода, 1 — к задней) */
  B(it){ const a=this.P(it.x, it.y, it.z||0), b=this.P(it.x+it.lx, it.y+it.ly, (it.z||0)+it.h); return [...a, ...b]; }
  side(it){ return it.face>0 ? 1 : -1; }
  /** лицевая сторона вдоль торца (шкаф на торцевой стене: face ±2) */
  endwise(it){ return Math.abs(it.face)===2; }
  /** наружу от лицевой стороны на k, м */
  out(it, k){ const s=this.side(it)*k; return this.endwise(it) ? [s, 0, 0] : [0, s, 0]; }
  /** точка на лицевой стороне: u — доля длины, v — доля высоты, o — выступ наружу, м */
  front(it, u, v, o=0){ const [x0, y0, z0, x1, y1, z1]=this.B(it), s=this.side(it);
    return this.endwise(it) ? [(s<0 ? x0 : x1)+s*o, y0+(y1-y0)*u, z0+(z1-z0)*v] : [x0+(x1-x0)*u, (s<0 ? y0 : y1)+s*o, z0+(z1-z0)*v]; }
  /** прямоугольник на лицевой стороне: u0…u1, v0…v1, толщина o (наружу) */
  panel(m, it, u0, u1, v0, v1, o, r=0.003){ const a=this.front(it, u0, v0, 0), b=this.front(it, u1, v1, o);
    m.box(Math.min(a[0], b[0]), Math.min(a[1], b[1]), a[2], Math.max(a[0], b[0]), Math.max(a[1], b[1]), b[2], r); }
  /** решётка: горизонтальные ламели на лицевой стороне или торце (end: −1 — торец x0, 1 — x1) */
  grille(it, u0, u1, v0, v1, n, end){
    const m=this.M(StMat.paint('#24292e', 0.7)), [x0, y0, z0, x1, y1, z1]=this.B(it);
    for (let i=0; i<n; i++){ const v=v0+(v1-v0)*(i+0.25)/n, v2=v0+(v1-v0)*(i+0.7)/n;
      if (end){ const x=end<0 ? x0 : x1, o=end*0.006; m.box(Math.min(x, x+o), y0+(y1-y0)*u0, z0+(z1-z0)*v, Math.max(x, x+o), y0+(y1-y0)*u1, z0+(z1-z0)*v2); }
      else this.panel(m, it, u0, u1, v, v2, 0.006, 0); }
  }

  compressor(it){
    const [x0, y0, z0, x1, y1, z1]=this.B(it), c=it.color, body=this.M(StMat.paint(c, 0.42)), dk=this.M(StMat.paint(StScene.DARK, 0.65)), hb=Math.min(0.1, (z1-z0)*0.07);
    dk.box(x0+0.02, y0+0.02, z0, x1-0.02, y1-0.02, z0+hb, 0.005);
    for (const u of [0.18, 0.72]) this.panel(this.M(StMat.paint('#15181b', 0.8)), it, u, u+0.1, 0.012, 0.055, 0.001, 0);   // карманы под вилы
    body.box(x0, y0, z0+hb, x1, y1, z1, 0.018);
    const sm=this.M(StMat.paint(RalColor.shade(c, 0.7), 0.6));   // швы панелей, ручки
    for (const u of [0.34, 0.67]) this.panel(sm, it, u-0.002, u+0.002, 0.08, 0.97, 0.002, 0);
    for (const u of [0.31, 0.64]) this.panel(dk, it, u-0.012, u-0.004, 0.5, 0.62, 0.012, 0.002);
    // пульт: экран, кнопка аварийной остановки
    this.panel(this.M(StMat.paint('#30363d', 0.4)), it, 0.72, 0.95, 0.66, 0.9, 0.012, 0.004);
    this.panel(this.M(StMat.glow('#8fc7ff', 1.6)), it, 0.75, 0.87, 0.73, 0.85, 0.014, 0);
    const eb=this.front(it, 0.91, 0.72, 0.012); this.M(StMat.paint('#c0262d', 0.35)).tube(eb, StV.add(eb, [0, this.side(it)*0.025, 0]), 0.02, 14);
    this.grille(it, 0.38, 0.62, 0.15, 0.6, 8); this.grille(it, 0.2, 0.8, 0.2, 0.75, 9, -1); this.grille(it, 0.2, 0.8, 0.2, 0.75, 9, 1);
    // выход горячего воздуха вверху и воздуховод к задней стене под потолком
    const cx=(x0+x1)/2, cy=(y0+y1)/2, dw=Math.min((x1-x0)*0.45, 0.9), dd=Math.min((y1-y0)*0.45, 0.65), dh=Math.min(0.38, this.ceil-0.09-z1-0.06);
    dk.box(cx-dw/2, cy-dd/2, z1, cx+dw/2, cy+dd/2, z1+0.006);
    if (dh>=0.18){ const g=this.M(StMat.metal(StScene.GALV, 0.42)), zt=this.ceil-0.09, zd=zt-dh, yW=this.oy+this.Wi, toBack=this.side(it)<0;
      g.box(cx-dw/2, cy-dd/2, z1, cx+dw/2, cy+dd/2, zd, 0.004);
      if (toBack){ g.box(cx-dw/2, cy-dd/2, zd, cx+dw/2, yW, zt, 0.004); this.louver(0, yW, cx-dw/2-0.07, cx+dw/2+0.07, zd-0.07, Math.min(this.ceil, zt+0.07), 1); }
      else { g.box(cx-dw/2, cy-dd/2, zd, cx+dw/2, cy+dd/2, zt, 0.004); } }
  }
  dryer(it){
    const [x0, y0, z0, x1, y1, z1]=this.B(it), c=it.color, body=this.M(StMat.paint(c, 0.4)), dk=this.M(StMat.paint(StScene.DARK, 0.6));
    dk.box(x0+0.02, y0+0.02, z0, x1-0.02, y1-0.02, z0+0.05, 0.004); body.box(x0, y0, z0+0.05, x1, y1, z1, 0.016);
    this.panel(this.M(StMat.paint('#2c3238', 0.4)), it, 0.1, 0.42, 0.72, 0.9, 0.01, 0.004); this.panel(this.M(StMat.glow('#9fe0a6', 1.2)), it, 0.13, 0.25, 0.77, 0.85, 0.012, 0);
    this.grille(it, 0.1, 0.9, 0.12, 0.5, 7); this.grille(it, 0.15, 0.85, 0.2, 0.7, 7, 1);
    const g=this.M(StMat.metal(StScene.GALV, 0.35)), s=this.side(it), yb=s<0 ? y1-0.12 : y0+0.12;
    for (const u of [0.25, 0.75]){ const x=x0+(x1-x0)*u; g.tube([x, yb, z1], [x, yb, z1+0.08], 0.03, 14); g.tube([x, yb, z1+0.06], [x, yb, z1+0.08], 0.055, 16); }
  }
  dryerAds(it){
    const [x0, y0, z0, x1, y1, z1]=this.B(it), c=it.color, tw=this.M(StMat.paint(c, 0.38)), dk=this.M(StMat.paint(StScene.DARK, 0.6)), g=this.M(StMat.metal(StScene.GALV, 0.35));
    dk.box(x0, y0, z0, x1, y1, z0+0.08, 0.004); const r=Math.min((x1-x0)/4.6, (y1-y0)/2.3), yc=(y0+y1)/2;
    for (const u of [0.27, 0.73]){ const x=x0+(x1-x0)*u; tw.tube([x, yc, z0+0.15], [x, yc, z1-r*0.5-0.12], r, 28, [true, false]); tw.dish(x, yc, z1-r*0.5-0.12, r, 1); }
    g.box(x0+(x1-x0)*0.2, yc-0.05, z1-0.14, x0+(x1-x0)*0.8, yc+0.05, z1-0.05, 0.01); g.box(x0+(x1-x0)*0.2, yc-0.05, z0+0.1, x0+(x1-x0)*0.8, yc+0.05, z0+0.2, 0.01);
    const p=this.front(it, 0.5, 0.55, 0); this.M(StMat.paint('#d8dcdf', 0.4)).box(p[0]-0.15, Math.min(p[1], p[1]+this.side(it)*0.15), p[2]-0.2, p[0]+0.15, Math.max(p[1], p[1]+this.side(it)*0.15), p[2]+0.2, 0.01);
  }
  receiver(it){
    const [x0, y0, z0, x1, y1, z1]=this.B(it), c=it.color, m=this.M(StMat.paint(c, 0.38)), dk=this.M(StMat.paint(StScene.DARK, 0.6)), cx=(x0+x1)/2, cy=(y0+y1)/2;
    const r=Math.min(x1-x0, y1-y0)/2, leg=Math.min(0.22, (z1-z0)*0.1), zb=z0+leg+r*0.5, zt=z1-r*0.5;
    for (const a of [0.5, 2.6, 4.7]) dk.tube([cx+Math.cos(a)*r*0.7, cy+Math.sin(a)*r*0.7, z0], [cx+Math.cos(a)*r*0.7, cy+Math.sin(a)*r*0.7, zb-r*0.2], 0.025, 10);
    m.tube([cx, cy, zb], [cx, cy, zt], r, 36, [false, false]); m.dish(cx, cy, zt, r, 1, 36); m.dish(cx, cy, zb, r, -1, 36);
    const s=this.side(it), br=this.M(StMat.metal('#b8924f', 0.35)), g=this.M(StMat.metal(StScene.GALV, 0.35));
    br.tube([cx, cy, z1-0.02], [cx, cy, z1+0.07], 0.02, 12); br.sphere([cx, cy, z1+0.09], 0.025, 10);       // предохранительный клапан
    g.tube([cx, cy+s*r, (zb+zt)/2], [cx, cy+s*(r+0.1), (zb+zt)/2], 0.12, 20); g.tube([cx, cy+s*(r+0.09), (zb+zt)/2], [cx, cy+s*(r+0.11), (zb+zt)/2], 0.15, 20);   // люк
    const gz=zb+(zt-zb)*0.8, gp=[cx+r*0.7, cy+s*r*0.72, gz]; dk.tube(gp, StV.add(gp, [0, s*0.03, 0]), 0.05, 18); this.M(StMat.paint('#f4f4f2', 0.3)).tube(StV.add(gp, [0, s*0.03, 0]), StV.add(gp, [0, s*0.032, 0]), 0.043, 18);
    g.tube([cx, cy, zb-r*0.5], [cx, cy, z0+0.03], 0.012, 8);
  }
  receiverH(it){
    const [x0, y0, z0, x1, y1, z1]=this.B(it), m=this.M(StMat.paint(it.color, 0.38)), dk=this.M(StMat.paint(StScene.DARK, 0.6)), cy=(y0+y1)/2, r=Math.min(y1-y0, z1-z0)/2*0.95, cz=z1-r;
    for (const u of [0.18, 0.82]){ const x=x0+(x1-x0)*u; dk.box(x-0.05, cy-r*0.7, z0, x+0.05, cy+r*0.7, cz-r*0.3, 0.004); }
    m.tube([x0+r*0.4, cy, cz], [x1-r*0.4, cy, cz], r, 36, [false, false]);
    for (const [x, s] of [[x0+r*0.4, -1], [x1-r*0.4, 1]]){ const seg=24, k0=m.count, rows=8;
      for (let i=0; i<=rows; i++){ const a=i/rows*Math.PI/2, rr=r*Math.cos(a), xx=x+s*r*0.4*Math.sin(a); for (let j=0; j<=seg; j++){ const ph=j/seg*Math.PI*2; m.vert([xx, cy+rr*Math.cos(ph), cz+rr*Math.sin(ph)], StV.norm([s*Math.sin(a)/0.4, Math.cos(a)*Math.cos(ph), Math.cos(a)*Math.sin(ph)])); } }
      for (let i=0; i<rows; i++) for (let j=0; j<seg; j++){ const a=k0+i*(seg+1)+j, b=a+seg+1; m.i.push(a, b, a+1, a+1, b, b+1); } }
  }
  /** магистральный фильтр на трубе: головка на оси трубы, колба вниз, дренаж, манометр */
  filter(it){
    const [x0, y0, z0, x1, y1, z1]=this.B(it), cx=(x0+x1)/2, cy=(y0+y1)/2, w=x1-x0, hh=Math.max(0.05, (z1-z0)*0.14);
    const head=this.M(StMat.metal('#b6bcc2', 0.32)), bowl=this.M(StMat.paint(it.color, 0.35)), dk=this.M(StMat.paint(StScene.DARK, 0.6));
    head.box(cx-w*0.55, cy-w*0.45, z1-hh, cx+w*0.55, cy+w*0.45, z1, 0.006);
    bowl.tube([cx, cy, z1-hh], [cx, cy, z0+0.06], w*0.4, 24, [false, true], w*0.36);
    this.M(StMat.paint('#2f6db3', 0.4)).tube([cx, cy, z1-hh-0.03], [cx, cy, z1-hh-0.07], w*0.41, 24, [false, false]);   // метка ступени очистки
    dk.tube([cx, cy, z0+0.06], [cx, cy, z0], 0.012, 10);
    const s=this.side(it), gp=[cx, cy+s*w*0.45, z1-hh/2]; dk.tube(gp, StV.add(gp, [0, s*0.02, 0]), Math.min(0.03, hh*0.4), 14);
  }
  pump(it){
    const [x0, y0, z0, x1, y1, z1]=this.B(it), L=x1-x0, W=y1-y0, H=z1-z0, c=it.color, dk=this.M(StMat.paint(StScene.DARK, 0.6)), mot=this.M(StMat.paint(c, 0.38)), cast=this.M(StMat.paint(RalColor.shade(c, 0.78), 0.5));
    const fin=this.M(StMat.paint(RalColor.shade(c, 0.85), 0.45)), cy=(y0+y1)/2;
    if (H>L*1.2){   // вертикальный многоступенчатый: основание, проточная часть, двигатель сверху
      const r=Math.min(L, W)*0.32, cx=(x0+x1)/2, zb=z0+H*0.12, zm=z0+H*0.58;
      cast.box(x0+L*0.05, y0+W*0.1, z0, x1-L*0.05, y1-W*0.1, zb, 0.01);
      for (const s of [-1, 1]){ cast.tube([cx+s*L*0.42, cy, zb*0.5+z0*0.5], [cx+s*L*0.5, cy, zb*0.5+z0*0.5], r*0.55, 18); cast.tube([cx+s*L*0.49, cy, zb*0.5+z0*0.5], [cx+s*L*0.5, cy, zb*0.5+z0*0.5], r*0.8, 18); }
      this.M(StMat.metal(StScene.INOX, 0.28)).tube([cx, cy, zb], [cx, cy, zm], r*0.8, 28);
      cast.tube([cx, cy, zm], [cx, cy, zm+H*0.05], r*1.05, 28);
      mot.tube([cx, cy, zm+H*0.05], [cx, cy, z1-H*0.06], r*1.1, 32); for (let z=zm+H*0.09; z<z1-H*0.1; z+=H*0.035) fin.tube([cx, cy, z], [cx, cy, z+0.006], r*1.17, 32);
      dk.tube([cx, cy, z1-H*0.06], [cx, cy, z1], r*1.05, 28);
      return; }
    // горизонтальный: рама, двигатель с рёбрами и кожухом вентилятора, защита муфты, улитка насоса
    dk.box(x0, y0+W*0.08, z0, x1, y1-W*0.08, z0+Math.min(0.12, H*0.14), 0.004);
    const zc=z0+H*0.52, r=Math.min(W*0.42, H*0.36), xm0=x0+L*0.04, xm1=x0+L*0.52;
    mot.tube([xm0+0.05, cy, zc], [xm1, cy, zc], r, 32); for (let x=xm0+0.08; x<xm1-0.03; x+=0.045) fin.tube([x, cy, zc], [x+0.008, cy, zc], r*1.08, 32);
    dk.tube([xm0, cy, zc], [xm0+0.06, cy, zc], r*1.03, 32);
    mot.box(xm0+L*0.12, cy-r*0.55, zc+r*0.85, xm0+L*0.24, cy+r*0.55, zc+r*1.1, 0.005);   // клеммная коробка
    for (const x of [xm0+0.08, xm1-0.08]) mot.box(x-0.03, cy-r*0.8, z0+0.1, x+0.03, cy+r*0.8, zc-r*0.75, 0.004);
    this.M(StMat.paint('#e8a317', 0.4)).box(xm1, cy-r*0.45, zc-r*0.45, x0+L*0.66, cy+r*0.45, zc+r*0.45, 0.01);
    const xp=x0+L*0.8, rv=Math.min(r*1.25, H*0.45);
    cast.tube([xp-L*0.08, cy, zc], [xp+L*0.06, cy, zc], rv, 32);
    cast.tube([xp+L*0.06, cy, zc], [x1-0.01, cy, zc], rv*0.42, 20); cast.tube([x1-0.04, cy, zc], [x1, cy, zc], rv*0.62, 20);      // всас
    cast.tube([xp, cy, zc+rv*0.8], [xp, cy, Math.min(z1, zc+rv+0.12)], rv*0.36, 20); cast.tube([xp, cy, Math.min(z1, zc+rv+0.12)-0.03], [xp, cy, Math.min(z1, zc+rv+0.12)], rv*0.55, 20);   // напор
    dk.box(xp-0.04, cy-rv*0.5, z0+0.1, xp+0.04, cy+rv*0.5, zc-rv*0.7, 0.004);
  }
  /** ДГУ открытого исполнения: рама-бак, генератор (цилиндр на лапах, клеммная коробка), двигатель (блок, головка, крышка
   *  клапанов, поддон, выпускной коллектор и турбина, воздушный фильтр), вентилятор и радиатор к жалюзи, пульт на стойке;
   *  глушитель на крыше — выхлоп от турбины через сильфон вверх */
  dgu(it){
    const [x0, y0, z0, x1, y1, z1]=this.B(it), L=x1-x0, W=y1-y0, H=z1-z0, cy=(y0+y1)/2, s=this.side(it), c=it.color;
    const body=this.M(StMat.paint(c, 0.4)), dk=this.M(StMat.paint(StScene.DARK, 0.6)), alt=this.M(StMat.paint('#4a5259', 0.42)), cap=this.M(StMat.paint(RalColor.shade(c, 0.62), 0.42)), st=this.M(StMat.metal('#8d949a', 0.45));
    const fb=z0+H*0.13; dk.box(x0, y0, z0, x1, y1, fb, 0.006);                                   // рама-бак
    dk.tube([x0+L*0.08, y0+W*0.18, fb], [x0+L*0.08, y0+W*0.18, fb+0.04], 0.05, 16);              // горловина бака
    // генератор
    const xa=x0+L*0.03, xb=x0+L*0.34, R=Math.min(W*0.36, H*0.3), zc=fb+R+0.04;
    for (const x of [xa+0.08, xb-0.16]) dk.box(x, cy-R*0.8, fb, x+0.08, cy+R*0.8, zc-R*0.5, 0.004);
    alt.tube([xa+0.03, cy, zc], [xb, cy, zc], R, 36); alt.tube([xa, cy, zc], [xa+0.03, cy, zc], R*0.86, 36);
    for (let k=0; k<5; k++){ const z=zc-R*0.45+k*R*0.2; dk.box(xa-0.004, cy-R*0.5, z, xa+0.002, cy+R*0.5, z+R*0.08); }   // решётка торца
    alt.box(xa+(xb-xa)*0.35, cy-R*0.42, zc+R*0.8, xb-(xb-xa)*0.12, cy+R*0.42, zc+R+0.1, 0.01);  // клеммная коробка
    // двигатель
    const xr=x0+L*0.84, wb=W*0.62, zb=z0+H*0.6, zh=zb+H*0.1, zv=zh+H*0.05;
    dk.box(xb+0.05, cy-wb*0.38, fb, xr-0.06, cy+wb*0.38, fb+H*0.1, 0.01);                        // поддон
    body.box(xb, cy-wb/2, fb+H*0.08, xr-0.02, cy+wb/2, zb, 0.02);                                // блок
    body.box(xb+0.05, cy-wb*0.38, zb, xr-0.08, cy+wb*0.38, zh, 0.015);                           // головка
    cap.box(xb+0.08, cy-wb*0.26, zh, xr-0.12, cy+wb*0.26, zv, 0.02);                             // крышка клапанов
    for (const x of [xb+0.1, xr-0.2]) dk.box(x, cy-W*0.4, fb, x+0.1, cy+W*0.4, fb+H*0.1, 0.004); // опоры
    const ex=(this.plan.roof||[]).map(m=>m.exhaust).find(e=>e && e.x>=it.x && e.x<=it.x+it.lx), tx=ex ? this.ox+ex.x/1000 : xr-0.3;
    const yb=cy-s*wb*0.56, zx=zb+H*0.02, rt=Math.min(0.12, H*0.065);                             // выпуск — со стороны от прохода
    st.tube([xb+0.12, yb, zx], [tx, yb, zx], Math.min(0.055, H*0.03), 16); st.sphere([tx, yb, zx], rt*0.7, 14);
    st.tube([tx, yb, zx], [tx, cy, zv+rt], rt*0.45, 16); st.sphere([tx, cy, zv+rt], rt, 18);     // турбина
    if (ex){ const zt=zv+rt*1.6; for (let z=zt; z<z1-0.03; z+=0.03) st.tube([tx, cy, z], [tx, cy, z+0.018], rt*0.62, 18); }   // сильфон к глушителю
    this.M(StMat.paint('#1f2328', 0.55)).tube([xb+L*0.08, cy+s*wb*0.18, zh], [xb+L*0.08, cy+s*wb*0.18, zv+H*0.14], Math.min(0.14, W*0.12), 24);   // воздушный фильтр
    // вентилятор и радиатор
    dk.tube([xr-0.06, cy, fb+(z1-fb)*0.5], [xr, cy, fb+(z1-fb)*0.5], Math.min(W*0.42, (z1-fb)*0.42), 32);   // кожух вентилятора
    body.box(xr, y0+W*0.04, fb, x1, y1-W*0.04, z1, 0.02);                                        // радиатор
    this.grille({ ...it, x:it.x+it.lx*0.84, lx:it.lx*0.16 }, 0.08, 0.92, 0.12, 0.92, 12, 1);
    dk.tube([x1-L*0.08, cy, z1], [x1-L*0.08, cy, z1+0.04], 0.04, 14);                            // пробка радиатора
    // пульт на стойке над генератором
    const py=s<0 ? y0+W*0.12 : y1-W*0.12;
    dk.box(xa+L*0.06, py-0.02, zc+R, xa+L*0.08, py+0.02, z0+H*0.78); dk.box(xa+L*0.02, Math.min(py, py+s*0.14), z0+H*0.78, xa+L*0.2, Math.max(py, py+s*0.14), z0+H*0.97, 0.01);
    this.M(StMat.glow('#9fd4ff', 1.2)).box(xa+L*0.05, s<0 ? py-0.002+s*0.14 : py+0.14, z0+H*0.86, xa+L*0.13, s<0 ? py+s*0.14 : py+0.142, z0+H*0.93);
  }
  tank(it){
    const [x0, y0, z0, x1, y1, z1]=this.B(it), m=this.M(StMat.paint(it.color, 0.42)), dk=this.M(StMat.paint(StScene.DARK, 0.6));
    dk.box(x0-0.02, y0-0.02, z0, x1+0.02, y1+0.02, z0+0.06, 0.004); m.box(x0, y0, z0+0.06, x1, y1, z1, 0.03);
    dk.tube([x0+(x1-x0)*0.2, (y0+y1)/2, z1], [x0+(x1-x0)*0.2, (y0+y1)/2, z1+0.09], 0.07, 20);
    this.M(StMat.metal(StScene.GALV, 0.35)).tube([x0+(x1-x0)*0.75, (y0+y1)/2, z1], [x0+(x1-x0)*0.75, (y0+y1)/2, z1+0.15], 0.015, 10);
    const lv=this.front(it, 0.88, 0.15, 0.015); this.M(StMat.paint('#d9e0e6', 0.15)).box(lv[0]-0.015, Math.min(lv[1], lv[1]-this.side(it)*0.015), lv[2], lv[0]+0.015, Math.max(lv[1], lv[1]-this.side(it)*0.015), lv[2]+(z1-z0)*0.7);
  }
  /** шкаф: корпус, дверь, ручка, петли; АСУ ТП — панель оператора, АВР — лампы и переключатель; настенный — кронштейны,
   *  на раме — стойки, напольный — цоколь */
  cabinet(it){
    const [x0, y0, z0, x1, y1, z1]=this.B(it), c=it.color, body=this.M(StMat.paint(c, 0.38)), dk=this.M(StMat.paint(StScene.DARK, 0.6)), s=this.side(it), st=this.M(StMat.metal(StScene.GALV, 0.45));
    if (it.mount==='floor') dk.box(x0+0.01, y0+0.01, z0, x1-0.01, y1-0.01, z0+0.1, 0.004);
    body.box(x0, y0, z0+(it.mount==='floor' ? 0.1 : 0), x1, y1, z1, 0.012);
    const sm=this.M(StMat.paint(RalColor.shade(c, 0.72), 0.5));
    this.panel(sm, it, 0.03, 0.97, 0.025, 0.03, 0.002, 0); this.panel(sm, it, 0.03, 0.97, 0.97, 0.975, 0.002, 0); this.panel(sm, it, 0.03, 0.035, 0.03, 0.97, 0.002, 0); this.panel(sm, it, 0.965, 0.97, 0.03, 0.97, 0.002, 0);
    this.panel(dk, it, 0.86, 0.9, 0.42, 0.58, 0.02, 0.003);
    for (const v of [0.12, 0.85]) this.panel(dk, it, 0.03, 0.06, v, v+0.06, 0.012, 0.003);
    const nm=String(it.name||'');
    if (/асу/i.test(nm)){ this.panel(this.M(StMat.paint('#1f2429', 0.25)), it, 0.2, 0.75, 0.52, 0.86, 0.008, 0.004); this.panel(this.M(StMat.glow('#79b8ff', 1.5)), it, 0.24, 0.71, 0.56, 0.82, 0.01, 0); }
    else { const lamps=/авр|резерв/i.test(nm) ? ['#3ccf5a', '#e2b33a', '#d84a3a'] : ['#3ccf5a', '#d84a3a'];
      lamps.forEach((col, k)=>{ const p=this.front(it, 0.22+k*0.13, 0.76, 0); this.M(StMat.glow(col, 1.4)).tube(p, StV.add(p, this.out(it, 0.022)), 0.018, 14); });
      const q=this.front(it, 0.32, 0.5, 0), h0=StV.add(q, this.out(it, 0.03)), h1=StV.add(q, this.out(it, 0.045)), t=this.endwise(it) ? [0, 0.008, 0.04] : [0.008, 0, 0.04];
      dk.tube(q, h0, 0.035, 18); dk.box(...[0, 1, 2].map(k=>Math.min(h0[k], h1[k])-t[k]), ...[0, 1, 2].map(k=>Math.max(h0[k], h1[k])+t[k]), 0.003);
      this.panel(this.M(StMat.paint('#f2f2ee', 0.4)), it, 0.15, 0.6, 0.86, 0.93, 0.004, 0); }
    if (it.mount==='wall' && this.endwise(it)){ const back=s<0 ? x1 : x0;   // кронштейны у стены
      for (const v of [0.08, 0.92]) dk.box(Math.min(back, back+s*0.03), y0+0.03, z0+(z1-z0)*v-0.02, Math.max(back, back+s*0.03), y1-0.03, z0+(z1-z0)*v+0.02);
    } else if (it.mount==='wall'){ const back=s<0 ? y1 : y0;
      for (const v of [0.08, 0.92]) dk.box(x0+0.03, Math.min(back, back+s*0.03), z0+(z1-z0)*v-0.02, x1-0.03, Math.max(back, back+s*0.03), z0+(z1-z0)*v+0.02);
    } else if (it.mount==='frame'){ for (const x of [x0+(x1-x0)*0.12, x1-(x1-x0)*0.12-0.042]) st.box(x, (y0+y1)/2-0.021, this.base, x+0.042, (y0+y1)/2+0.021, z0, 0.004);
      st.box(x0+0.02, (y0+y1)/2-0.15, this.base, x1-0.02, (y0+y1)/2+0.15, this.base+0.01); }
  }
  other(it){
    const [x0, y0, z0, x1, y1, z1]=this.B(it), c=it.color, body=this.M(StMat.paint(c, 0.42));
    this.M(StMat.paint(StScene.DARK, 0.6)).box(x0+0.02, y0+0.02, z0, x1-0.02, y1-0.02, z0+0.06, 0.004); body.box(x0, y0, z0+0.06, x1, y1, z1, 0.015);
    this.panel(this.M(StMat.paint(RalColor.shade(c, 0.75), 0.5)), it, 0.08, 0.3, 0.7, 0.85, 0.006, 0.003);
  }

  // ---- трубопровод: магистраль, отводы со спусками, шаровые краны, фланцы, опоры, выход через торец
  piping(pp){
    const mat=pp.mat==='inox' ? StMat.metal(StScene.INOX, 0.22) : pp.mat==='pp' ? StMat.paint(pp.color, 0.32) : { c:pp.color, r:0.38, m:0.35 };
    const m=this.M(mat), dk=this.M(StMat.paint(StScene.DARK, 0.6)), red=this.M(StMat.paint('#c83a2e', 0.4)), dn=+(String(pp.dn||'').match(/\d+/)||[0])[0] || (this.plan.pipe && this.plan.pipe.dn) || 0;
    for (const l of pp.lines){
      const r=Math.max(0.012, Math.min(0.08, (dn || (l.medium==='fuel' ? 25 : l.medium==='air' ? 50 : 80))/2000+0.006)), A=this.P(l.x0, l.y, l.z), B=this.P(l.x1, l.y, l.z);
      const out=l.x1>=this.plan.int[0]-1, end=out ? [this.Le+0.12, B[1], B[2]] : B;
      for (const [a, b] of StationLayout.runs(l)){ const p=this.P(a, l.y, l.z), q=b>=l.x1 ? end : this.P(b, l.y, l.z); m.tube(p, q, r, 20); m.sphere(p, r*1.02, 12); if (b<l.x1) m.sphere(q, r*1.02, 12); }
      if (out){ m.tube([this.Le+0.04, B[1], B[2]], [this.Le+0.07, B[1], B[2]], r*1.7, 20); dk.tube([this.Le-0.03, B[1], B[2]], [this.Le+0.03, B[1], B[2]], r*1.4, 18); }
      // опоры у стены: кронштейн и хомут
      const yw=this.oy+this.Wi;
      if (yw-A[1]<0.6) for (let x=A[0]+0.4; x<Math.min(B[0], this.ox+this.Li)-0.2; x+=1.4){ dk.box(x-0.02, A[1]-0.03, A[2]-r-0.04, x+0.02, yw, A[2]-r-0.01); dk.tube([x-0.015, A[1], A[2]], [x+0.015, A[1], A[2]], r*1.3, 16, [false, false]); }
      for (const bp of l.bypass||[]){ const zb=l.z-260, a=this.P(bp.x0, l.y, l.z), b=this.P(bp.x1, l.y, l.z), a1=this.P(bp.x0, l.y, zb), b1=this.P(bp.x1, l.y, zb), v=this.P((bp.x0+bp.x1)/2, l.y, zb);   // байпас осушителя
        m.tube(a, a1, r*0.85, 16, [false, false]); m.tube(b, b1, r*0.85, 16, [false, false]); m.tube(a1, b1, r*0.85, 16, [false, false]); for (const q of [a, b, a1, b1]) m.sphere(q, r*0.92, 12);
        m.sphere(v, r*1.45, 12); red.box(v[0]-0.012, v[1]-0.012, v[2]-r*1.3-0.018, v[0]+0.13, v[1]+0.012, v[2]-r*1.3, 0.004); }   // ручка крана — вниз (обвод под магистралью)
      for (const b of l.branches){ const p0=this.P(b.x, b.y0, l.z), p1=this.P(b.x, b.y1, l.z), p2=this.P(b.x, b.y1, b.z1), to=this.plan.items.find(i=>StationLayout.key(i)===b.to);
        m.sphere(p0, r*1.05, 12); if (StV.len(StV.sub(p1, p0))>0.01){ m.tube(p0, p1, r*0.85, 16, [false, false]); m.sphere(p1, r*0.88, 12); }
        if (b.z1<l.z) m.tube(p1, p2, r*0.85, 16, [false, false]);
        const down=b.z1<l.z, side=down && to && b.z1<to.h-30, hz=StV.sub(p1, p0), hl=StV.len(hz);
        let last=down ? p2 : p1, dir=down ? [0, 0, -1] : hl>1e-3 ? StV.mul(hz, 1/hl) : [0, 0, -1];
        if (side){ const c=this.P(to.x+to.lx/2, to.y+to.ly/2, b.z1), v=StV.norm([0, c[1]-p2[1], 0]), q=StV.add(p2, StV.mul(v, 0.07)); m.sphere(p2, r*0.88, 12); m.tube(p2, q, r*0.85, 16, [false, false]); last=q; dir=v; }   // вход сбоку (ресивер — внизу)
        m.tube(StV.add(last, StV.mul(dir, -0.02)), last, r*1.6, 18);                  // фланец у оборудования
        const v=hl>0.15 ? StV.add(p0, StV.mul(hz, Math.min(0.12, hl*0.5)/hl)) : StV.add(p1, [0, 0, -Math.min(0.12, Math.max(0, (l.z-b.z1)/1000*0.5))]);
        m.sphere(v, r*1.45, 12); red.box(v[0]-0.012, v[1]-0.012, v[2]+r*1.3, v[0]+0.13, v[1]+0.012, v[2]+r*1.3+0.018, 0.004); }   // шаровой кран
    }
  }

  // ---- глушитель на крыше над ДГУ: опоры, корпус, выход с колпаком; выхлопная труба в изоляции — сквозь крышу
  muffler(m){
    const mm=this.mm, x0=this.ox+mm(m.x), x1=x0+mm(m.lx), r=mm(m.d)/2, cy=this.oy+mm(m.y)+r, body=this.M(StMat.paint(m.color, 0.5)), dk=this.M(StMat.paint(StScene.DARK, 0.55));
    const zr=this.rise>0 ? Math.max(this.roofZ(cy-r), this.roofZ(cy+r))+0.04 : this.top, cz=zr+mm(m.gap)+r, zb=this.rise>0 ? Math.min(this.roofZ(cy-r), this.roofZ(cy+r)) : this.top;   // скатная крыша — опоры от ската
    for (const f of [0.18, 0.82]){ const x=x0+(x1-x0)*f; dk.box(x-0.05, cy-r*0.75, zb, x+0.05, cy+r*0.75, cz-r*0.55, 0.004); dk.box(x-0.06, cy-r*0.8, zr-0.02, x+0.06, cy+r*0.8, zr); }
    body.tube([x0+r*0.25, cy, cz], [x1-r*0.25, cy, cz], r, 32, [false, false]);
    body.tube([x0, cy, cz], [x0+r*0.25, cy, cz], r*0.7, 32, [true, false], r); body.tube([x1-r*0.25, cy, cz], [x1, cy, cz], r, 32, [false, true], r*0.7);
    const st=this.M(StMat.metal('#a7adb3', 0.4)), ro=Math.max(0.05, r*0.28), xe=x1+mm(m.outlet);   // выхлоп — горизонтально в сторону радиатора
    st.tube([x1-0.02, cy, cz], [xe, cy, cz], ro, 20); st.tube([xe-0.012, cy, cz], [xe, cy, cz], ro*1.2, 20, [false, false]);
    dk.tube([xe-0.002, cy, cz], [xe, cy, cz], ro*0.9, 20, [true, true]);
    if (m.exhaust){ const ex=this.ox+mm(m.exhaust.x), ey=this.oy+mm(m.exhaust.y), wrap=this.M(StMat.metal('#c4c9cd', 0.55));
      wrap.tube([ex, ey, this.base+mm(m.exhaust.z)], [ex, ey, cz-r*0.8], Math.max(0.06, ro*1.15), 22);
      const zp=this.rise>0 ? this.roofZ(ey)+0.04 : this.top; dk.tube([ex, ey, zp-0.02], [ex, ey, zp+0.06], Math.max(0.06, ro*1.15)*1.6, 22); }   // проходка через крышу
  }
}

// ---------------------------------------------------------------- матрицы 4 × 4 (по столбцам, как в WebGL)
class StM4 {
  static mul(a, b){ const o=new Float32Array(16); for (let i=0; i<4; i++) for (let j=0; j<4; j++){ let v=0; for (let k=0; k<4; k++) v+=a[k*4+j]*b[i*4+k]; o[i*4+j]=v; } return o; }
  static persp(fov, asp, n, f){ const t=1/Math.tan(fov/2); return new Float32Array([t/asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f+n)/(n-f), -1, 0, 0, 2*f*n/(n-f), 0]); }
  static ortho(l, r, b, t, n, f){ return new Float32Array([2/(r-l), 0, 0, 0, 0, 2/(t-b), 0, 0, 0, 0, -2/(f-n), 0, -(r+l)/(r-l), -(t+b)/(t-b), -(f+n)/(f-n), 1]); }
  static look(eye, at, up){
    const z=StV.norm(StV.sub(eye, at)), x=StV.norm(StV.cross(up, z)), y=StV.cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -StV.dot(x, eye), -StV.dot(y, eye), -StV.dot(z, eye), 1]);
  }
  static apply(m, p){ const x=p[0], y=p[1], z=p[2], w=m[3]*x+m[7]*y+m[11]*z+m[15]; return [(m[0]*x+m[4]*y+m[8]*z+m[12])/w, (m[1]*x+m[5]*y+m[9]*z+m[13])/w, (m[2]*x+m[6]*y+m[10]*z+m[14])/w]; }
  /** свет: ортографическая проекция по шару сцены (центр c, радиус R) со стороны dir */
  static light(dir, c, R){ const up=Math.abs(dir[2])>0.95 ? [1, 0, 0] : [0, 0, 1]; return this.mul(this.ortho(-R, R, -R, R, 0.05, 4*R), this.look(StV.add(c, StV.mul(dir, 2*R)), c, up)); }
}

// ---------------------------------------------------------------- камера: ракурс спереди слева сверху, всё в кадре
class StCam {
  static AZ = 36;            // от фронта влево, °
  static EL = 19;            // над горизонтом, °
  static FOV = 24;           // по вертикали, °
  /** b — габариты сцены {lo, hi}; asp — ширина / высота кадра; fill — доля кадра под сцену; deg — азимут (минус — справа) */
  static fit(b, asp, fill=0.9, deg=this.AZ){
    const az=deg*Math.PI/180, el=this.EL*Math.PI/180, d=[-Math.cos(el)*Math.sin(az), -Math.cos(el)*Math.cos(az), Math.sin(el)], fov=this.FOV*Math.PI/180;
    const C=[]; for (const x of [b.lo[0], b.hi[0]]) for (const y of [b.lo[1], b.hi[1]]) for (const z of [b.lo[2], b.hi[2]]) C.push([x, y, z]);
    let T=StV.mul(StV.add(b.lo, b.hi), 0.5), D=StV.len(StV.sub(b.hi, b.lo))*2.2, vp=null, eye=null, view=null, proj=null, span=[1, 1];
    for (let k=0; k<40; k++){
      eye=StV.add(T, StV.mul(d, D)); view=StM4.look(eye, T, [0, 0, 1]); proj=StM4.persp(fov, asp, 0.1, D*4); vp=StM4.mul(proj, view);
      const P=C.map(p=>StM4.apply(vp, p)), x0=Math.min(...P.map(p=>p[0])), x1=Math.max(...P.map(p=>p[0])), y0=Math.min(...P.map(p=>p[1])), y1=Math.max(...P.map(p=>p[1]));
      const s=Math.max((x1-x0)/(2*fill), (y1-y0)/(2*fill)), cx=(x0+x1)/2, cy=(y0+y1)/2; span=[(x1-x0)/s, (y1-y0)/s];
      const zf=StV.norm(StV.sub(eye, T)), rt=StV.norm(StV.cross([0, 0, 1], zf)), up=StV.cross(zf, rt), th=Math.tan(fov/2);
      T=StV.add(T, StV.add(StV.mul(rt, cx*D*th*asp), StV.mul(up, cy*D*th))); D*=s;
      if (Math.abs(s-1)<1e-3 && Math.abs(cx)<1e-3 && Math.abs(cy)<1e-3) break;
    }
    eye=StV.add(T, StV.mul(d, D)); view=StM4.look(eye, T, [0, 0, 1]);
    return { eye, T, D, view, fov, asp, span };
  }
}

// ---------------------------------------------------------------- свет: солнце (мягкие тени) и небо со всех сторон
class StSky {
  static SUN = StV.norm([-0.5, -0.55, 1.05]);   // спереди слева, высоко: внутрь через срез — неглубоко
  static SUN_E = [2.6, 2.5, 2.32];              // освещённость от солнца (линейная)
  static ZEN = [0.36, 0.45, 0.6];               // яркость неба в зените
  static HOR = [0.74, 0.77, 0.82];              // у горизонта
  static GROUND = 0.33;                         // отражение земли (свет снизу)
  static halton(i, b){ let f=1, r=0; while (i>0){ f/=b; r+=f*(i%b); i=Math.floor(i/b); } return r; }
  static sky(z){ const t=Math.pow(Math.max(0, z), 0.55); return this.HOR.map((h, k)=>h+(this.ZEN[k]-h)*t); }
  /** проходы: [{dir — к свету, E — освещённость прохода с весом, sun}]; солнце — в конусе ~3° (мягкий край тени),
   *  небо — равномерно по сфере (снизу — свет, отражённый землёй) */
  static passes(n, S=this.SUN){
    const nSun=Math.max(1, Math.round(n*0.375)), nSky=Math.max(1, n-nSun), sun=[], sky=[], [u, v]=StV.basis(S);
    for (let i=0; i<nSun; i++){ const r=Math.sqrt(this.halton(i+1, 2))*0.08, t=this.halton(i+1, 3)*Math.PI*2;
      sun.push({ dir:StV.norm(StV.add(S, StV.add(StV.mul(u, r*Math.cos(t)), StV.mul(v, r*Math.sin(t))))), E:this.SUN_E.map(x=>x/nSun), sun:true }); }
    const sinE=Math.max(0.1, S[2]), gE=this.SUN_E.map((x, k)=>this.GROUND*(x*sinE+Math.PI*0.5*(this.ZEN[k]+this.HOR[k]))/Math.PI);
    for (let i=0; i<nSky; i++){ const z=1-2*(i+0.5)/nSky, r=Math.sqrt(1-z*z), ph=i*2.399963+0.7, d=[r*Math.cos(ph), r*Math.sin(ph), z];
      const L=z>=0 ? this.sky(z) : gE; sky.push({ dir:d, E:L.map(x=>x*4*Math.PI/nSky), sun:false }); }
    const out=[]; for (let i=0, j=0; out.length<nSun+nSky;){ if (i<nSun && (i*nSky<=j*nSun || j>=nSky)) out.push(sun[i++]); else out.push(sky[j++]); }
    return out;
  }
}

// ---------------------------------------------------------------- отрисовка на WebGL2
class StGl {
  static VS = `#version 300 es
in vec3 aP; in vec3 aN; in vec2 aT; uniform mat4 uVP; out vec3 vP; out vec3 vN; out vec2 vT;
void main(){ vP=aP; vN=aN; vT=aT; gl_Position=uVP*vec4(aP, 1.0); }`;
  // свет одного прохода: GGX + Ламберт, тень — карта глубины (9 выборок), рисунок рифлёного листа, земля — уходит в фон,
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
      if (uMinA>0.0) col+=uMetal*alb*0.7/3.14159*uE*nl*V; } }   // металл под светом неба — матовое отражение (без чёрных пятен)
  // внутри — мягкий заполняющий свет светильников, без теней: оборудование в глубине видно
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
  // итог: средняя яркость по покрытым проходам → тон-маппинг ACES, гамма; фон — по покрытию (края сглажены)
  static FS_OUT = `#version 300 es
precision highp float; in vec2 vU; uniform sampler2D uT; uniform vec3 uBg; uniform float uExp; out vec4 o;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
void main(){ vec4 a=texture(uT, vU); float c=clamp(a.a, 0.0, 1.0); vec3 col=a.a>1e-5 ? a.rgb/a.a : vec3(0.0);
  vec3 m=pow(aces(col*uExp), vec3(1.0/2.2)); float n=(fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)))*43758.5453)-0.5)/255.0;
  o=vec4(mix(uBg, m, c)+n, 1.0); }`;
  static BG = '#f3f4f6';
  static FILL = 1.1;         // заполняющий свет внутри контейнера
  static EXP = 1.15;

  constructor(canvas){
    const gl=canvas.getContext('webgl2', { antialias:false, preserveDrawingBuffer:true, alpha:false, depth:true });
    if (!gl) throw new Error('WebGL2 недоступен');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('нет EXT_color_buffer_float');
    this.gl=gl; this.c=canvas; this.objs=[]; this.fb=null;
    this.main=this.prog(StGl.VS, StGl.FS); this.sh=this.prog(StGl.VS_SH, StGl.FS_SH); this.add=this.prog(StGl.VS_Q, StGl.FS_ADD); this.out=this.prog(StGl.VS_Q, StGl.FS_OUT);
    this.vaoQ=gl.createVertexArray();
    this.white=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.white);   // для материалов без картинки
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  }
  prog(vs, fs){
    const gl=this.gl, p=gl.createProgram();
    for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]){ const s=gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('шейдер: '+gl.getShaderInfoLog(s)); gl.attachShader(p, s); }
    gl.bindAttribLocation(p, 0, 'aP'); gl.bindAttribLocation(p, 1, 'aN'); gl.bindAttribLocation(p, 2, 'aT'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('программа: '+gl.getProgramInfoLog(p));
    p.loc={}; return p;
  }
  u(p, n){ if (!(n in p.loc)) p.loc[n]=this.gl.getUniformLocation(p, n); return p.loc[n]; }
  /** геометрия сцены → буферы видеокарты */
  upload(scene){
    const gl=this.gl; this.free();
    for (const { mat, mesh } of scene.groups.values()){ if (!mesh.i.length) continue;
      const vao=gl.createVertexArray(), bp=gl.createBuffer(), bn=gl.createBuffer(), bi=gl.createBuffer(); gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, bp); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.p), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bn); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.n), gl.STATIC_DRAW); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bi); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(mesh.i), gl.STATIC_DRAW);
      const bufs=[bp, bn, bi];
      if (mesh.t.length){ const bt=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bt); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.t), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0); bufs.push(bt); }
      gl.bindVertexArray(null);
      this.objs.push({ vao, bufs, n:mesh.i.length, mat, alb:StMat.lin(mat.c), tex:mat.k===3 ? this.texture(scene.decals.get(mat.tex)) : null }); }
  }
  /** картинка наклейки (StDecal рисует на холсте) → текстура с mip-уровнями; не нарисовалась — прозрачная */
  texture(d){
    const gl=this.gl, t=gl.createTexture(); let c=null;
    try{ c=d && typeof StDecal!=='undefined' ? StDecal.canvas(d) : null; } catch(e){ c=null; }
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (c) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  free(){ const gl=this.gl; for (const o of this.objs){ gl.deleteVertexArray(o.vao); o.bufs.forEach(b=>gl.deleteBuffer(b)); if (o.tex) gl.deleteTexture(o.tex); } this.objs=[]; }
  /** кадр: накопление (RGBA16F), кадр прохода (RGBA16F + глубина), карта теней (глубина S × S) */
  targets(W, H, S){
    const gl=this.gl; if (this.fb && this.fb.W===W && this.fb.H===H && this.fb.S===S) return this.fb;
    this.dropTargets();
    const tex=(w, h, fmt, ifmt, type)=>{ const t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
    const fbo=(color, depthTex, depthRb)=>{ const f=gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      if (color) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
      if (depthTex) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
      if (depthRb) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb);
      if (!color) { gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE); }
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw new Error('кадр не собрался'); return f; };
    const accT=tex(W, H, gl.RGBA, gl.RGBA16F, gl.HALF_FLOAT), tmpT=tex(W, H, gl.RGBA, gl.RGBA16F, gl.HALF_FLOAT), shT=tex(S, S, gl.DEPTH_COMPONENT, gl.DEPTH_COMPONENT24, gl.UNSIGNED_INT);
    gl.bindTexture(gl.TEXTURE_2D, shT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    const rb=gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H);
    this.fb={ W, H, S, accT, tmpT, shT, rb, acc:fbo(accT), tmp:fbo(tmpT, null, rb), sh:fbo(null, shT) };
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); return this.fb;
  }
  dropTargets(){ const gl=this.gl, f=this.fb; if (!f) return; for (const t of [f.accT, f.tmpT, f.shT]) gl.deleteTexture(t); gl.deleteRenderbuffer(f.rb); for (const b of [f.acc, f.tmp, f.sh]) gl.deleteFramebuffer(b); this.fb=null; }

  /** кадр сцены: o = {w, h, passes, shadow}; возвращает canvas с картинкой */
  async render(scene, o={}){
    const gl=this.gl, W=o.w||1600, H=o.h||1000, S=o.shadow||2048, N=o.passes||64;
    this.c.width=W; this.c.height=H; this.upload(scene); const F=this.targets(W, H, S);
    const b=scene.bounds(), cam=StCam.fit(b, W/H, 0.9, scene.az), ctr=StV.mul(StV.add(b.lo, b.hi), 0.5), R=StV.len(StV.sub(b.hi, b.lo))/2+0.3;
    const passes=StSky.passes(N, scene.az<0 ? [-StSky.SUN[0], StSky.SUN[1], StSky.SUN[2]] : StSky.SUN), base=StM4.persp(cam.fov, W/H, Math.max(0.05, cam.D-R*2.2), cam.D+R*2.2), reach=Math.max(b.hi[0]-b.lo[0], b.hi[1]-b.lo[1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, F.acc); gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    for (let i=0; i<passes.length; i++){ const ps=passes[i], LVP=StM4.light(ps.dir, ctr, R);
      // тень: глубина со стороны света (земля тень не отбрасывает)
      gl.bindFramebuffer(gl.FRAMEBUFFER, F.sh); gl.viewport(0, 0, S, S); gl.clear(gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.6, 2.0); gl.useProgram(this.sh); gl.uniformMatrix4fv(this.u(this.sh, 'uVP'), false, LVP);
      for (const ob of this.objs) if (ob.mat.k!==2 && ob.mat.k!==3){ gl.bindVertexArray(ob.vao); gl.drawElements(gl.TRIANGLES, ob.n, gl.UNSIGNED_INT, 0); }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      // проход: камера со сдвигом на долю пикселя (сглаживание)
      const P=new Float32Array(base), jx=(StSky.halton(i+1, 2)-0.5)*2/W, jy=(StSky.halton(i+1, 3)-0.5)*2/H; P[8]-=jx; P[9]-=jy;
      gl.bindFramebuffer(gl.FRAMEBUFFER, F.tmp); gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      const pr=this.main; gl.useProgram(pr);
      gl.uniformMatrix4fv(this.u(pr, 'uVP'), false, StM4.mul(P, cam.view)); gl.uniformMatrix4fv(this.u(pr, 'uLVP'), false, LVP);
      gl.uniform3fv(this.u(pr, 'uCam'), cam.eye); gl.uniform3fv(this.u(pr, 'uL'), ps.dir); gl.uniform3fv(this.u(pr, 'uE'), ps.E); gl.uniform3fv(this.u(pr, 'uCtr'), ctr);
      gl.uniform1f(this.u(pr, 'uW'), 1/passes.length); gl.uniform1f(this.u(pr, 'uMinA'), ps.sun ? 0 : 0.14); gl.uniform1f(this.u(pr, 'uTexel'), 1/S);
      gl.uniform1f(this.u(pr, 'uR0'), reach*0.55); gl.uniform1f(this.u(pr, 'uR1'), reach*1.25);
      gl.uniform3fv(this.u(pr, 'uIn0'), [scene.ox-0.01, scene.oy-0.01, scene.base-0.01]); gl.uniform3fv(this.u(pr, 'uIn1'), [scene.ox+scene.Li+0.01, scene.oy+scene.Wi+0.01, scene.ceil+0.01]); gl.uniform1f(this.u(pr, 'uFill'), StGl.FILL);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, F.shT); gl.uniform1i(this.u(pr, 'uSh'), 0); gl.uniform1i(this.u(pr, 'uTex'), 1);
      for (const ob of this.objs){ const m=ob.mat;
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ob.tex || this.white);
        gl.uniform3fv(this.u(pr, 'uAlb'), ob.alb); gl.uniform1f(this.u(pr, 'uRough'), m.r); gl.uniform1f(this.u(pr, 'uMetal'), m.m); gl.uniform1f(this.u(pr, 'uEmis'), m.e||0); gl.uniform1i(this.u(pr, 'uKind'), m.k||0);
        gl.bindVertexArray(ob.vao); gl.drawElements(gl.TRIANGLES, ob.n, gl.UNSIGNED_INT, 0); }
      // в накопление
      gl.bindFramebuffer(gl.FRAMEBUFFER, F.acc); gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this.add); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, F.tmpT); gl.uniform1i(this.u(this.add, 'uT'), 0);
      gl.bindVertexArray(this.vaoQ); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.disable(gl.BLEND);
      if (o.onPass) o.onPass(i+1, passes.length);
      if (i%4===3) await new Promise(r=>setTimeout(r, 0));   // интерфейс не замирает
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); gl.useProgram(this.out);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, F.accT); gl.uniform1i(this.u(this.out, 'uT'), 0);
    gl.uniform3fv(this.u(this.out, 'uBg'), RalColor.rgb(StGl.BG).map(v=>v/255)); gl.uniform1f(this.u(this.out, 'uExp'), o.exposure||StGl.EXP);
    gl.bindVertexArray(this.vaoQ); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
    if (gl.isContextLost()) throw new Error('контекст WebGL потерян');
    return this.c;
  }
}

// ---------------------------------------------------------------- картинка для КП и вкладки «Компоновка»
class StationRender {
  static PASSES = 64;        // проходов накопления: тени и сглаживание (программная отрисовка — меньше)
  static W = 1600;
  static cache = new Map();  // отпечаток расстановки → {src, w, h}
  static gl = null;
  static okFlag = null;
  static queue = Promise.resolve();

  /** WebGL2 с вещественным кадром есть (проверяется один раз) */
  static ok(){
    if (this.okFlag!=null) return this.okFlag;
    try{ const c=document.createElement('canvas'), gl=c.getContext('webgl2'); this.okFlag=!!(gl && gl.getExtension('EXT_color_buffer_float'));
      if (gl){ const d=gl.getExtension('WEBGL_debug_renderer_info'), r=d ? String(gl.getParameter(d.UNMASKED_RENDERER_WEBGL)) : ''; this.soft=/swiftshader|llvmpipe|software|basic render/i.test(r);
        const lose=gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); } }
    catch(e){ this.okFlag=false; }
    return this.okFlag;
  }
  static key(plan, view){ return (plan.hash||'')+(view==='out' ? '|o' : ''); }
  static cached(plan, view){ return this.cache.get(this.key(plan, view))||null; }
  /** высота кадра — по сцене (длинный контейнер — ниже кадр, без пустых полей) */
  static size(scene){ const W=this.W, c=StCam.fit(scene.bounds(), 1.6, 0.9, scene.az), k=c.span[1]/c.span[0]*1.6; return [W, Math.round(Math.max(760, Math.min(1100, W/1.6*Math.max(0.62, Math.min(1, k*1.12)))))]; }
  /** 3D-вид картинкой: {src — JPEG, w, h}; view — 'in' (разрез, по умолчанию) или 'out' (снаружи); WebGL2 нет или сбой —
   *  null (берётся SVG-вид). По очереди, с кэшем; логотипы и знаки — наклейками (StDecal) */
  static image(plan, meta, view){
    const key=this.key(plan, view); if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
    if (!plan.geo || !plan.geo.ext || !this.ok()) return Promise.resolve(null);
    const run=async ()=>{ if (this.cache.has(key)) return this.cache.get(key);
      try{
        const m=await StDecal.meta(plan, { ...meta, view:view==='out' ? 'out' : 'in' }), sc=new StScene(plan, m).build(), [w, h]=this.size(sc);
        await StDecal.prepare(sc);
        if (!this.gl) this.gl=new StGl(document.createElement('canvas'));
        const c=await this.gl.render(sc, { w, h, passes:this.soft ? Math.min(this.PASSES, 24) : this.PASSES, shadow:this.soft ? 1536 : 2048 });
        const im={ src:c.toDataURL('image/jpeg', 0.92), w:c.width, h:c.height };
        this.cache.set(key, im); if (this.cache.size>16) this.cache.delete(this.cache.keys().next().value);
        return im;
      } catch(e){ this.gl=null; this.okFlag=false; return null; } };   // сбой — до перезапуска SVG-вид
    const p=this.queue.then(run, run); this.queue=p.catch(()=>null); return p;
  }
}

if (typeof module!=='undefined') module.exports={ StV, StMesh, StMat, StScene, StM4, StCam, StSky };
