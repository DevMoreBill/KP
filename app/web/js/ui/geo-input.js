// Поле точного адреса с подсказками (для полей с атрибутом data-geo): DaData (если задан ключ) или OpenStreetMap — сервер /api/geo/*.
// Можно вставить координаты («55.751244, 37.618423», 55°45′04″N 37°37′06″E) или ссылку на точку из Google / Яндекс Карт —
// адрес определится по координатам. Выбор — событие «geo:pick» на поле: detail = {value, lat, lon, city, region, exact, src}.
// Дополнительные пункты (например, склады поставщика) — GEO_EXTRA[имя из data-geo](поле) → [{value, lat, lon, city, sub, tag}].
'use strict';

const GEO = { box:null, inp:null, items:[], i:-1, t:0, seq:0, msg:'', src:'' };
const GEO_EXTRA = {};

// координаты из текста или ссылки карт → {lat, lon} | null
function geoParse(text){
  const s=String(text||'').trim(); if (!s) return null;
  const ok=(a,b)=>{ a=+a; b=+b; return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a)<=90&&Math.abs(b)<=180&&(a||b) ? {lat:+a.toFixed(6), lon:+b.toFixed(6)} : null; };
  let m;
  if (/^https?:\/\//i.test(s)){
    let u=s; try{ u=decodeURIComponent(s); }catch(e){}
    if ((m=u.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/))) return ok(m[1],m[2]);                 // Google: точка места
    if ((m=u.match(/[?&](?:whatshere\[point\]|pt|ll)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/))) return ok(m[2],m[1]); // Яндекс: долгота, широта
    if ((m=u.match(/[?&](?:q|query|destination|center)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/))) return ok(m[1],m[2]);
    if ((m=u.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/))) return ok(m[1],m[2]);                    // Google: центр карты
    return null;
  }
  const dms=[...s.matchAll(/(\d+(?:[.,]\d+)?)\s*°\s*(?:(\d+(?:[.,]\d+)?)\s*['′’]\s*)?(?:(\d+(?:[.,]\d+)?)\s*(?:["″”]|'')\s*)?([NSEWСЮВЗ])?/gi)];
  if (dms.length===2){
    const v=x=>{ const n=k=>parseFloat(String(x[k]||0).replace(',','.')); let d=n(1)+n(2)/60+n(3)/3600; if (/[SWЮЗ]/i.test(x[4]||'')) d=-d; return d; };
    const [a,b]=dms, aLon=/[EWВЗ]/i.test(a[4]||''); return aLon ? ok(v(b),v(a)) : ok(v(a),v(b));
  }
  if ((m=s.match(/^(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)$/))) return ok(m[1].replace(',','.'), m[2].replace(',','.'));
  return null;
}
const geoShort = s => /^https?:\/\/(?:[\w-]+\.)*(?:goo\.gl|g\.co|yandex\.(?:ru|com|kz|by)|ya\.ru)\//i.test(String(s||'').trim()) && !geoParse(s);
const geoFmt = p => `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`;

function geoClose(){ if (GEO.box) GEO.box.remove(); GEO.box=null; GEO.inp=null; GEO.items=[]; GEO.i=-1; GEO.msg=''; clearTimeout(GEO.t); }

function geoPlace(){
  const b=GEO.box, el=GEO.inp; if (!b || !el || !el.isConnected) return geoClose();
  const r=el.getBoundingClientRect();
  b.style.left=Math.max(8, Math.min(r.left, innerWidth-Math.max(r.width,280)-8))+'px'; b.style.width=Math.max(r.width,280)+'px';
  const below=innerHeight-r.bottom, h=Math.min(320, b.scrollHeight||320);
  if (below<h+12 && r.top>below){ b.style.top=''; b.style.bottom=(innerHeight-r.top+4)+'px'; } else { b.style.bottom=''; b.style.top=(r.bottom+4)+'px'; }
}

function geoDraw(){
  if (!GEO.inp) return;
  if (GEO.box && !GEO.box.isConnected) GEO.box=null;
  if (!GEO.box){ const b=document.createElement('div'); b.className='geo-box'; b.setAttribute('role','listbox');
    b.addEventListener('pointerdown', e=>e.preventDefault());       // фокус остаётся в поле
    b.addEventListener('click', e=>{ const x=e.target.closest('[data-gi]'); if (x) geoPick(+x.dataset.gi); });
    // внутри открытого окна (иначе модальное окно делает список недоступным); перерисовка окна его не удаляет
    b.setAttribute('data-morph-keep',''); (GEO.inp.closest('dialog[open]')||document.body).appendChild(b);
    GEO.box=b; }
  const it=GEO.items;
  GEO.box.innerHTML=(it.length?it.map((x,i)=>`<button type="button" role="option" data-gi="${i}"${i===GEO.i?' aria-selected="true"':''}><b>${esc(x.value)}</b>${x.tag?`<em>${esc(x.tag)}</em>`:''}${x.sub?`<small>${esc(x.sub)}</small>`:''}</button>`).join(''):'')
    +(GEO.msg?`<p class="geo-msg">${esc(GEO.msg)}</p>`:'')
    +`<p class="geo-ft">${GEO.src?'Подсказки: '+esc(GEO.src)+' · ':''}можно вставить координаты или ссылку на точку из Google / Яндекс Карт</p>`;
  geoPlace();
}

async function geoQuery(inp){
  const q=inp.value.trim(), seq=++GEO.seq, key=inp.dataset.geo;
  const extra=(GEO_EXTRA[key]?GEO_EXTRA[key](inp)||[]:[]).filter(x=>!q || LgGeo.norm(x.value+' '+(x.sub||'')).includes(LgGeo.norm(q)));
  GEO.msg='';
  const p=geoParse(q);
  if (p){ GEO.items=[{value:geoFmt(p), lat:p.lat, lon:p.lon, coords:true, tag:'координаты', sub:'Выберите — адрес определится по точке'}]; GEO.src=''; GEO.i=0; return geoDraw(); }
  if (geoShort(q)){ GEO.items=[{value:q, short:true, tag:'ссылка', sub:'Выберите — откроем ссылку и возьмём точку'}]; GEO.src=''; GEO.i=0; return geoDraw(); }
  // города из встроенной таблицы — сразу (и без интернета)
  const loc=q.length>=2 ? LgGeo.IDX.filter(c=>c.n.startsWith(LgGeo.norm(q))).slice(0,3).map(c=>({value:c.name, lat:c.lat, lon:c.lon, city:c.name, sub:'город — центр', tag:'город', cityOnly:true})) : [];
  GEO.items=[...extra, ...loc]; GEO.i=-1; geoDraw();
  if (q.length<3) return;
  try{ const r=await api('/api/geo/suggest?q='+encodeURIComponent(q)); if (seq!==GEO.seq || GEO.inp!==inp) return;
    if (r.error) GEO.msg='Подсказки адресов недоступны: '+r.error;
    GEO.src=r.src||'';
    GEO.items=[...extra, ...(r.items||[]).map(x=>({...x, sub:[x.region&&x.region!==x.city?x.region:'', x.lat==null?'без координат — уточним по карте':x.exact?'точка дома':'точка улицы / населённого пункта'].filter(Boolean).join(' · ')})), ...(r.items&&r.items.length?[]:loc)];
  }catch(e){ if (seq!==GEO.seq) return; GEO.msg='Подсказки адресов недоступны ('+(e.message||e)+'). Город из списка или координаты — работают.'; }
  geoDraw();
}

async function geoPick(i){
  const inp=GEO.inp, x=GEO.items[i]; if (!inp || !x) return;
  let item={...x};
  try{
    if (x.short){ GEO.msg='Открываю ссылку…'; GEO.items=[]; geoDraw(); const r=await api('/api/geo/unshort?u='+encodeURIComponent(x.value)); if (r.error) throw new Error(r.error);
      const p=geoParse(r.url); if (!p) throw new Error('в ссылке нет координат точки — откройте точку на карте и скопируйте координаты'); item={value:geoFmt(p), ...p, coords:true}; }
    if (item.coords){ GEO.msg='Определяю адрес по координатам…'; GEO.items=[]; geoDraw();
      const r=await api(`/api/geo/reverse?lat=${item.lat}&lon=${item.lon}`);
      item = r.error ? {...item, value:geoFmt(item), city:'', exact:true, src:'координаты', note:r.error} : {...r, lat:item.lat, lon:item.lon, exact:true, src:(r.src||'')+' по координатам'}; }
    else if (item.lat==null && !item.cityOnly){ const r=await api('/api/geo/locate?q='+encodeURIComponent(item.value)); if (!r.error) item={...item, lat:r.lat, lon:r.lon, city:item.city||r.city}; }
  }catch(e){ GEO.msg='Не получилось: '+(e.message||e); GEO.items=[]; return geoDraw(); }
  const clean={value:item.value, lat:item.lat??null, lon:item.lon??null, city:item.city||'', region:item.region||'', exact:!!item.exact, src:item.src||(item.cityOnly?'город':''), cityOnly:!!item.cityOnly};
  geoClose();
  inp.value=clean.value;
  inp.dispatchEvent(new CustomEvent('geo:pick', {bubbles:true, detail:clean}));
  if (clean.note) toast('Адрес по координатам не определён: '+clean.note);
}

document.addEventListener('focusin', e=>{ const t=e.target; if (!t.matches || !t.matches('input[data-geo]') || t.disabled || t.readOnly) return;
  if (GEO.inp!==t){ geoClose(); GEO.inp=t; } const key=t.dataset.geo; if (GEO_EXTRA[key] && (GEO_EXTRA[key](t)||[]).length) geoQuery(t); });
document.addEventListener('input', e=>{ const t=e.target; if (!t.matches || !t.matches('input[data-geo]')) return;
  if (GEO.inp!==t){ geoClose(); GEO.inp=t; } clearTimeout(GEO.t); const q=t.value.trim();
  GEO.t=setTimeout(()=>geoQuery(t), geoParse(q)||geoShort(q) ? 0 : 320); });
document.addEventListener('focusout', e=>{ if (e.target===GEO.inp) setTimeout(()=>{ if (GEO.inp && document.activeElement!==GEO.inp) geoClose(); }, 120); });
document.addEventListener('keydown', e=>{ const t=e.target; if (t!==GEO.inp || !GEO.box) return; const n=GEO.items.length;
  if (e.key==='ArrowDown'||e.key==='ArrowUp'){ if (!n) return; e.preventDefault(); GEO.i=(GEO.i+(e.key==='ArrowDown'?1:-1)+n)%n; geoDraw(); }
  else if (e.key==='Enter' && GEO.i>=0){ e.preventDefault(); e.stopPropagation(); geoPick(GEO.i); }
  else if (e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); geoClose(); } }, true);
window.addEventListener('resize', ()=>geoPlace());
document.addEventListener('scroll', e=>{ if (GEO.box && !GEO.box.contains(e.target)) geoPlace(); }, true);
// вставили координаты или ссылку на точку — сразу определяем адрес
document.addEventListener('paste', e=>{ const t=e.target; if (!t.matches || !t.matches('input[data-geo]') || t.disabled || t.readOnly) return;
  setTimeout(async()=>{ const q=t.value.trim(); if (!(geoParse(q)||geoShort(q))) return; clearTimeout(GEO.t); GEO.inp=t; await geoQuery(t); if (GEO.inp===t && GEO.items.length===1) geoPick(0); }, 0); });
