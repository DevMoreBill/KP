// Картинки наклеек 3D-вида станции (StScene → StGl, station-render.js) и цвет оборудования по главному фото.
// StDecal рисует на холсте: логотип организации (фирменные цвета шаблона КП; у ПНЕВМОТЕХ «О» — глобус, внизу «группа
// компаний»), логотипы производителей (картинка из каталога на светлой табличке; нет картинки — название производителя
// цветом, контрастным корпусу), знаки безопасности по ГОСТ 12.4.026-2015 (F04 «Огнетушитель», W01 «Пожароопасно»,
// W08 «Опасность поражения электрическим током», P02 «Запрещается пользоваться открытым огнём и курить», P06 «Доступ
// посторонним запрещён»), табличка категории помещения и класса зоны, световые табло в две строки («Выход», «Порошок!
// Уходи!», «Порошок! Не входи!», «Автоматика отключена»), табличка щита ОПС, надпись «ДТ» у горловины; маркировка груза по
// ГОСТ 14192-96 — знаки № 9 «Место строповки» (цепь), № 12 «Центр тяжести», надпись «Масса брутто» (чёрным, на тёмной стене —
// белым).
// PhotoTint — главный цвет фото элемента (без фона, насыщенное и в центре — весомее): им окрашено оборудование в 3D.
'use strict';

class StDecal {
  static imgs = new Map();   // адрес картинки логотипа → загруженная картинка (null — не загрузилась)
  static FONT = '"Arial Black", "Segoe UI Black", "Helvetica Neue", Arial, sans-serif';

  /** сведения для сцены: производитель элемента без поля «Производитель» — по названию (есть в каталоге логотипов),
   *  пропорции табличек логотипов и логотип организации (из шаблона КП) */
  static async meta(plan, meta){
    let all={};
    if (typeof loadLogos==='function'){ try{ all=(await loadLogos())||{}; } catch(e){ all={}; } }
    const logos={}, makers={}, keys=Object.keys(all).filter(k=>k.length>=3).sort((a, b)=>b.length-a.length);
    for (const it of [...(plan.items||[]), ...(plan.outside||[])]){
      let mk=String(it.maker||'').trim();
      if (!mk){ const nm=' '+String(it.name||'').toLowerCase().replace(/[^a-zа-яё0-9]+/g, ' ')+' ', k=keys.find(k=>nm.includes(' '+k.replace(/[^a-zа-яё0-9]+/g, ' ').trim()+' '));
        if (k){ mk=String(all[k].maker||k); makers[it.id]=mk; } }
      const lg=mk && typeof logoFor==='function' ? logoFor(mk) : null;
      if (lg && lg.w>0 && lg.h>0) logos[mk.toLowerCase()]=Math.max(1.2, Math.min(8, (lg.w/lg.h+0.36)/1.36)); }
    return { ...meta, logos, makers, brand:this.brandParts() };
  }
  /** логотип организации: части надписи с цветами из шаблона КП; «ПНЕВМОТЕХ» — фирменные синие всегда */
  static brandParts(){
    const pk=typeof TPL_CACHE!=='undefined' && typeof S!=='undefined' ? TPL_CACHE[S.template] : null, st=(pk && pk.settings)||{}, col=st.colors||{};
    const parts=(st.brandParts||[]).map(p=>[String((p && p[0])||'').trim(), '#'+String(col[p && p[1]]||(p && p[1])||'0B45A0').replace(/^#/, '')])
      .filter(p=>p[0] && /^#[0-9a-f]{6}$/i.test(p[1]));
    return !parts.length || /^пневмотех$/i.test(parts.map(p=>p[0]).join('')) ? StOutfit.BRAND : parts;
  }
  /** загрузить картинки логотипов, нужные сцене (до отрисовки кадра) */
  static async prepare(scene){
    for (const d of scene.decals.values()){ if (d.type!=='logo' || typeof logoFor!=='function') continue;
      const lg=logoFor(d.maker); if (!lg || !lg.src || this.imgs.has(lg.src)) continue;
      try{ this.imgs.set(lg.src, await readImg(lg.src)); } catch(e){ this.imgs.set(lg.src, null); } }
  }
  /** холст наклейки по описанию: ширина до 1024 точек, высота — по пропорции */
  static canvas(d){
    const ar=Math.max(0.2, Math.min(12, d.ar || this.AR[d.id] || 1)), W=ar>=1 ? 1024 : Math.round(1024*ar), H=Math.max(16, Math.round(W/ar));
    const c=document.createElement('canvas'); c.width=W; c.height=H; const g=c.getContext('2d');
    if (d.type==='brand') this.brand(g, W, H, d); else if (d.type==='logo') this.logo(g, W, H, d); else this.sign(g, W, H, d.id, d);
    return c;
  }
  static AR = { F04:1, W01:1.15, W08:1.15, P02:1, P06:1, EXIT:2.77, POW_OUT:2.77, POW_NO:2.77, AUTO_OFF:2.77, DT:1.85, CAT:1.5, OPS:2.68, SLING:0.6, COG:1, MASS:2.65 };

  /** скруглённый прямоугольник */
  static rr(g, x, y, w, h, r){ g.beginPath(); g.moveTo(x+r, y); g.arcTo(x+w, y, x+w, y+h, r); g.arcTo(x+w, y+h, x, y+h, r); g.arcTo(x, y+h, x, y, r); g.arcTo(x, y, x+w, y, r); g.closePath(); }
  /** строки текста по центру холста: [текст, доля высоты, цвет] — каждая вписана в ширину, промежутки поровну */
  static rows(g, W, H, R){
    const gap=(1-R.reduce((s, r)=>s+r[1], 0))/(R.length+1); let y=gap*H;
    for (const [t, k, c] of R){ this.text(g, t, W/2, y+k*H*0.53, W*0.88, k*H*1.25, 900, c); y+=(k+gap)*H; }
  }
  /** текст по центру, вписанный в ширину w (шрифт уменьшается) */
  static text(g, s, x, y, w, size, weight, color, font){
    g.font=`${weight} ${size}px ${font||'Arial, sans-serif'}`; const k=Math.min(1, w/Math.max(1, g.measureText(s).width));
    g.font=`${weight} ${Math.floor(size*k)}px ${font||'Arial, sans-serif'}`; g.fillStyle=color; g.textAlign='center'; g.textBaseline='middle'; g.fillText(s, x, y);
  }

  // ---- логотип организации: надпись частями своих цветов (на тёмной стене — белыми); «О» — глобус; внизу «группа
  // компаний» вразрядку
  static brand(g, W, H, d){
    const parts=d.parts && d.parts.length ? d.parts : StOutfit.BRAND, tag=d.tag||'', pad=H*0.02, ink=c=>d.light ? '#ffffff' : c;
    const mainH=(H-2*pad)*(tag ? 0.7 : 0.92), seg=[];
    for (let i=0; i<parts.length; i++){ const [t, c]=parts[i];
      if (d.globe && i===0 && /О$/i.test(t)){ seg.push({ t:t.slice(0, -1), c }); seg.push({ globe:true, c }); } else seg.push({ t, c }); }
    let size=mainH*1.25; const font=s=>`900 ${s}px ${this.FONT}`, R=()=>size*0.4;
    const width=()=>{ g.font=font(size); return seg.reduce((s, q)=>s+(q.globe ? 2*R()+size*0.06 : g.measureText(q.t).width), 0); };
    const maxW=W-2*pad-H*0.04; if (width()>maxW) size*=maxW/width();
    const total=width(), y=pad+mainH*0.5+(tag ? 0 : (H-2*pad-mainH)/2); let x=(W-total)/2;
    g.textBaseline='middle'; g.textAlign='left'; g.font=font(size);
    for (const q of seg){
      if (q.globe){ const r=R(), cx=x+size*0.03+r, cy=y+size*0.02; this.globe(g, cx, cy, r, d.parts && d.parts[1] ? d.parts[1][1] : '#3DA0EE', q.c); x+=2*r+size*0.06; continue; }
      g.fillStyle=ink(q.c); g.fillText(q.t, x, y+size*0.04); x+=g.measureText(q.t).width; }
    if (tag){ const th=(H-2*pad)*0.17, ty=H-pad-th*0.75, letters=[...tag], step=total/letters.length;
      g.font=`600 ${th}px Arial, sans-serif`; g.fillStyle=ink(parts[0][1]); g.textAlign='center';
      letters.forEach((ch, k)=>g.fillText(ch, (W-total)/2+step*(k+0.5), ty)); }
  }
  /** глобус: шар с переходом цвета и белыми изогнутыми полосами */
  static globe(g, cx, cy, r, light, dark){
    const gr=g.createRadialGradient(cx-r*0.35, cy-r*0.4, r*0.1, cx, cy, r); gr.addColorStop(0, light); gr.addColorStop(1, dark);
    g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI*2); g.fillStyle=gr; g.fill(); g.clip();
    g.strokeStyle='#ffffff'; g.lineCap='round';
    for (const [dy, w, k] of [[-0.42, 0.11, 0.55], [-0.05, 0.13, 0.4], [0.34, 0.11, 0.3]]){ g.lineWidth=r*w; g.beginPath();
      g.moveTo(cx-r*1.1, cy+r*(dy+k*0.5)); g.quadraticCurveTo(cx, cy+r*(dy-k*0.6), cx+r*1.1, cy+r*(dy+k*0.2)); g.stroke(); }
    g.restore();
  }

  // ---- логотип производителя: картинка на светлой табличке или название цветом, контрастным корпусу
  static logo(g, W, H, d){
    const lg=typeof logoFor==='function' ? logoFor(d.maker) : null, im=lg && this.imgs.get(lg.src);
    if (im){ g.fillStyle='#ffffff'; this.rr(g, 0, 0, W, H, H*0.14); g.fill(); g.strokeStyle='rgba(0,0,0,0.18)'; g.lineWidth=H*0.03; this.rr(g, H*0.02, H*0.02, W-H*0.04, H-H*0.04, H*0.12); g.stroke();
      const iw=im.naturalWidth||im.width, ih=im.naturalHeight||im.height, k=Math.min((W-H*0.36)/iw, (H*0.72)/ih);
      g.drawImage(im, (W-iw*k)/2, (H-ih*k)/2, iw*k, ih*k); return; }
    const rgb=typeof RalColor!=='undefined' ? RalColor.rgb(d.bg||'#cccccc') : [200, 200, 200], lum=(0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2])/255;
    this.text(g, String(d.maker||'').toUpperCase(), W/2, H/2, W*0.96, H*0.82, 900, lum>0.55 ? '#1d2733' : '#ffffff', this.FONT);
  }

  // ---- знаки безопасности, таблички и табло; d — описание наклейки (у таблички категории — категория и класс зоны)
  static sign(g, W, H, id, d={}){
    const s=Math.min(W, H);
    if (id==='F04'){ g.fillStyle='#c8102e'; this.rr(g, 0, 0, W, H, s*0.06); g.fill(); g.fillStyle='#ffffff';
      // огнетушитель: корпус, головка, рукоятка, шланг; справа — пламя
      this.rr(g, W*0.22, H*0.36, W*0.24, H*0.52, s*0.08); g.fill(); g.fillRect(W*0.29, H*0.26, W*0.1, H*0.12); g.fillRect(W*0.22, H*0.22, W*0.3, H*0.05);
      g.lineWidth=s*0.05; g.strokeStyle='#ffffff'; g.beginPath(); g.moveTo(W*0.39, H*0.3); g.quadraticCurveTo(W*0.62, H*0.26, W*0.6, H*0.5); g.stroke();
      this.flame(g, W*0.72, H*0.62, s*0.3, '#ffffff'); return; }
    if (id==='W01' || id==='W08'){   // жёлтый треугольник с чёрной каймой
      const p=s*0.04; g.fillStyle='#000000'; g.beginPath(); g.moveTo(W/2, p); g.lineTo(W-p, H-p); g.lineTo(p, H-p); g.closePath(); g.lineJoin='round'; g.fill();
      const q=s*0.13; g.fillStyle='#f9a800'; g.beginPath(); g.moveTo(W/2, p+q*1.6); g.lineTo(W-p-q*1.15, H-p-q*0.62); g.lineTo(p+q*1.15, H-p-q*0.62); g.closePath(); g.fill();
      g.fillStyle='#000000';
      if (id==='W01') this.flame(g, W/2, H*0.66, s*0.34, '#000000');
      else { g.beginPath(); g.moveTo(W*0.54, H*0.36); g.lineTo(W*0.42, H*0.62); g.lineTo(W*0.52, H*0.6); g.lineTo(W*0.44, H*0.84); g.lineTo(W*0.6, H*0.55); g.lineTo(W*0.5, H*0.57); g.lineTo(W*0.6, H*0.36); g.closePath(); g.fill(); }
      return; }
    if (id==='P02'){ g.fillStyle='#ffffff'; g.beginPath(); g.arc(W/2, H/2, s*0.48, 0, Math.PI*2); g.fill();
      this.flame(g, W/2, H*0.62, s*0.34, '#000000'); g.fillStyle='#000000'; g.fillRect(W*0.47, H*0.62, W*0.06, H*0.14);
      g.strokeStyle='#c8102e'; g.lineWidth=s*0.09; g.beginPath(); g.arc(W/2, H/2, s*0.43, 0, Math.PI*2); g.stroke();
      g.beginPath(); g.moveTo(W/2-s*0.3, H/2-s*0.3); g.lineTo(W/2+s*0.3, H/2+s*0.3); g.stroke(); return; }
    if (id==='P06'){   // «Доступ посторонним запрещён»: человек с поднятой рукой под запрещающим знаком
      g.fillStyle='#ffffff'; g.beginPath(); g.arc(W/2, H/2, s*0.48, 0, Math.PI*2); g.fill(); g.fillStyle='#000000';
      g.beginPath(); g.arc(W*0.5, H*0.27, s*0.075, 0, Math.PI*2); g.fill();
      g.fillRect(W*0.44, H*0.36, W*0.12, H*0.3); g.fillRect(W*0.44, H*0.64, W*0.05, H*0.17); g.fillRect(W*0.51, H*0.64, W*0.05, H*0.17);
      g.save(); g.translate(W*0.56, H*0.38); g.rotate(-0.9); g.fillRect(0, -s*0.025, s*0.2, s*0.05); g.restore();
      g.strokeStyle='#c8102e'; g.lineWidth=s*0.09; g.beginPath(); g.arc(W/2, H/2, s*0.43, 0, Math.PI*2); g.stroke();
      g.beginPath(); g.moveTo(W/2-s*0.3, H/2-s*0.3); g.lineTo(W/2+s*0.3, H/2+s*0.3); g.stroke(); return; }
    if (id==='SLING' || id==='COG' || id==='MASS'){ this.cargo(g, W, H, id, d); return; }
    if (id==='CAT'){   // табличка на двери: категория помещения по пожарной опасности, класс зоны по ПУЭ
      g.fillStyle='#ffffff'; this.rr(g, 0, 0, W, H, s*0.05); g.fill(); g.strokeStyle='#111111'; g.lineWidth=s*0.035; this.rr(g, s*0.04, s*0.04, W-s*0.08, H-s*0.08, s*0.03); g.stroke();
      this.rows(g, W, H, [['КАТЕГОРИЯ', 0.14, '#111111'], [String(d.cat||''), 0.4, '#c8102e'], [d.zone ? 'КЛАСС ЗОНЫ '+d.zone : 'ПО ПОЖАРНОЙ ОПАСНОСТИ', 0.13, '#111111']]); return; }
    // табло и надписи: [строки, фон, цвет текста]; табло — в две строки (читается издалека)
    const T={ EXIT:[['ВЫХОД'], '#00843d', '#ffffff'], POW_OUT:[['ПОРОШОК!', 'УХОДИ!'], '#ffffff', '#d0021b'], POW_NO:[['ПОРОШОК!', 'НЕ ВХОДИ!'], '#ffffff', '#d0021b'],
      AUTO_OFF:[['АВТОМАТИКА', 'ОТКЛЮЧЕНА'], '#ffffff', '#0b6b22'], DT:[['ДТ'], '#f9a800', '#000000'], OPS:[['ОПС'], '#ffffff', '#c8102e'] }[id];
    if (!T) return;
    g.fillStyle=T[1]; this.rr(g, 0, 0, W, H, s*0.08); g.fill();
    if (T[1]==='#ffffff'){ g.strokeStyle='rgba(0,0,0,0.25)'; g.lineWidth=s*0.04; this.rr(g, s*0.03, s*0.03, W-s*0.06, H-s*0.06, s*0.06); g.stroke(); }
    this.rows(g, W, H, T[0].length>1 ? T[0].map(t=>[t, 0.36, T[2]]) : [[T[0][0], 0.62, T[2]]]);
  }
  /** маркировка груза (ГОСТ 14192-96) прямо на стене, без фона: № 9 — цепь (разомкнутое звено, два звена, звенья ребром),
   *  № 12 — толстый крест и круг из четырёх дуг; «Масса брутто» — в две строки */
  static cargo(g, W, H, id, d){
    const ink=d.light ? '#ffffff' : '#111111', s=Math.min(W, H); g.fillStyle=ink; g.strokeStyle=ink;
    if (id==='SLING'){ const lw=W*0.66, t=W*0.11, uh=H*0.22, oh=H*0.3, x0=W/2-lw/2+t/2, w=lw-t;
      g.lineWidth=t; g.lineCap='butt';
      g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0, uh-w/2); g.arc(W/2, uh-w/2, w/2, Math.PI, 0, true); g.lineTo(x0+w, 0); g.stroke();   // разомкнутое звено сверху
      for (const y of [H*0.26, H*0.62]){ this.rr(g, x0, y+t/2, w, oh-t, w/2); g.stroke(); }
      g.fillRect(W/2-t*0.6, H*0.08, t*1.2, H*0.9); return; }   // звенья ребром
    if (id==='COG'){ const cx=W/2, cy=H/2, a=s*0.1, R=s*0.31, r=R-s*0.09, gap=Math.asin(Math.min(0.9, (a/2+s*0.05)/r));
      g.fillRect(cx-s/2, cy-a/2, s, a); g.fillRect(cx-a/2, cy-s/2, a, s);
      for (let k=0; k<4; k++){ const t0=k*Math.PI/2+gap, t1=(k+1)*Math.PI/2-gap; g.beginPath(); g.arc(cx, cy, R, t0, t1); g.arc(cx, cy, r, t1, t0, true); g.closePath(); g.fill(); }
      return; }
    const n=typeof StationLayout!=='undefined' ? StationLayout.n(d.kg||0) : String(d.kg||0);
    this.rows(g, W, H, [['МАССА БРУТТО', 0.34, ink], [`${n} кг`, 0.42, ink]]);
  }
  /** пламя (условное): капля с языком */
  static flame(g, x, y, s, color){
    g.fillStyle=color; g.beginPath(); g.moveTo(x, y+s*0.5);
    g.bezierCurveTo(x-s*0.55, y+s*0.45, x-s*0.5, y-s*0.1, x-s*0.12, y-s*0.55);
    g.bezierCurveTo(x-s*0.05, y-s*0.2, x+s*0.1, y-s*0.25, x+s*0.12, y-s*0.45);
    g.bezierCurveTo(x+s*0.5, y-s*0.05, x+s*0.55, y+s*0.45, x, y+s*0.5); g.closePath(); g.fill();
  }
}

// ---------------------------------------------------------------- цвет оборудования по главному фото
class PhotoTint {
  static cache = new Map();   // адрес фото → '#rrggbb' или '' (цвет не определить)
  static src(p){ return String((p && p.photo && p.photo.src) || ''); }
  static get(src){ return this.cache.get(src); }
  /** у элементов станции есть фото, цвет которых ещё не определён */
  static pending(x){ return kitParts(x).some(p=>{ const s=this.src(p); return s && !this.cache.has(s); }); }
  /** определить цвета фото элементов станции (по одному разу на адрес); true — что-то определено */
  static async load(x){
    let ch=false;
    for (const p of kitParts(x)){ const s=this.src(p); if (!s || this.cache.has(s)) continue;
      try{ this.cache.set(s, this.of(await readImg(s))); } catch(e){ this.cache.set(s, ''); }
      ch=true; }
    return ch;
  }
  /** картинка → главный цвет (уменьшается до 96 точек по большей стороне) */
  static of(im){
    const iw=im.naturalWidth||im.width, ih=im.naturalHeight||im.height; if (!iw || !ih) return '';
    const k=Math.min(1, 96/Math.max(iw, ih)), w=Math.max(1, Math.round(iw*k)), h=Math.max(1, Math.round(ih*k));
    const c=document.createElement('canvas'); c.width=w; c.height=h; const g=c.getContext('2d'); g.drawImage(im, 0, 0, w, h);
    let d; try{ d=g.getImageData(0, 0, w, h).data; } catch(e){ return ''; }   // чужой сайт без разрешения — цвет не узнать
    return this.pick(d, w, h);
  }
  /** главный цвет по пикселям RGBA: фон — заливкой от краёв (цвета, близкие к краевому), прозрачное — тоже фон; остальное —
   *  по корзинам (тон × яркость; серые — по яркости; тёмные — отдельно), насыщенные и ближе к центру — весомее; тёмная
   *  корзина (тени, решётки) побеждает, только если её больше половины. Фона больше 96 % — '' */
  static pick(d, w, h){
    const n=w*h, bg=new Uint8Array(n), px=i=>[d[i*4], d[i*4+1], d[i*4+2]], dist=(a, b)=>Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2]);
    const edge=[]; for (let x=0; x<w; x++){ edge.push(x, (h-1)*w+x); } for (let y=1; y<h-1; y++){ edge.push(y*w, y*w+w-1); }
    const ec=edge.filter(i=>d[i*4+3]>=128).map(px), med=k=>ec.map(c=>c[k]).sort((a, b)=>a-b)[ec.length>>1], M=ec.length ? [med(0), med(1), med(2)] : null;
    const q=[]; for (const i of edge){ if (d[i*4+3]<128 || (M && dist(px(i), M)<=60)){ bg[i]=1; q.push(i); } }
    while (q.length){ const i=q.pop(), x=i%w, y=(i-x)/w;
      for (const j of [x>0 ? i-1 : -1, x<w-1 ? i+1 : -1, y>0 ? i-w : -1, y<h-1 ? i+w : -1]){ if (j<0 || bg[j]) continue;
        if (d[j*4+3]<128 || (M && dist(px(j), M)<=60)){ bg[j]=1; q.push(j); } } }
    const bins=new Map(); let fg=0, all=0;
    for (let i=0; i<n; i++){ if (bg[i]) continue; fg++;
      const [r, g, b]=px(i), mx=Math.max(r, g, b), mn=Math.min(r, g, b), v=mx/255, s=mx ? (mx-mn)/mx : 0;
      let key, wt; if (v<0.16){ key='d'; wt=0.45; } else if (s<0.18){ key='g'+Math.min(5, Math.floor(v*6)); wt=0.9; }
      else { const hh=mx===r ? ((g-b)/(mx-mn)+6)%6 : mx===g ? (b-r)/(mx-mn)+2 : (r-g)/(mx-mn)+4; key='h'+Math.floor(hh*3)+(v<0.55 ? 'd' : 'l'); wt=1.15+0.6*s; }
      const x=i%w, y=(i-x)/w, cw=1-0.6*Math.min(1, Math.hypot((x+0.5)/w-0.5, (y+0.5)/h-0.5)/0.7071), W8=wt*cw;
      const e=bins.get(key)||{ w:0, r:0, g:0, b:0 }; e.w+=W8; e.r+=r*W8; e.g+=g*W8; e.b+=b*W8; bins.set(key, e); all+=W8; }
    if (fg<n*0.04 || !all) return '';
    const L=[...bins.entries()].sort((a, b)=>b[1].w-a[1].w), best=L[0][0]==='d' && L[0][1].w<all*0.5 && L[1] ? L[1][1] : L[0][1];
    const hex=v=>Math.round(v/best.w).toString(16).padStart(2, '0');
    return '#'+hex(best.r)+hex(best.g)+hex(best.b);
  }
}

if (typeof module!=='undefined') module.exports={ StDecal, PhotoTint };
