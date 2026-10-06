// Изображения: подготовка фото и схем, галерея позиции.
'use strict';

function pickImage(kind,i){ const f=$('#filePick'); f.value=''; f.onchange=()=>f.files[0]&&loadImage(f.files[0],kind,i); f.click(); }

function readImg(src){ return new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=rej; im.src=src; }); }

function fileToURL(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); }); }

async function prepImage(src, kind){
  const im=await readImg(src); const max=1600, sc=Math.min(1, max/Math.max(im.width,im.height));
  let w=Math.round(im.width*sc), h=Math.round(im.height*sc);
  const c=document.createElement('canvas'); c.width=w; c.height=h; const g=c.getContext('2d'); g.drawImage(im,0,0,w,h);
  // обрезка белых/прозрачных полей
  const d=g.getImageData(0,0,w,h).data; let x0=w,y0=h,x1=-1,y1=-1;
  for(let y=0;y<h;y+=1) for(let x=0;x<w;x+=1){ const o=(y*w+x)*4; if (d[o+3]>20 && (d[o]<240||d[o+1]<240||d[o+2]<240)){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; } }
  let out=c;
  if (x1>x0 && y1>y0){ const pad=Math.round(Math.max(w,h)*0.015); x0=Math.max(0,x0-pad); y0=Math.max(0,y0-pad); x1=Math.min(w-1,x1+pad); y1=Math.min(h-1,y1+pad);
    out=document.createElement('canvas'); out.width=x1-x0+1; out.height=y1-y0+1; const og=out.getContext('2d');
    if (kind!=='logo'){ og.fillStyle='#fff'; og.fillRect(0,0,out.width,out.height); }
    og.drawImage(c,-x0,-y0); }
  const type = kind==='logo' ? 'image/png' : 'image/jpeg';
  return { src: out.toDataURL(type, 0.9), w: out.width, h: out.height };
}

async function loadImage(file, kind, i){
  if (!file.type.startsWith('image/')) return toast('Нужен файл изображения: JPG, PNG или WEBP');
  try { const img=await prepImage(await fileToURL(file), kind); S.items[i][kind]=img; renderForm(); persist(); }
  catch(e){ toast('Не удалось открыть изображение'); }
}

function tileFrom(img){ // скруглённая плитка для страницы оборудования
  return readImg(img.src).then(im=>{
    const W=1300,H=860,c=document.createElement('canvas'); c.width=W; c.height=H; const g=c.getContext('2d');
    const rr=(x,y,w,h,r)=>{ g.beginPath(); g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r); g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath(); };
    g.fillStyle='#CFE0F2'; rr(0,0,W,H,28); g.fill(); g.fillStyle='#FFFFFF'; rr(3,3,W-6,H-6,26); g.fill();
    const sc=Math.min((W-180)/im.width,(H-160)/im.height), w=im.width*sc, h=im.height*sc; g.drawImage(im,(W-w)/2,(H-h)/2,w,h);
    return { url:c.toDataURL('image/png'), w:W, h:H };
  });
}

const WIDE_RX=/схем|чертёж|чертеж|характеристик|диаграм|график/i;

const galWide=g=> g.wide==='full' ? true : g.wide==='half' ? false : (WIDE_RX.test(g.caption||g.slot||'') || (g.w/g.h)>2.6);

async function prepGallery(file){
  const url=await fileToURL(file); const im=await readImg(url);
  const max=2000, sc=Math.min(1,max/Math.max(im.width,im.height)); const w=Math.round(im.width*sc), h=Math.round(im.height*sc);
  const c=document.createElement('canvas'); c.width=w; c.height=h; const g=c.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,w,h); g.drawImage(im,0,0,w,h);
  // обрезать белые поля
  const d=g.getImageData(0,0,w,h).data; let x0=w,y0=h,x1=-1,y1=-1;
  for(let y=0;y<h;y+=2) for(let x=0;x<w;x+=2){ const o=(y*w+x)*4; if(d[o]<242||d[o+1]<242||d[o+2]<242){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; } }
  let out=c;
  if (x1>x0&&y1>y0){ const pad=Math.round(Math.max(w,h)*0.01); x0=Math.max(0,x0-pad); y0=Math.max(0,y0-pad); x1=Math.min(w-1,x1+pad+1); y1=Math.min(h-1,y1+pad+1);
    out=document.createElement('canvas'); out.width=x1-x0+1; out.height=y1-y0+1; const og=out.getContext('2d'); og.fillStyle='#fff'; og.fillRect(0,0,out.width,out.height); og.drawImage(c,-x0,-y0); }
  const png = file.type==='image/png' || file.type==='image/gif' || file.type==='image/bmp';
  return { src: out.toDataURL(png?'image/png':'image/jpeg', 0.9), w: out.width, h: out.height };
}

async function addGallery(i, files, slot){
  const it=S.items[i]; it.gallery=it.gallery||[]; let n=0;
  for (const f of files){ if (!f.type.startsWith('image/')) continue;
    try{ const im=await prepGallery(f); it.gallery.push({id:uid(), ...im, caption:slot||'', slot:slot||'', at:'', on:true}); n++; slot=''; }catch(e){} }
  if (!n) return toast('Нужен файл изображения: JPG, PNG, WEBP');
  it.page=true; it._open=true; renderForm(); persist(); toast(n>1?`Добавлено изображений: ${n}`:'Изображение добавлено');
}

// все фото со страницы товара на сайте поставщика (для позиций из фида — её адрес): сервер скачивает их в изображения позиции;
// уже добавленные (тот же адрес у поставщика) пропускаются, у позиции без главного фото первое становится главным
// «Фото с сайта поставщика»: найти фото на странице товара и выбрать главное и дополнительные
async function galFromPage(i, other){
  const it=S.items[i], def=(it.feed&&it.feed.url)||it.pageUrl||'';
  const url=(def && !other) ? def : prompt('Ссылка на страницу товара на сайте поставщика', def||'https://');
  if (!url || !/^https?:\/\/./.test(url.trim())) return;
  toast('Ищу фото на странице товара…');
  let r; try{ r=await api('/api/pagetext', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url:url.trim()})}); }
  catch(e){ return toast(String(e.message||e)); }
  const imgs=r.imgs||[]; if (!imgs.length) return toast('На странице не найдено фото товара — сохраните картинку и перетащите её в карточку');
  PIM_DLG={url:url.trim(), imgs};
  const d=$('#dlg'); d.classList.add('wide');
  d.innerHTML=`<div class="dlg-h"><h3>Фото со страницы товара<small>${esc(url.trim())}</small></h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
    <div class="dlg-b">${pageImgsHtml(i, imgs, 'dlg')}</div>`;
  d.showModal(); d.querySelector('[data-close]').onclick=()=>d.close();
}

// выбор фото со страницы (автозаполнение и «Фото с сайта поставщика»): ★ — главное, галочки — какие добавить в изображения
let PIM_DLG=null;
function pageImgsHtml(i, imgs, src){
  const it=S.items[i], hasMain=!!(it.photo&&it.photo.src);
  return `<div class="pim" data-pim="${i}" data-src="${src||'ai'}">
    <div class="pim-h"><b>Фото со страницы: ${imgs.length}</b><span class="muted">★ — главное фото позиции, галочка — добавить в «Описание и фото».</span>
      <span class="pim-all"><button type="button" class="lnk" data-pimall="1">отметить все</button> · <button type="button" class="lnk" data-pimall="0">снять все</button></span></div>
    <div class="pim-l">${imgs.map((u,k)=>`<div class="pim-i"><span class="pim-ph"><img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>
      <label class="pim-m" title="Сделать главным фото"><input type="radio" name="pimMain${i}" value="${k}"${!hasMain&&k===0?' checked':''}> ★ Главное</label>
      <label class="pim-c"><input type="checkbox" data-pimk="${k}" checked> добавить</label></div>`).join('')}</div>
    <div class="pim-f">${hasMain?`<label class="pim-keep"><input type="radio" name="pimMain${i}" value="-1" checked> оставить текущее главное фото</label>`:''}
      <button type="button" class="btn primary" data-pimgo="${i}">Добавить выбранные фото</button></div></div>`;
}
async function pageImgsAdd(i, url, imgs, box){
  const it=S.items[i]; if (!it) return false;
  const main=+((box.querySelector(`input[name="pimMain${i}"]:checked`)||{}).value ?? -1);
  const ks=[...box.querySelectorAll('[data-pimk]:checked')].map(x=>+x.dataset.pimk); if (main>=0 && !ks.includes(main)) ks.unshift(main);
  if (!ks.length){ toast('Отметьте хотя бы одно фото'); return false; }
  toast(`Загружаю фото: ${ks.length}…`);
  let r; try{ r=await api('/api/pagephotos', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url, urls:ks.map(k=>imgs[k]), ...imgPlace(it)})}); }
  catch(e){ toast(String(e.message||e)); return false; }
  const bySrc=new Map((r.imgs||[]).map(g=>[g.source, g]));
  it.gallery=it.gallery||[];
  const have=new Set([it.photoSource, it.photo&&it.photo.src, ...it.gallery.flatMap(g=>[g.source, g.src])].filter(Boolean));
  let n=0, mainSet=false;
  const g0=main>=0 ? bySrc.get(imgs[main]) : null;
  if (g0){   // новое главное; прежнее главное — в изображения
    if (it.photo && it.photo.src && it.photo.src!==g0.src && !it.gallery.some(x=>x.src===it.photo.src))
      it.gallery.push({id:uid(), src:it.photo.src, w:it.photo.w, h:it.photo.h, caption:'', slot:'', wide:'', at:'', on:true, ...(it.photoSource?{source:it.photoSource}:{})});
    it.gallery=it.gallery.filter(x=>x.src!==g0.src);
    it.photo={src:g0.src, w:g0.w, h:g0.h}; it.photoSource=g0.source; delete it.photoFrom; have.add(g0.src); have.add(g0.source); n++; mainSet=true; }
  for (const k of ks){ if (k===main) continue; const g=bySrc.get(imgs[k]); if (!g || have.has(g.source) || have.has(g.src)) continue; have.add(g.src);
    it.gallery.push({id:uid(), src:g.src, w:g.w, h:g.h, caption:'', slot:'', wide:'', at:'', on:true, source:g.source}); n++; }
  if (url && !it.pageUrl && !(it.feed&&it.feed.url)) it.pageUrl=url;
  it.page=true; renderForm(); persist();
  const bad=(r.errors||[]).length;
  toast(n ? `Добавлено фото: ${n}${mainSet?' — главное фото заменено':''}${bad?` · не скачались: ${bad}`:''}` : bad ? `Фото не скачались (${bad}) — сайт не отдаёт картинки` : 'Эти фото уже есть у позиции');
  return true;
}
document.addEventListener('click', async e=>{
  const all=e.target.closest('[data-pimall]'); if (all){ all.closest('.pim').querySelectorAll('[data-pimk]').forEach(x=>{ x.checked=all.dataset.pimall==='1'; }); return; }
  const b=e.target.closest('[data-pimgo]'); if (!b) return;
  const box=b.closest('.pim'), i=+b.dataset.pimgo, it=S.items[i]; if (!it) return;
  const src = box.dataset.src==='dlg' ? PIM_DLG : {url:String(it._srcUrl||'').trim(), imgs:it._srcImgs||[]};
  if (!src || !src.imgs.length) return;
  b.disabled=true; const ok=await pageImgsAdd(i, src.url, src.imgs, box); b.disabled=false;
  if (ok && box.dataset.src==='dlg'){ const d=$('#dlg'); if (d.open) d.close(); }
});

function pickGallery(i, slot){ const f=$('#filePick'); f.value=''; f.multiple=!slot; f.onchange=()=>{ const L=[...f.files]; f.multiple=false; if(L.length) addGallery(i,L,slot); }; f.click(); }

// ---------- все места для картинок устроены одинаково ----------
// нажать — выбрать файл; перетащить файл или картинку со страницы сайта; вставить из буфера обмена — Ctrl+V, когда поле
// выбрано или под курсором, либо кнопкой «Вставить из буфера». Места: главное фото и логотип (data-drop), миниатюра позиции
// в разделе «Оборудование» (data-thumb), фото к блоку описания (data-fimg), схемы и изображения (data-gal).
const IMG_SLOT='[data-drop],[data-thumb],[data-fimg],[data-gal]';
let IMG_HOVER=null;

function imgSlotOf(el){ return el && el.closest ? el.closest(IMG_SLOT) : null; }

async function imgSlotPut(z, files){
  files=(files||[]).filter(f=>f && f.type && f.type.startsWith('image/'));
  if (!files.length) return toast('Нужна картинка: JPG, PNG, WEBP или скопированное изображение');
  if (z.dataset.drop) return loadImage(files[0], z.dataset.drop, +z.dataset.i);
  if (z.dataset.thumb!=null){ await loadImage(files[0], 'photo', +z.dataset.thumb); return toast('Главное фото добавлено'); }
  if (z.dataset.fimg!=null) return addFeatImage(+z.dataset.fimg, z.dataset.fid, files.slice(0,1));
  if (z.dataset.gal!=null) return addGallery(+z.dataset.gal, files, '');
}

// картинка по ссылке (перетащили со страницы сайта): data:-ссылка — сразу, http(s) — через сервер программы
async function imgFromUrl(url){
  url=String(url||'').trim(); if (!url) return null;
  try{
    const r = url.startsWith('data:image/') ? await fetch(url) : await fetch('/api/imgfetch?url='+encodeURIComponent(url));
    if (!r.ok) throw new Error(await r.text());
    const b=await r.blob(); return new File([b], 'image', {type:b.type||'image/png'});
  }catch(e){ toast(String(e.message||e).slice(0,160)||'Картинку по ссылке загрузить не удалось — сохраните её в файл и перетащите файл'); return null; }
}

async function imgFilesFrom(dt){
  const files=[...(dt.files||[])].filter(f=>f.type.startsWith('image/')); if (files.length) return files;
  const html=dt.getData && dt.getData('text/html') || '', m=/<img[^>]+src="([^"]+)"/i.exec(html);
  const url = m ? m[1].replace(/&amp;/g,'&') : ((dt.getData && (dt.getData('text/uri-list')||dt.getData('text/plain')))||'').split(/\r?\n/).find(u=>/^(https?:|data:image\/)/i.test(u.trim()));
  if (!url) return [];
  const f=await imgFromUrl(url); return f?[f]:[];
}

// кнопка «Вставить из буфера»: картинку из буфера читает браузер (на этом компьютере — сразу; по сети — через Ctrl+V)
async function imgPasteButton(z){
  if (navigator.clipboard && navigator.clipboard.read){
    try{ const items=await navigator.clipboard.read();
      for (const it of items){ const t=it.types.find(x=>x.startsWith('image/')); if (t){ const b=await it.getType(t); return imgSlotPut(z, [new File([b],'clipboard',{type:t})]); } }
      for (const it of items){ if (it.types.includes('text/plain')){ const txt=await (await it.getType('text/plain')).text(); if (/^(https?:|data:image\/)/i.test(txt.trim())){ const f=await imgFromUrl(txt); if (f) return imgSlotPut(z,[f]); } } }
      return toast('В буфере обмена нет картинки — скопируйте изображение (правый клик → «Копировать изображение»)');
    }catch(e){}
  }
  z.focus(); toast('Нажмите Ctrl+V — картинка из буфера вставится сюда');
}

document.addEventListener('pointerover', e=>{ IMG_HOVER=imgSlotOf(e.target); });
document.addEventListener('click', e=>{ const b=e.target.closest('[data-imgpaste]'); if (!b) return; e.preventDefault(); e.stopPropagation();
  const z=b.dataset.imgpaste ? document.querySelector(b.dataset.imgpaste) : imgSlotOf(b); if (z) imgPasteButton(z); }, true);
['dragover','dragleave','drop'].forEach(ev=>document.addEventListener(ev, async e=>{
  const z=imgSlotOf(e.target); if (!z) return;
  e.preventDefault(); z.classList.toggle('over', ev==='dragover');
  if (ev==='drop'){ const files=await imgFilesFrom(e.dataTransfer); if (files.length) imgSlotPut(z, files); else toast('Перетащите файл картинки или изображение со страницы сайта'); }
}));
document.addEventListener('paste', async e=>{
  const z=imgSlotOf(document.activeElement) || (IMG_HOVER && IMG_HOVER.isConnected ? IMG_HOVER : null); if (!z) return;
  if (document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName) && !imgSlotOf(document.activeElement)) return;
  const files=[...(e.clipboardData?.files||[])].filter(f=>f.type.startsWith('image/'));
  if (files.length){ e.preventDefault(); return imgSlotPut(z, files); }
  const txt=(e.clipboardData && e.clipboardData.getData('text/plain')||'').trim();
  if (/^(https?:|data:image\/)/i.test(txt)){ e.preventDefault(); const f=await imgFromUrl(txt); if (f) imgSlotPut(z,[f]); }
});

// ---------- логотип производителя: из каталога при точном совпадении названия производителя ----------
let LOGOS=null;
async function loadLogos(force){ if (LOGOS && !force) return LOGOS; try{ LOGOS=await api('/api/logos'); }catch(e){ LOGOS=LOGOS||{}; } return LOGOS; }
function logoFor(maker){ const k=String(maker||'').trim().toLowerCase(); return k && LOGOS ? LOGOS[k] || null : null; }
// подставить логотип, если его нет; true — подставлен
function autoLogo(x){
  if (!x || (x.logo && x.logo.src)) return false;
  const lg=logoFor(attrsOf(x).maker); if (!lg) return false;
  x.logo={src:lg.src, w:lg.w, h:lg.h, auto:lg.maker}; return true;
}
