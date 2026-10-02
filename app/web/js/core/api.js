// Связь с сервером программы: запросы к API, загрузка изображений, работа по сети с сервером отдела.
'use strict';

const SRV = { on:false, info:null };

// сессия «Настроек» (администратор): CSRF-токен для изменяющих запросов (cookie сессии ставит сервер)
const ADMIN = { on:false, csrf:'' };

// каждый запрос подписывается выбранным менеджером — для журнала действий (это не вход по паролю)
async function api(path, opts={}){
  // подпись запроса — кто работает на этом устройстве (meId), а не менеджер открытого КП
  const me=typeof meId==='function' ? meId() : '', meNm=me&&typeof meName==='function' ? meName() : '';
  const headers = { ...(opts.headers||{}), 'X-KP-User-Id': encodeURIComponent(me||(typeof S!=='undefined'&&S.managerId)||''),
    'X-KP-User': encodeURIComponent(meNm||(typeof S!=='undefined'&&S.manager&&S.manager.name)||'') };
  if (ADMIN.csrf) headers['X-CSRF-Token'] = ADMIN.csrf;
  const r = await fetch(path, {...opts, headers});
  if (!r.ok) throw new Error((await r.text()) || ('HTTP '+r.status));
  const ct = r.headers.get('content-type')||''; return ct.includes('json') ? r.json() : r.text();
}

// place — что это за изображение (imgPlace): категория, производитель, модель; папку выбирает сервер
async function uploadImg(img, place){
  if (!img || !String(img.src).startsWith('data:')) return img;
  const ext = img.src.startsWith('data:image/png') ? 'png' : 'jpg';
  const q = 'ext='+ext+Object.entries(place||{}).map(([k,v])=>'&'+k+'='+encodeURIComponent(v||'')).join('');
  const r = await api('/api/img?'+q, {method:'POST', body: await dataURLtoBlobAsync(img.src)});
  return { src:'/img/'+r.name, w:img.w, h:img.h };
}

function remoteResult(r){
  if (!r || !r.remote) return;
  if (r.download){ const f=document.createElement('iframe'); f.hidden=true; f.src=r.download; document.body.appendChild(f); setTimeout(()=>f.remove(),60000); }
  if (r.share){ copyToClipboard(r.share).then(ok=>toast((r.download?'Файл скачан. ':'')+'Папка на сервере: '+r.share+(ok?' (путь скопирован — вставьте в проводник)':''))); }
  else if (!r.download) toast('Папка КП находится на компьютере-сервере отдела. Попросите администратора указать docsShare в settings.json.');
}
