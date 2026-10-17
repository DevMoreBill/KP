// Вход менеджеров в конструктор по логину и паролю (включает администратор: «Настройки → Менеджеры и доступ»).
// Выключен — менеджер выбирается на устройстве. Включён — без входа программа не открывается,
// «кто работает» — вошедший менеджер, права (каталог, чужие КП, экономика) проверяет сервер; здесь — только скрываем лишнее.
'use strict';

const AUTH = { enabled:false, user:null, admin:false, perms:[], shown:false, help:'', sessionDays:0, shortHours:0, pwMin:4 };

async function authLoad(){
  try{ const r=await api('/api/auth/status'); Object.assign(AUTH, {enabled:!!r.enabled, user:r.user||null, admin:!!r.admin, perms:r.perms||[], help:r.help||'', sessionDays:r.sessionDays||0, shortHours:r.shortHours||0, pwMin:r.pwMin||4}); }catch(e){}
}

// право менеджера: при выключенном входе и у администратора — всё можно; особые права (Powers.STRICT) — только
// администратору и менеджеру, вошедшему по паролю, которому их выдали
function can(p){ if (AUTH.admin || ADMIN.on) return true; if (Powers.STRICT.includes(p)) return Powers.has(p); if (!AUTH.enabled) return true; return !!(AUTH.user && AUTH.user.perms && AUTH.user.perms[p]); }
const CAN_TXT = { catAdd:'добавлять оборудование', catEdit:'редактировать оборудование', kpOthers:'открывать КП других менеджеров', dealView:'смотреть экономику сделки',
  catDelete:'удалять товары', catSelfMod:'принимать правки других', export:'выгружать каталог и клиентов' };

// особые права менеджеров («Настройки → Менеджеры»): удалять товары (в корзину), правки без модерации, выгрузка каталога и
// клиентов. Сервер проверяет их сам (catalog_admin.py); здесь — показать или скрыть кнопки
class Powers {
  static STRICT = ['catDelete', 'catSelfMod', 'export'];
  static has(p){ return AUTH.admin || ADMIN.on || !!(AUTH.enabled && AUTH.user && AUTH.user.perms && AUTH.user.perms[p]); }
}
function cannot(p){ toast('Нет права '+(CAN_TXT[p]||p)+' — обратитесь к администратору'); }

// Поля и отправка форм входа — у менеджера (экран входа) и у администратора («Настройки»): показать пароль, Caps Lock,
// кнопка занята на время запроса, понятная ошибка, пауза после неверных паролей — с обратным отсчётом (Retry-After),
// на телефоне кнопка не прячется под экранную клавиатуру (visualViewport).
class LoginForm {
  static EYE = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path class="pw-x" d="M4 4l16 16"/></svg>';

  // поле пароля: кнопка «показать», предупреждение Caps Lock
  static pw(id, label, ac, attrs=''){
    return `<div class="f"><label for="${id}">${label}</label><span class="pw-box"><input type="password" id="${id}" autocomplete="${ac}" autocapitalize="none" autocorrect="off" spellcheck="false" required ${attrs}>`
      +`<button type="button" class="pw-eye" data-eye="${id}" aria-label="Показать пароль" aria-pressed="false" title="Показать пароль">${LoginForm.EYE}</button></span>`
      +`<small class="pw-caps" hidden>Включён Caps Lock — пароль вводится заглавными</small></div>`;
  }
  static login(id, label, value='', attrs=''){
    return `<label class="f"><span>${label}</span><input type="text" id="${id}" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required value="${esc(value)}" ${attrs}></label>`;
  }

  // f — форма, send() — запрос (бросает Error; err.wait — сколько секунд вход закрыт), err — элемент для ошибки, busy — надпись кнопки на время запроса
  static bind(f, send, err, busy='Вход…'){
    f.addEventListener('click', e=>{ const b=e.target.closest('[data-eye]'); if (!b) return; const i=f.querySelector('#'+b.dataset.eye), show=i.type==='password';
      i.type=show?'text':'password'; b.setAttribute('aria-pressed', String(show)); b.title=show?'Скрыть пароль':'Показать пароль'; b.setAttribute('aria-label', b.title);
      b.classList.toggle('on', show); i.focus({preventScroll:true}); });
    const caps=e=>{ if (!e.getModifierState) return; const on=e.getModifierState('CapsLock');
      f.querySelectorAll('.pw-caps').forEach(c=>{ c.hidden=!(on && c.closest('.f').contains(document.activeElement)); }); };
    f.addEventListener('keydown', caps); f.addEventListener('keyup', caps);
    f.addEventListener('focusout', ()=>setTimeout(()=>f.querySelectorAll('.pw-caps').forEach(c=>{ if (!c.closest('.f').contains(document.activeElement)) c.hidden=true; }), 0));
    const btn=f.querySelector('button[type=submit]'), label=btn.textContent;
    f.onsubmit=async e=>{ e.preventDefault(); if (btn.disabled) return;
      err.hidden=true; err.textContent=''; btn.disabled=true; btn.setAttribute('aria-busy','true'); btn.textContent=busy;
      let wait=0;
      try{ await send(); }
      catch(x){ wait=x.wait||0; LoginForm.error(err, x.message||String(x)); const pw=f.querySelector('input[autocomplete=current-password]')||f.querySelector('input[type=password]'); if (pw && !wait){ pw.focus(); pw.select(); } }
      finally{ btn.removeAttribute('aria-busy'); btn.textContent=label; btn.disabled=false; }
      if (wait) LoginForm._countdown(btn, err, wait, label); };
    LoginForm.keepVisible(f, btn);
  }
  static error(err, text){ err.textContent=text; err.hidden=false; }

  // новый пароль два раза: проверка до запроса (то же проверяет сервер) → [новый, повтор]
  static newPw(f, a, b){
    const n=f.querySelector('#'+a).value, n2=f.querySelector('#'+b).value, min=AUTH.pwMin||4;
    if (!n) throw new Error('Введите новый пароль');
    if (n.length<min) throw new Error(`Пароль — не короче ${min} символов`);
    if (n!==n2) throw new Error(n2 ? 'Новый пароль и повтор не совпадают' : 'Повторите новый пароль');
    return [n, n2];
  }

  // вход закрыт после неверных паролей: кнопка недоступна, в ошибке — сколько ждать
  static _countdown(btn, err, sec, label){
    const end=Date.now()+sec*1000, base=err.textContent.replace(/(—|\.)\s*(вход с этого компьютера )?(снова через|закрыт на).*$/i, '').trim();
    btn.disabled=true;
    const tick=()=>{ const s=Math.max(0, Math.ceil((end-Date.now())/1000));
      if (!s || !btn.isConnected){ btn.disabled=false; btn.textContent=label; err.hidden=true; return; }
      btn.textContent=`Вход через ${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
      err.textContent=(base||'Слишком много неверных попыток')+'. Вход с этого компьютера временно закрыт — защита от подбора пароля.';
      setTimeout(tick, 1000); };
    tick();
  }

  // запрос входа: ошибка — текстом сервера; 429 — с числом секунд паузы (err.wait)
  static async post(url, body){
    let r;
    try{ r=await fetch(url, {method:'POST', headers:{'Content-Type':'application/json; charset=utf-8'}, body:JSON.stringify(body)}); }
    catch(e){ throw new Error('Нет связи с программой — проверьте, что компьютер-сервер включён, и повторите'); }
    if (r.ok) return r.json();
    const e=new Error((await r.text().catch(()=>'')) || ('Ошибка входа ('+r.status+')'));
    if (r.status===429) e.wait=Math.max(1, parseInt(r.headers.get('Retry-After'), 10) || 60);
    throw e;
  }

  // телефон: экранная клавиатура уменьшает видимую область — прокрутить так, чтобы кнопка была над клавиатурой
  static keepVisible(f, btn){
    const vv=window.visualViewport; if (!vv) return;
    const box=f.closest('.auth-wrap,.st-login'); if (!box) return;
    const fit=()=>{ if (!f.isConnected){ vv.removeEventListener('resize', fit); return; }
      const kb=Math.max(0, innerHeight-vv.height-vv.offsetTop), typing=kb>80 && f.contains(document.activeElement);
      box.style.paddingBottom=typing ? kb+'px' : '';
      if (!typing) return;
      const over=btn.getBoundingClientRect().bottom+12-(vv.offsetTop+vv.height);
      if (over>0) box.scrollTop+=over; };
    vv.addEventListener('resize', fit);
    f.addEventListener('focusin', ()=>setTimeout(fit, 350));
  }
}

// экран входа менеджера (вход по паролю включён, сессии нет)
class AuthScreen {
  static show(msg){
    if (AUTH.shown) return; AUTH.shown=true;
    const days=AUTH.sessionDays||30, hours=AUTH.shortHours||12;
    const help=AUTH.help ? `<p><b>${esc(AUTH.help)}</b></p>` : '';
    document.body.insertAdjacentHTML('beforeend', `<div class="auth-wrap" id="authWrap"><form class="auth-card" id="authForm" autocomplete="on" novalidate>
      <div class="auth-brand"><div class="auth-logo">ПНЕВМО<span>ТЕХ</span></div><div class="auth-app">Конструктор КП<small id="authVer"></small></div></div>
      ${msg?`<p class="msg warn auth-note">${esc(msg)}</p>`:'<p class="muted auth-note">Войдите под своим логином — его и пароль выдаёт администратор.</p>'}
      ${LoginForm.login('authLogin', 'Логин', AuthScreen._last())}
      ${LoginForm.pw('authPw', 'Пароль', 'current-password', 'name="password"')}
      <div class="auth-rem"><label><input type="checkbox" id="authRem"${AuthScreen._remember()?' checked':''}> Запомнить меня на этом устройстве</label>
        ${tip(`<p>С галочкой вход действует ${days} дн. — пароль не нужно вводить каждый день.</p><p>На чужом или общем компьютере снимите её: вход закроется, когда закроете браузер (и не позже чем через ${hours} ч).</p>`)}</div>
      <p class="auth-err" id="authErr" role="alert" aria-live="assertive" hidden></p>
      <button class="btn primary auth-go" type="submit">Войти</button>
      <div class="auth-foot"><button type="button" class="auth-lnk" id="authForgot" aria-expanded="false" aria-controls="authHelp">Забыли пароль?</button>
        <button type="button" class="auth-lnk" id="authAdm">Вход администратора</button></div>
      <div class="auth-help" id="authHelp" hidden>${help}<p>Пароль не восстанавливается автоматически: новый задаёт администратор программы в «Настройках» (раздел «Сотрудники и вход»). Обратитесь к нему — после смены пароля войдите с новым.</p></div></form></div>`);
    const f=$('#authForm');
    LoginForm.bind(f, AuthScreen._send, $('#authErr'));
    f.querySelector('#authLogin').addEventListener('input', ()=>{ $('#authErr').hidden=true; });
    $('#authAdm').onclick=()=>AuthScreen._admin();
    $('#authForgot').onclick=e=>{ const h=$('#authHelp'), open=h.hidden; h.hidden=!open; e.currentTarget.setAttribute('aria-expanded', String(open)); };
    loadAppVersion().then(()=>{ const v=$('#authVer'); if (v && APP_VERSION) v.textContent='версия '+APP_VERSION; });
    setTimeout(()=>{ const l=$('#authLogin'); (l && l.value ? $('#authPw') : l)?.focus(); }, 30);
  }

  static async _send(){
    const login=$('#authLogin').value.trim(), password=$('#authPw').value;
    if (!login || !password) throw new Error(!login ? 'Введите логин' : 'Введите пароль');
    const remember=$('#authRem').checked;
    await LoginForm.post('/api/auth/login', {login, password, remember});
    try{ localStorage.setItem('kp.userLogin', remember ? login : ''); localStorage.setItem('kp.userRemember', remember ? '1' : '0'); }catch(e){}
    location.reload();
  }
  // вошёл с временным паролем от администратора: сначала свой пароль (сервер до смены ничего другого не выполняет)
  static change(){
    if (AUTH.changing) return; AUTH.changing=AUTH.shown=true;
    $('#authWrap')?.remove();
    const u=AUTH.user||{}, min=AUTH.pwMin||4;
    document.body.insertAdjacentHTML('beforeend', `<div class="auth-wrap" id="authWrap"><form class="auth-card" id="authNew" autocomplete="on" novalidate>
      <div class="auth-brand"><div class="auth-logo">ПНЕВМО<span>ТЕХ</span></div><div class="auth-app">Задайте свой пароль</div></div>
      <p class="muted auth-note">${u.name?`<b>${esc(u.name)}</b>, в`:'В'}ы вошли с временным паролем от администратора. Придумайте свой — не короче ${min} символов; его будете знать только вы.</p>
      <input type="text" name="username" autocomplete="username" value="${esc(u.login||'')}" hidden>
      ${LoginForm.pw('authNew1', 'Новый пароль', 'new-password', `name="new-password" minlength="${min}"`)}
      ${LoginForm.pw('authNew2', 'Новый пароль ещё раз', 'new-password')}
      <p class="auth-err" id="authErr" role="alert" aria-live="assertive" hidden></p>
      <button class="btn primary auth-go" type="submit">Сохранить и продолжить</button>
      <div class="auth-foot"><span class="muted auth-small">После сохранения временный пароль не подойдёт</span><button type="button" class="auth-lnk" id="authOut">Выйти</button></div></form></div>`);
    const f=$('#authNew');
    LoginForm.bind(f, async()=>{ const [n, n2]=LoginForm.newPw(f, 'authNew1', 'authNew2');
      await LoginForm.post('/api/auth/password', {new:n, new2:n2}); location.reload(); }, $('#authErr'), 'Сохраняю…');
    $('#authOut').onclick=()=>AuthMenu.leave();
    setTimeout(()=>$('#authNew1')?.focus(), 30);
  }

  static _last(){ try{ return localStorage.getItem('kp.userLogin')||''; }catch(e){ return ''; } }
  static _remember(){ try{ return localStorage.getItem('kp.userRemember')!=='0'; }catch(e){ return true; } }

  // «Вход администратора»: «Настройки» поверх экрана входа; закрыли — вошёл администратор: программа открывается
  static _admin(){
    openSettings();
    const d=$('#setdlg'); if (!d) return;
    d.addEventListener('close', ()=>{ if (ADMIN.on) location.reload(); else $('#authLogin')?.focus(); }, {once:true});
  }
}

// «⋯»: «Вы вошли как …», «Сменить пароль», «Выйти на всех устройствах», «Выйти» (на телефоне — в меню «☰», mobile.js)
class AuthMenu {
  static on(){ return !!(AUTH.enabled && AUTH.user); }

  static mount(){
    if (!AuthMenu.on()) return;
    const m=document.querySelector('.topmenu .menu-l'); if (!m || $('#btnLogout')) return;
    m.insertAdjacentHTML('afterbegin', `<div class="auth-me"><small class="muted">Вы вошли как</small><b>${esc(AUTH.user.name)}</b></div>
      <button type="button" id="btnPw">Сменить пароль</button><button type="button" id="btnLogoutAll">Выйти на всех устройствах</button>
      <button type="button" id="btnLogout">Выйти из учётной записи</button><hr>`);
    const go=f=>()=>{ m.closest('details')?.removeAttribute('open'); f(); };
    $('#btnPw').onclick=go(()=>AuthMenu.password());
    $('#btnLogoutAll').onclick=go(()=>AuthMenu.logoutAll());
    $('#btnLogout').onclick=go(()=>AuthMenu.logout());
  }

  // пункты меню телефона: it(ключ, значок, название, пояснение) — как в openMobileMenu
  static mobileItems(it){
    return AuthMenu.on() ? it('authPw','⚿','Сменить пароль',esc(AUTH.user.name))+it('authOut','⎋','Выйти','Здесь или на всех устройствах') : '';
  }
  static mobile(k){ if (k==='authPw') AuthMenu.password(); else if (k==='authOut') AuthMenu.logout(); }

  // выйти здесь — или сразу на всех устройствах
  static async logout(){
    const v=await Modal.ask(`<h3>Выйти из программы?</h3><p>Черновик КП останется в этом браузере.</p>
      <div class="row auth-row"><button class="btn" type="button" data-v="0">Отмена</button><span class="sp"></span><button class="btn" type="button" data-v="all">Выйти на всех устройствах</button><button class="btn primary" type="button" data-v="here">Выйти</button></div>`);
    if (v==='all') return AuthMenu._all();
    if (v==='here') return AuthMenu.leave();
  }
  static async leave(){ try{ await api('/api/auth/logout',{method:'POST'}); }catch(e){} location.reload(); }

  static async logoutAll(){
    const v=await Modal.ask(`<h3>Выйти на всех устройствах?</h3><p>Вход закроется везде, где вы входили: на этом и других компьютерах и телефонах. Дальше — снова логин и пароль. Пригодится, если входили на чужом компьютере или потеряли телефон.</p>
      <div class="row"><button class="btn" type="button" data-v="0">Отмена</button><button class="btn primary" type="button" data-v="1">Выйти везде</button></div>`);
    if (v) AuthMenu._all();
  }
  static async _all(){
    try{ await api('/api/auth/logout-all',{method:'POST'}); }catch(e){ return toast(e.message||String(e)); }
    location.reload();
  }

  // «Сменить пароль»: текущий + новый дважды; другие входы закрываются, этот остаётся
  static password(){
    const min=AUTH.pwMin||4;
    const m=new Modal(`<form class="auth-pwf" novalidate><div class="dlg-h"><h3>Сменить пароль<small>${esc(AUTH.user.name)}</small></h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <input type="text" name="username" autocomplete="username" value="${esc(AUTH.user.login||'')}" hidden>
      ${LoginForm.pw('pwOld', 'Текущий пароль', 'current-password')}
      ${LoginForm.pw('pwNew1', `Новый пароль — не короче ${min} символов`, 'new-password', `minlength="${min}"`)}
      ${LoginForm.pw('pwNew2', 'Новый пароль ещё раз', 'new-password')}
      <p class="muted auth-note">На других компьютерах и телефонах вход закроется — там войдите с новым паролем. Здесь вы останетесь в программе.</p>
      <p class="auth-err" id="pwErr" role="alert" aria-live="assertive" hidden></p>
      <div class="row"><button class="btn" type="button" data-x>Отмена</button><button class="btn primary" type="submit">Сменить пароль</button></div></form>`, 'auth-pwd');
    m.d.addEventListener('click', e=>{ if (e.target.closest('[data-x]')) m.close(); });
    const f=m.$('form');
    LoginForm.bind(f, async()=>{ const old=f.querySelector('#pwOld').value; if (!old) throw new Error('Введите текущий пароль');
      const [n, n2]=LoginForm.newPw(f, 'pwNew1', 'pwNew2');
      const r=await LoginForm.post('/api/auth/password', {old, new:n, new2:n2});
      m.close(); toast('Пароль изменён'+(r.closed?' — на других устройствах вход закрыт':'')); }, m.$('#pwErr'), 'Сохраняю…');
    setTimeout(()=>m.$('#pwOld')?.focus(), 30);
  }
}
