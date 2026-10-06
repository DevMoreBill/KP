// Вход менеджеров в конструктор по логину и паролю (включает администратор: «Настройки → Менеджеры и доступ»).
// Выключен — всё как раньше: менеджер выбирается на устройстве. Включён — без входа программа не открывается,
// «кто работает» — вошедший менеджер, права (каталог, чужие КП, экономика) проверяет сервер; здесь — только скрываем лишнее.
'use strict';

const AUTH = { enabled:false, user:null, admin:false, perms:[], shown:false };

async function authLoad(){
  try{ const r=await api('/api/auth/status'); Object.assign(AUTH, {enabled:!!r.enabled, user:r.user||null, admin:!!r.admin, perms:r.perms||[]}); }catch(e){}
}

// право менеджера: при выключенном входе и у администратора — всё можно
function can(p){ if (!AUTH.enabled || AUTH.admin || (typeof ADMIN!=='undefined' && ADMIN.on)) return true; return !!(AUTH.user && AUTH.user.perms && AUTH.user.perms[p]); }
const CAN_TXT = { catAdd:'добавлять оборудование', catEdit:'редактировать оборудование', kpOthers:'открывать КП других менеджеров', dealView:'смотреть экономику сделки' };
function cannot(p){ toast('Нет права '+(CAN_TXT[p]||p)+' — обратитесь к администратору'); }

function authScreen(msg){
  if (AUTH.shown) return; AUTH.shown=true;
  document.body.insertAdjacentHTML('beforeend', `<div class="auth-wrap" id="authWrap"><form class="auth-card" id="authForm" autocomplete="on">
    <div class="auth-logo">ПНЕВМО<span>ТЕХ</span></div><h2>Конструктор КП</h2>
    <p class="muted">${esc(msg||'Войдите под своим логином. Логин и пароль выдаёт администратор.')}</p>
    <label class="f"><span>Логин</span><input id="authLogin" name="username" autocomplete="username" required autofocus></label>
    <label class="f"><span>Пароль</span><input id="authPw" name="password" type="password" autocomplete="current-password" required></label>
    <p class="msg err" id="authErr" hidden></p>
    <button class="btn primary" type="submit">Войти</button>
    <p class="muted auth-adm">Администратор: <a href="#" id="authAdm">войти в «Настройки»</a></p></form></div>`);
  $('#authForm').onsubmit=async e=>{ e.preventDefault(); const er=$('#authErr'); er.hidden=true;
    try{ await api('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:$('#authLogin').value, password:$('#authPw').value})});
      location.reload(); }
    catch(x){ er.textContent=String(x.message||x); er.hidden=false; $('#authPw').select(); } };
  $('#authAdm').onclick=e=>{ e.preventDefault(); $('#authWrap').remove(); AUTH.shown=false; openSettings(); };
  setTimeout(()=>$('#authLogin')?.focus(), 30);
}

async function authLogout(){
  if (!confirm('Выйти из программы? Черновик КП останется в этом браузере.')) return;
  try{ await api('/api/auth/logout',{method:'POST'}); }catch(e){}
  location.reload();
}

// строка «вы вошли как …» и «Выйти» в меню «⋯»
function authMenu(){
  if (!AUTH.enabled || !AUTH.user) return;
  const m=document.querySelector('.topmenu .menu-l'); if (!m || $('#btnLogout')) return;
  m.insertAdjacentHTML('afterbegin', `<div class="auth-me"><small class="muted">Вы вошли как</small><b>${esc(AUTH.user.name)}</b></div><button type="button" id="btnLogout">Выйти из учётной записи</button><hr>`);
  $('#btnLogout').onclick=authLogout;
}
