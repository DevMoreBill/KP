// Связь с сервером программы: запросы к API, загрузка изображений, работа по сети с сервером отдела.
'use strict';

const SRV = { on:false, info:null };

// сессия «Настроек» (администратор): CSRF-токен для изменяющих запросов (cookie сессии ставит сервер).
// Вход и выход — через set: о смене узнают те, кто показывает пункты только администратору (событие kp:admin)
const ADMIN = { on:false, csrf:'',
  set(on, csrf){ const was=this.on; this.on=!!on; this.csrf=this.on ? csrf||'' : ''; if (was!==this.on) document.dispatchEvent(new Event('kp:admin')); } };

// каждый запрос подписывается выбранным менеджером — для журнала действий (это не вход по паролю)
async function api(path, opts={}){
  // подпись запроса — кто работает на этом устройстве (meId), а не менеджер открытого КП
  const me=meId(), meNm=me ? meName() : '';
  const headers = { ...(opts.headers||{}), 'X-KP-User-Id': encodeURIComponent(me||S.managerId||''),
    'X-KP-User': encodeURIComponent(meNm||(S.manager&&S.manager.name)||'') };
  if (ADMIN.csrf) headers['X-CSRF-Token'] = ADMIN.csrf;
  const r = await fetch(path, {...opts, headers});
  if (r.status===409){   // запись успели изменить, пока она была открыта: спросить, перезаписать ли
    let info=null; try{ info=await r.clone().json(); }catch(e){}
    if (info && info.conflict){
      if (!opts.retried && conflictAsk(info, path)) return api(path, {...opts, retried:true, headers:{...(opts.headers||{}), 'X-KP-Rev':String(info.rev)}});
      const err=new Error('не сохранено — запись уже изменил(а) '+(info.by||'другой пользователь')+'. Откройте её заново, чтобы увидеть изменения');
      err.code='conflict'; err.info=info; throw err; } }
  if (r.status===403 && r.headers.get('X-KP-Auth')==='change-password') AuthScreen.change();     // вошёл с временным паролем
  if (r.status===401 && AUTH.enabled && !/^\/api\/(admin|auth)\//.test(path)) AuthScreen.show('Сессия закончилась — войдите снова.');
  if (!r.ok){ const err=new Error((await r.text()) || ('HTTP '+r.status)); err.status=r.status; throw err; }
  // сохранение в «Настройках» прошло — отметка «несохранённые изменения» снимается (проверки и предпросмотр — не сохранение)
  if ((opts.method||'GET')!=='GET' && !/\/(preview|test|check|pdf)\b|\/connections\b/.test(path)) StDirty.saved();
  if (opts.raw) return r;      // файл (выгрузка): ответ целиком — blob и имя из заголовка
  const ct = r.headers.get('content-type')||''; return ct.includes('json') ? r.json() : r.text();
}

// совместная работа: запись изменили после того, как её открыли у нас
function conflictTime(at){ const d=new Date(at); return isNaN(d) ? '' : d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); }
function conflictAsk(info, path){
  const kp=/^\/api\/kp\//.test(path), t=conflictTime(info.at);
  return confirm((kp?'Это КП':'Эту запись')+' уже изменил(а) '+(info.by||'другой пользователь')+(t?' ('+t+')':'')+(kp?', пока оно было открыто у вас.':', пока она была открыта у вас.')+'\n\n'
    +'ОК — сохранить вашу версию поверх'+(kp?' (версия коллеги останется в «Истории версий» КП)':'')+'.\n'
    +'Отмена — не сохранять: откройте '+(kp?'КП из журнала':'запись заново')+', чтобы увидеть изменения.');
}

// place — что это за изображение (imgPlace): категория, производитель, модель; папку выбирает сервер
// картинка из data: — файлом на сервер (папка картинок); пометки картинки (3D-вид станции: gen, hash) сохраняются
class ImgUpload {
  static async put(img, place){
    if (!img || !String(img.src).startsWith('data:')) return img;
    const ext = img.src.startsWith('data:image/png') ? 'png' : 'jpg';
    const q = 'ext='+ext+Object.entries(place||{}).map(([k,v])=>'&'+k+'='+encodeURIComponent(v||'')).join('');
    const r = await api('/api/img?'+q, {method:'POST', body: await dataURLtoBlobAsync(img.src)});
    return { ...img, src:'/img/'+r.name };
  }
}

function remoteResult(r){
  if (!r || !r.remote) return;
  if (r.download){ const f=document.createElement('iframe'); f.hidden=true; f.src=r.download; document.body.appendChild(f); setTimeout(()=>f.remove(),60000); }
  if (r.share){ copyToClipboard(r.share).then(ok=>toast((r.download?'Файл скачан. ':'')+'Папка на сервере: '+r.share+(ok?' (путь скопирован — вставьте в проводник)':''))); }
  else if (!r.download) toast('Папка КП находится на компьютере-сервере отдела. Попросите администратора указать docsShare в settings.json.');
}
