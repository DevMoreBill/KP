// Календарь для всех полей дат программы: выходные, праздники, переносы и сокращённые дни — по производственному
// календарю РФ (/api/calendar: isdayoff.ru / xmlcalendar.ru, обновляется сервером раз в 30 дней).
// Встроенный календарь браузера не умеет отмечать праздники, поэтому по щелчку по полю даты открывается свой.
// С клавиатуры дату можно, как и раньше, ввести в само поле; Alt+↓ или F4 — открыть календарь.
'use strict';

const WCAL = { y:{}, loading:{} };
// официальные праздники (ст. 112 ТК РФ) — чтобы отличать праздник от перенесённого выходного
const WCAL_HOL = { '1-1':'Новогодние каникулы', '1-2':'Новогодние каникулы', '1-3':'Новогодние каникулы', '1-4':'Новогодние каникулы', '1-5':'Новогодние каникулы',
  '1-6':'Новогодние каникулы', '1-7':'Рождество Христово', '1-8':'Новогодние каникулы', '2-23':'День защитника Отечества', '3-8':'Международный женский день',
  '5-1':'Праздник Весны и Труда', '5-9':'День Победы', '6-12':'День России', '11-4':'День народного единства' };
const WCAL_MON=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

function wcalYear(y){
  if (WCAL.y[y] || WCAL.loading[y]) return WCAL.y[y]||null;
  WCAL.loading[y]=api('/api/calendar?year='+y).then(r=>{ if (r && r.days) WCAL.y[y]=r; }).catch(()=>{}).finally(()=>{ delete WCAL.loading[y]; if (DP.el) dpDraw(); });
  return null;
}
const dpIso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const dpDoy = d => Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 1)) / 864e5);

// вид дня: off — нерабочий, hol — праздник, wkd — выходной, move — перенесённый выходной, work — рабочая суббота/воскресенье, short — сокращённый
function wcalDay(d){
  const c=WCAL.y[d.getFullYear()], i=dpDoy(d), wd=d.getDay(), we=wd===0||wd===6, key=(d.getMonth()+1)+'-'+d.getDate();
  const off = c ? c.days[i]==='1' : (we || !!WCAL_HOL[key]);
  const short = !!(c && c.short && c.short[i]==='1');
  if (off && WCAL_HOL[key]) return {off:true, cls:'hol', t:WCAL_HOL[key]};
  if (off && !we) return {off:true, cls:'move', t:'Нерабочий день (перенос выходного)'};
  if (off) return {off:true, cls:'wkd', t:'Выходной'};
  if (we) return {off:false, cls:'work', t:'Рабочий день (перенос)'};
  if (short) return {off:false, cls:'short', t:'Сокращённый предпраздничный день'};
  return {off:false, cls:'', t:''};
}

const DP = { el:null, box:null, y:0, m:0 };

function dpOpen(el){
  if (el.disabled || el.readOnly) return;
  dpClose();
  const v=el.value ? new Date(el.value+'T00:00:00') : new Date();
  DP.el=el; DP.y=v.getFullYear(); DP.m=v.getMonth();
  const host=el.closest('dialog[open]')||document.body;    // внутри модального окна — иначе календарь окажется под ним
  const box=document.createElement('div'); box.className='dp'; box.setAttribute('role','dialog'); box.setAttribute('aria-label','Выбор даты');
  host.appendChild(box); DP.box=box;
  box.addEventListener('pointerdown', e=>e.stopPropagation());
  box.addEventListener('click', dpClick);
  dpDraw(); dpPlace();
}
function dpClose(){ if (DP.box) DP.box.remove(); DP.box=null; DP.el=null; }

function dpPlace(){
  const b=DP.box, el=DP.el; if (!b || !el) return;
  if (typeof isMob==='function' && isMob()){ b.classList.add('sheet'); return; }
  const r=el.getBoundingClientRect(), w=b.offsetWidth, h=b.offsetHeight;
  let x=Math.min(Math.max(8, r.left), innerWidth-w-8), y=r.bottom+4;
  if (y+h>innerHeight-8) y=Math.max(8, r.top-h-4);
  b.style.left=x+'px'; b.style.top=y+'px';
}

function dpDraw(){
  const b=DP.box, el=DP.el; if (!b || !el) return;
  const y=DP.y, m=DP.m; wcalYear(y);
  const first=new Date(y, m, 1), shift=(first.getDay()+6)%7, n=new Date(y, m+1, 0).getDate();
  const sel=el.value, today=dpIso(new Date()), min=el.min||'', max=el.max||'';
  let cells='';
  for (let i=0;i<shift;i++) cells+='<span></span>';
  let offN=0;
  for (let d=1; d<=n; d++){
    const dt=new Date(y, m, d), iso=dpIso(dt), k=wcalDay(dt); if (k.off) offN++;
    const dis=(min&&iso<min)||(max&&iso>max);
    cells+=`<button type="button" class="dp-d${k.off?' off':''}${k.cls?' '+k.cls:''}${iso===sel?' sel':''}${iso===today?' today':''}" data-dpd="${iso}"${dis?' disabled':''} title="${esc([dt.toLocaleDateString('ru-RU',{weekday:'long', day:'numeric', month:'long'}), k.t].filter(Boolean).join(' — '))}">${d}</button>`;
  }
  const c=WCAL.y[y];
  b.innerHTML=`<div class="dp-h"><button type="button" class="dp-nav" data-dpm="-1" aria-label="Предыдущий месяц">‹</button><b>${WCAL_MON[m]} ${y}</b><button type="button" class="dp-nav" data-dpm="1" aria-label="Следующий месяц">›</button></div>
    <div class="dp-w">${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map((x,i)=>`<span${i>4?' class="we"':''}>${x}</span>`).join('')}</div>
    <div class="dp-g">${cells}</div>
    <div class="dp-l"><span><i class="hol"></i>праздник</span><span><i class="wkd"></i>выходной</span><span><i class="short"></i>сокращённый</span><span><i class="work"></i>рабочий перенос</span></div>
    <div class="dp-f"><span class="muted">${n-offN} раб. дн. · ${c?(c.approx?'приблизительно':'произв. календарь'):'загружаю календарь…'}</span><span class="sp"></span>
      ${el.required?'':'<button type="button" class="lnk" data-dpx="clear">Очистить</button>'}<button type="button" class="lnk" data-dpx="today">Сегодня</button></div>`;
}

function dpSet(iso){
  const el=DP.el; if (!el) return;
  el.value=iso;
  el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true}));
  dpClose();
}

function dpClick(e){
  const d=e.target.closest('[data-dpd]'); if (d && !d.disabled) return dpSet(d.dataset.dpd);
  const nv=e.target.closest('[data-dpm]'); if (nv){ DP.m+=+nv.dataset.dpm; if (DP.m<0){ DP.m=11; DP.y--; } if (DP.m>11){ DP.m=0; DP.y++; } dpDraw(); return; }
  const x=e.target.closest('[data-dpx]'); if (!x) return;
  if (x.dataset.dpx==='clear') return dpSet('');
  if (x.dataset.dpx==='today') return dpSet(dpIso(new Date()));
}

// щелчок по полю даты — свой календарь вместо встроенного (во всех формах программы)
document.addEventListener('pointerdown', e=>{
  const el=e.target.closest && e.target.closest('input[type=date]');
  if (!el){ if (DP.box && !DP.box.contains(e.target)) dpClose(); return; }
  if (el.disabled || el.readOnly) return;
  e.preventDefault();                       // встроенный календарь и клавиатура телефона не открываются
  if (DP.el===el) return dpClose();
  dpOpen(el);
}, true);
document.addEventListener('keydown', e=>{
  if (DP.box && e.key==='Escape'){ e.stopPropagation(); e.preventDefault(); return dpClose(); }
  const el=e.target; if (el && el.type==='date' && ((e.altKey && e.key==='ArrowDown') || e.key==='F4')){ e.preventDefault(); dpOpen(el); }
}, true);
window.addEventListener('resize', ()=>dpClose());
document.addEventListener('scroll', e=>{ if (DP.box && !DP.box.contains(e.target)) dpPlace(); }, true);
// встроенный календарь браузера открывается по щелчку — его не показываем
document.addEventListener('click', e=>{ const el=e.target.closest && e.target.closest('input[type=date]'); if (el && !el.disabled && !el.readOnly) e.preventDefault(); }, true);
