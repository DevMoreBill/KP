// Связь с сервером программы: запросы к API, загрузка изображений, работа по сети с сервером отдела.
'use strict';

const SRV = { on:false, info:null };

async function api(path, opts={}){
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error((await r.text()) || ('HTTP '+r.status));
  const ct = r.headers.get('content-type')||''; return ct.includes('json') ? r.json() : r.text();
}

// place — куда положить на сервере: {dir:'Раздел/Категория/Производитель', title:'Модель'} (см. imgPlace, app/images.py)
async function uploadImg(img, place){
  if (!img || !String(img.src).startsWith('data:')) return img;
  const ext = img.src.startsWith('data:image/png') ? 'png' : 'jpg';
  const q = `ext=${ext}&dir=${encodeURIComponent(place?.dir||'')}&title=${encodeURIComponent(place?.title||'')}`;
  const r = await api('/api/img?'+q, {method:'POST', body: await dataURLtoBlobAsync(img.src)});
  return { src:'/img/'+r.name, w:img.w, h:img.h };
}

function remoteResult(r){
  if (!r || !r.remote) return;
  if (r.download){ const f=document.createElement('iframe'); f.hidden=true; f.src=r.download; document.body.appendChild(f); setTimeout(()=>f.remove(),60000); }
  if (r.share){ copyToClipboard(r.share).then(ok=>toast((r.download?'Файл скачан. ':'')+'Папка на сервере: '+r.share+(ok?' (путь скопирован — вставьте в проводник)':''))); }
  else if (!r.download) toast('Папка КП находится на компьютере-сервере отдела. Попросите администратора указать docsShare в settings.json.');
}
