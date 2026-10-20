// «Настройки → Сотрудники и система → Подключения и ключи → Битрикс24»: связь кабинета менеджера с Битрикс24 (сервер — app/bitrix.py,
// правила обмена — app/bitrix_rules.py). Вкладки: Связь (адрес вебхука — ключ хранится только на сервере, — проверка, обмен
// кнопками) · Обмен (направление: в обе стороны / только из Битрикса / только в Битрикс — общее и для сделок, дел, компаний) ·
// Как в Битрикс24 (воронки, стадии и поля сделки — features/crm/) · Менеджеры (пользователь Битрикса, участвует ли, своё направление и воронка) · Воронки (из каких загружать, этапы у каждой) ·
// Поля (поле программы ↔ поле Битрикса, направление, кто главный) · Что передаётся (товары, файлы, компании, дела) · Расписание ·
// Журнал и проверка (пробный прогон без записи, не отправленное, журнал по менеджеру) · Старые сделки (с даты, с предпросмотром).
'use strict';

class BitrixPanel {
  static v=null;        // настройка и состояние (/api/admin/bitrix), v.rules — действующие правила обмена
  static c=null;        // ответ проверки связи: воронки, стадии, пользователи, поля портала, подсказка по e-mail
  static m=null;
  static errOnly=false;   // журнал: только ошибки и предупреждения
  static logMid='';       // журнал: отбор по менеджеру
  static dry=null;        // результат пробного прогона
  static imp=null;        // предпросмотр загрузки старых сделок
  static TABS = [['link', 'Связь'], ['mirror', 'Как в Битрикс24'], ['flow', 'Обмен'], ['mgr', 'Менеджеры'], ['cats', 'Воронки'], ['fields', 'Поля'], ['send', 'Что передаётся'],
    ['sched', 'Расписание'], ['log', 'Журнал и проверка'], ['old', 'Старые сделки']];
  static DIR = { both:'В обе стороны', in:'Только из Битрикса в программу', out:'Только из программы в Битрикс', off:'Не передавать' };
  static DIR_SHORT = { both:'⇄ в обе стороны', in:'← из Битрикса', out:'→ в Битрикс', off:'не передавать' };
  static WIN = { last:'последняя правка', ours:'программа', theirs:'Битрикс' };
  static TASK_AS = { todo:'дело (универсальное)', call:'звонок', meet:'встреча', off:'не передавать' };
  static FIND = { inn:'только по ИНН', inn_name:'по ИНН, затем по названию', name:'только по названию' };
  static NEED_C = ['mgr', 'cats', 'fields'];   // вкладкам нужны списки из Битрикса

  static get tab(){ try{ return localStorage.getItem('kp.bxtab')||'link'; }catch(e){ return 'link'; } }
  static set tab(t){ try{ localStorage.setItem('kp.bxtab', t); }catch(e){ /* без памяти вкладки */ } }

  static async open(m, note){
    this.m=m;
    try{ this.v=await aapi('bitrix'); }catch(e){ m.innerHTML=`<p class="msg err">${esc(e.message||e)}</p>`; return; }
    this.render(note);
    if (this.NEED_C.includes(this.tab)) this.loadC();
  }
  static when(iso){ return iso ? Fmt.dateTime(iso) : '—'; }
  static R(){ return this.v.rules||{}; }
  /** <select> из пар [значение, подпись] */
  static sel(attrs, opts, cur, label){ return `<select ${attrs}${label?` aria-label="${esc(label)}"`:''}>${opts.map(([v, t])=>`<option value="${esc(v)}"${String(v)===String(cur??'')?' selected':''}>${esc(t)}</option>`).join('')}</select>`; }
  static chk(attrs, on, text){ return `<label class="cab-ck"><input type="checkbox" ${attrs}${on?' checked':''}> ${text}</label>`; }
  static dirOpts(list, withDef){ return [...(withDef?[['', withDef]]:[]), ...list.map(d=>[d, this.DIR[d]])]; }
  static catName(id){ const c=(this.c&&this.c.categories||[]).find(x=>x.id===String(id)); return c ? c.name : 'воронка '+id; }

  // ---------------------------------------------------------------- отрисовка
  static render(note){
    const t=this.TABS.some(x=>x[0]===this.tab) ? this.tab : 'link';
    const need=this.NEED_C.includes(t) && !this.c;
    this.m.innerHTML=`<div class="bx-tabs" role="tablist">${this.TABS.map(([k, l])=>`<button type="button" role="tab" data-bxtab="${k}" class="${k===t?'on':''}" aria-selected="${k===t}">${esc(l)}</button>`).join('')}</div>
      ${note?`<p class="msg${note.err?' err':''}" style="text-align:left">${esc(note.t)}</p>`:''}
      ${need ? `<div class="st-card"><p class="muted">${this.v.hasUrl?'Загружаю списки из Битрикс24 (воронки, стадии, пользователи, поля)…':'Сначала задайте адрес вебхука на вкладке «Связь».'}</p></div>` : this['t_'+t]()}`;
    this.bind(t);
  }
  static async loadC(){
    if (this.c || !this.v.hasUrl) return;
    try{ this.c=await ajson('bitrix/test', {}); this.render(); }
    catch(e){ this.render({t:'Нет связи с Битрикс24: '+(e.message||e), err:true}); }
  }

  // ---- Как в Битрикс24: воронки, стадии и поля сделки (features/crm/mirror-panel.js)
  static t_mirror(){ return this.v.hasUrl ? '<div id="bxMirror"><p class="muted">Загружаю…</p></div>' : '<div class="st-card"><p class="muted">Сначала задайте адрес вебхука на вкладке «Связь».</p></div>'; }

  // ---- Связь
  static t_link(){
    const v=this.v, q=v.queue||{}, L=v.linked||{}, R=this.R();
    const mode={ both:'в обе стороны', in:'только из Битрикса в программу', out:'только из программы в Битрикс' }[R.mode]||'в обе стороны';
    return `<div class="st-card"><div class="row"><p class="sub" style="margin:0">Битрикс24 — сделки, дела и КП</p><span class="sp"></span>
        <label class="sw"><input type="checkbox" id="bxOn"${v.on?' checked':''}${v.hasUrl?'':' disabled'}><span>${v.on?'включена':'выключена'}</span></label></div>
      <p class="muted">${v.on?`Обмен — <b>${esc(mode)}</b> (вкладка «Обмен»); изменения из Битрикса — раз в ${Math.round((v.pollSec||90)/60*10)/10} мин${R.sched&&R.sched.from?`, с ${esc(R.sched.from)} до ${esc(R.sched.to)}`:''}.`
        :'Задайте адрес вебхука, нажмите «Проверить связь», настройте вкладки «Обмен», «Менеджеры», «Воронки» — и включите.'}</p>
      ${v.on||q.queued?`<p class="bx-st">Последний обмен: <b>${esc(this.when(v.lastRun))}</b> · в Битриксе сделок <b>${L.deals||0}</b>, компаний <b>${L.companies||0}</b>, дел <b>${L.tasks||0}</b>
        · в очереди <b>${q.queued||0}</b>${q.failed?` · <span class="bad-t">с ошибкой ${q.failed}: ${esc(q.lastError||'')}</span>`:''}</p>
        <div class="row bx-btns"><button class="btn" type="button" id="bxRun"${v.on?'':' disabled'}>Обменяться сейчас</button>
          <button class="btn ghost" type="button" id="bxPull"${v.on?'':' disabled'} title="Забрать изменения и новые сделки, очередь не отправлять">Загрузить из Битрикса</button>
          ${q.failed?'<button class="btn" type="button" id="bxRetry">Отправить снова</button>':''}
          <button class="btn ghost" type="button" id="bxAll"${v.on?'':' disabled'} title="Все сделки программы, включая закрытые">Выгрузить все сделки</button></div>
        <div class="row bx-btns"><label class="f bx-num"><span>Выгрузить сделку №</span><input type="text" id="bxNum" inputmode="numeric" placeholder="номер сделки"></label>
          <button class="btn" type="button" id="bxPush"${v.on?'':' disabled'}>Выгрузить сейчас</button></div>`:''}</div>
    <div class="st-card"><p class="sub">Подключение</p>
      <label class="f"><span>Адрес входящего вебхука ${v.hasUrl?`<b class="ok-t">задан: ${esc(v.url)}</b>`:''}</span><input type="password" id="bxUrl" autocomplete="off" placeholder="${v.hasUrl?'Новый адрес — заменит текущий':'https://bitrix24.kompr.ru/rest/1/ключ/'}"></label>
      <div class="row" style="margin-top:10px"><button class="btn primary" type="button" id="bxTest">${v.hasUrl?'Проверить связь':'Сохранить и проверить'}</button>${v.hasUrl?'<button class="btn ghost" type="button" id="bxDel">Удалить адрес</button>':''}</div>
      ${this.c?`<p class="ok-t" style="margin:8px 0 0">Связь есть: ${esc(this.c.user)}${this.c.admin?' (администратор портала)':''}</p>`:''}
      <details class="more"><summary>Как получить адрес вебхука</summary><ol class="muted">
        <li>В Битрикс24 под администратором: «Приложения» → «Разработчикам» → «Другое» → «Входящий вебхук».</li>
        <li>Права: «CRM (crm)», «Пользователи (user)», «Диск (disk)» — для файлов КП; сохраните.</li>
        <li>Скопируйте «Вебхук для вызова rest api» (вида https://bitrix24.kompr.ru/rest/1/…/) и вставьте сюда. Никому не пересылайте: по этому адресу открыта CRM.</li>
        <li>Сервер программы должен открывать адрес Битрикса (проверка — кнопкой выше).</li></ol></details></div>`;
  }

  // ---- Обмен: направления
  static t_flow(){
    const R=this.R(), kinds=[['deal', 'Сделки', 'название, этап, дата, ответственный, сумма, экономика, новые сделки'], ['task', 'Дела', 'звонки, встречи, письма, задачи по сделкам'],
      ['company', 'Компании и контакты', 'компания сделки в Битриксе; компании, телефоны и почта из Битрикса — в справочник клиентов']];
    return `<div class="st-card"><p class="sub">Направление обмена</p>
      <div class="seg bx-seg" role="radiogroup">${['both', 'in', 'out'].map(d=>`<button type="button" data-bxmode="${d}" class="${R.mode===d?'on':''}" aria-pressed="${R.mode===d}">${esc(this.DIR[d])}</button>`).join('')}</div>
      <p class="muted bx-why">${R.mode==='in'?'В Битрикс ничего не пишется. Изменения и новые сделки из Битрикса приходят в программу; правки менеджера в программе остаются в программе (изменят в Битриксе — придёт значение Битрикса).'
        :R.mode==='out'?'Программа только отправляет: сделки, КП, экономику и дела. Изменения, сделанные в Битриксе, в программу не приходят.'
        :'Сделки, КП, экономика и дела уходят в Битрикс; стадии, даты, ответственные, дела и новые сделки приходят обратно. Кто главный при правке с обеих сторон — на вкладке «Поля».'}</p></div>
    <div class="st-card"><p class="sub">По видам данных</p>
      ${kinds.map(([k, l, h])=>`<div class="bx-map"><label>${esc(l)}<small class="muted">${esc(h)}</small></label>${this.sel(`data-bxflow="${k}"`, this.dirOpts(['both', 'in', 'out', 'off'], 'как общее: '+(this.DIR[R.mode]||'').toLowerCase()), (R.flow||{})[k]||'', l)}</div>`).join('')}
      <p class="muted">Свои направления у менеджеров — на вкладке «Менеджеры» (действует и общее, и своё).</p>
      <div class="row" style="margin-top:12px"><button class="btn primary" type="button" id="bxSaveFlow">Сохранить</button></div></div>`;
  }

  // ---- Менеджеры
  static t_mgr(){
    const v=this.v, c=this.c, R=this.R(), users={...(c.auto||{}), ...(v.users||{})}, M=R.mgr||{};
    const uOpts=[['', '— не сопоставлен —'], ...c.users.map(u=>[u.id, u.name+(u.email?' · '+u.email:'')])];
    const cats=[['', 'основная: '+this.catName(v.category||'0')], ...c.categories.map(x=>[x.id, x.name])];
    const fb=[['', 'загружать без ответственного'], ['skip', 'не загружать'], ...(v.managers||[]).map(m=>[m.id, 'отдать: '+m.name])];
    return `<div class="st-card"><p class="sub">Менеджеры программы ↔ пользователи Битрикса</p>
      <div class="tzi-tw"><table class="tzi-t bx-mt"><thead><tr><th>Менеджер</th><th>Пользователь Битрикса</th><th>Участвует</th><th>Направление</th><th>Воронка новых сделок</th></tr></thead><tbody>
      ${c.managers.map(m=>{ const x=M[m.id]||{on:true, dir:'', cat:''};
        return `<tr data-bxm="${esc(m.id)}"><td>${esc(m.name)}${c.auto[m.id]&&!(v.users||{})[m.id]?' <em class="muted">по e-mail</em>':''}</td>
          <td>${this.sel('data-k="user"', uOpts, users[m.id]||'', 'Пользователь Битрикса')}</td>
          <td><input type="checkbox" data-k="on"${x.on!==false?' checked':''} aria-label="Участвует в обмене"></td>
          <td>${this.sel('data-k="dir"', this.dirOpts(['both', 'in', 'out'], 'как общее'), x.dir||'', 'Направление')}</td>
          <td>${this.sel('data-k="cat"', cats, x.cat||'', 'Воронка новых сделок')}</td></tr>`; }).join('')}</tbody></table></div>
      <p class="muted">Не участвует — его сделки и дела не уходят в Битрикс и не приходят из него. «Только из Битрикса» — у него правки остаются в программе.</p>
      <div class="bx-map" style="margin-top:10px"><label>Новая сделка Битрикса, ответственный которой не сопоставлен</label>${this.sel('id="bxFb"', fb, R.fallback||'', 'Без сопоставленного ответственного')}</div>
      <div class="row" style="margin-top:12px"><button class="btn primary" type="button" id="bxSaveMgr">Сохранить</button></div></div>`;
  }

  // ---- Воронки и этапы
  static t_cats(){
    const v=this.v, c=this.c, R=this.R(), main=String(v.category||'0'), extra=new Set(R.cats||[]);
    const mgrCats=new Set(Object.values(R.mgr||{}).map(x=>x.cat).filter(Boolean));
    const shown=[main, ...c.categories.map(x=>x.id).filter(id=>id!==main && (extra.has(id) || mgrCats.has(id)))];
    const by=R.stagesBy||{}, stOf=cat=>(c.stagesBy||{})[cat];
    const block=cat=>{ const st=stOf(cat), cur=by[cat] || (cat===main ? v.stages||{} : {});
      return `<div class="bx-cat" data-bxcat="${esc(cat)}"><p class="sub">${esc(this.catName(cat))}${cat===main?' <em class="muted">основная</em>':''}${mgrCats.has(cat)?' <em class="muted">воронка менеджера</em>':''}</p>
        ${st ? v.stagesOur.map(s=>`<div class="bx-map"><label>${esc(s.label)}</label>${this.sel(`data-bxst="${esc(s.key)}"`, [['', '— не передавать —'], ...st.map(x=>[x.id, x.name+(x.sem==='S'?' (успех)':x.sem==='F'?' (провал)':'')])], cur[s.key]||'', s.label)}</div>`).join('')
          : `<p class="muted">Стадии загружаются…</p>`}</div>`; };
    return `<div class="st-card"><div class="bx-map"><label>Основная воронка — сюда уходят новые сделки программы</label>${this.sel('id="bxCat"', c.categories.map(x=>[x.id, x.name]), main, 'Основная воронка')}</div>
      <p class="sub" style="margin-top:12px">Загружать сделки ещё из воронок</p>
      <div class="bx-chips">${c.categories.filter(x=>x.id!==main).map(x=>this.chk(`data-bxcats="${esc(x.id)}"`, extra.has(x.id), esc(x.name))).join('')||'<span class="muted">Других воронок нет</span>'}</div>
      <p class="muted">Воронки менеджеров (вкладка «Менеджеры») загружаются всегда. У каждой воронки — своё соответствие этапов; без стадии этап не передаётся (стадия в Битриксе остаётся как есть), стадии «успех» и «провал» без пары — «Выиграно» и «Проиграно».</p></div>
    <div class="st-card">${shown.map(block).join('<hr class="bx-hr">')}
      <div class="row" style="margin-top:12px"><button class="btn primary" type="button" id="bxSaveCats">Сохранить</button></div></div>`;
  }

  // ---- Поля
  static t_fields(){
    const R=this.R(), F=R.fields||{}, pf=(this.c.fields||[]);
    const rows=(R.spec||[]).map(s=>{ const x=F[s.key]||{bx:s.bx, dir:s.def, win:'last'};
      const opts=[[s.bx, (s.bx.startsWith('UF_CRM_KP_') ? '＋ своё поле программы (' : 'стандартное поле (')+s.bx+')'], ...pf.filter(f=>f.code!==s.bx).map(f=>[f.code, f.title+' · '+f.code])];
      if (x.bx && !opts.some(o=>o[0]===x.bx)) opts.push([x.bx, x.bx]);       // выбранное раньше поле, которого нет в списке портала
      const bx=s.pick ? this.sel('data-k="bx"', opts, x.bx, 'Поле Битрикса') : `<code>${esc(s.bx)}</code>`;
      const win=s.shared ? this.sel('data-k="win"', Object.entries(this.WIN), x.win, 'Кто главный')+'' : '<span class="muted">—</span>';
      return `<tr data-bxf="${esc(s.key)}"${x.dir==='off'?' class="off"':''}><td>${esc(s.label)}</td><td>${bx}</td><td>${this.sel('data-k="dir"', s.dirs.map(d=>[d, this.DIR_SHORT[d]]), x.dir, 'Направление')}</td><td>${win}</td></tr>`; });
    return `<div class="st-card"><p class="sub">Поле программы ↔ поле сделки Битрикса</p>
      <div class="tzi-tw"><table class="tzi-t bx-ft"><thead><tr><th>Поле программы</th><th>Поле Битрикса</th><th>Направление</th><th>Правка с обеих сторон — главный</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
      <p class="muted">«Своё поле программы» программа создаёт в сделках Битрикса сама при первом обмене; можно выбрать любое поле портала (в том числе ваши). Экономика и прочие поля — только в Битрикс. Сумма «→ в Битрикс»: сделка без КП берёт сумму из Битрикса; «← из Битрикса» — всегда из Битрикса.</p>
      <div class="row" style="margin-top:12px"><button class="btn primary" type="button" id="bxSaveFields">Сохранить</button><button class="btn ghost" type="button" id="bxFieldsDef">Все поля — по умолчанию</button></div></div>`;
  }

  // ---- Что передаётся: товары, файлы, компании, дела
  static t_send(){
    const R=this.R(), S=R.send||{}, C=R.company||{}, T=R.tasks||{}, files=S.files||{};
    return `<div class="st-card"><p class="sub">Товары сделки</p>
      ${this.chk('id="bxRows"', S.rows!==false, 'Передавать товары')}
      <div class="bx-map"><label>Как</label>${this.sel('id="bxRowsHow"', [['kp', 'позиции последнего КП (цены со скидкой, с НДС)'], ['sum', 'одной строкой — итог КП']], S.rowsHow||'kp', 'Товары')}</div></div>
    <div class="st-card"><p class="sub">Файлы КП — в ленту сделки</p>
      <div class="bx-chips">${[['word', 'КП (Word)'], ['pdf', 'КП (PDF)'], ['refs', 'Справочные документы'], ['econ', 'Экономика сделки (Excel)']].map(([k, l])=>this.chk(`data-bxfile="${k}"`, files[k]!==false, esc(l))).join('')}</div>
      <div class="bx-map"><label>Файл больше, МБ, — не отправлять</label><input type="number" id="bxMB" min="1" max="100" inputmode="numeric" value="${S.fileMB||20}"></div></div>
    <div class="st-card"><p class="sub">Компании</p>
      <div class="bx-map"><label>Искать компанию в Битриксе</label>${this.sel('id="bxFind"', Object.entries(this.FIND), C.find||'inn_name', 'Поиск компании')}</div>
      ${this.chk('id="bxCreate"', C.create!==false, 'Не нашлась — создать компанию в Битриксе')}
      ${this.chk('id="bxReqs"', C.reqs!==false, 'С реквизитами (ИНН, КПП, ОГРН, адрес)')}
      <div class="bx-map"><label>Контакты (телефон, почта)</label>${this.sel('id="bxCons"', this.dirOpts(['both', 'in', 'out', 'off']), C.contacts||'both', 'Контакты')}</div></div>
    <div class="st-card"><p class="sub">Дела</p>
      ${[['call', 'Звонок'], ['meet', 'Встреча'], ['mail', 'Письмо'], ['task', 'Задача']].map(([k, l])=>`<div class="bx-map"><label>${esc(l)} → в Битриксе</label>${this.sel(`data-bxtask="${k}"`, Object.entries(this.TASK_AS), (T.kinds||{})[k]||'todo', l)}</div>`).join('')}
      ${this.chk('id="bxCancel"', T.cancel!==false, 'Передавать отмену дела («Отменено — …»)')}
      ${this.chk('id="bxOther"', T.other!==false, 'Загружать дела, заведённые в Битриксе вручную')}
      <div class="row" style="margin-top:12px"><button class="btn primary" type="button" id="bxSaveSend">Сохранить</button></div></div>`;
  }

  // ---- Расписание
  static t_sched(){
    const v=this.v, S=this.R().sched||{};
    return `<div class="st-card"><p class="sub">Расписание обмена</p>
      <div class="bx-map"><label>Спрашивать изменения раз в, с</label><input type="number" id="bxPoll" min="30" max="3600" inputmode="numeric" value="${v.pollSec||90}"></div>
      <div class="bx-map"><label>Часы обмена (пусто — круглосуточно)</label><span class="bx-hours"><input type="time" id="bxFrom" value="${esc(S.from||'')}" aria-label="С"> — <input type="time" id="bxTo" value="${esc(S.to||'')}" aria-label="До"></span></div>
      <div class="bx-map"><label>Записей за один обмен</label><input type="number" id="bxBatch" min="10" max="2000" inputmode="numeric" value="${S.batch||200}"></div>
      <div class="bx-map"><label>Попыток отправки записи (потом — «Не отправлено»)</label><input type="number" id="bxTries" min="1" max="100" inputmode="numeric" value="${S.tries||20}"></div>
      <p class="muted">Вне часов обмена фоновый обмен ждёт; кнопки «Обменяться сейчас», «Загрузить из Битрикса», «Выгрузить сделку» работают всегда. Повтор после ошибки — с паузой от 1 минуты до часа.</p>
      <div class="row" style="margin-top:12px"><button class="btn primary" type="button" id="bxSaveSched">Сохранить</button></div></div>`;
  }

  // ---- Журнал и проверка
  static t_log(){
    const v=this.v, d=this.dry, mg=v.managers||[], L=(v.log||[]).filter(x=>(!this.errOnly||x.level!=='info') && (!this.logMid||x.mid===this.logMid));
    const list=(a, empty)=>a.length?`<ul class="bx-dry">${a.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`:`<p class="muted">${empty}</p>`;
    return `<div class="st-card"><div class="row"><p class="sub" style="margin:0">Пробный прогон</p><span class="sp"></span><button class="btn" type="button" id="bxDry"${v.on?'':' disabled'}>Проверить без записи</button></div>
      <p class="muted">Обмен по текущим правилам на копии базы: что изменилось бы в Битриксе и в программе. Ничего не записывается, очередь не трогается.</p>
      ${d?`<div class="bx-dry2"><div><b>В Битриксе (${d.bitrix.length+(d.more||0)})</b>${list(d.bitrix, 'Ничего')}${d.more?`<p class="muted">и ещё ${d.more}</p>`:''}</div>
        <div><b>В программе (${d.program.length})</b>${list(d.program, 'Ничего')}</div></div>${d.errors.length?`<p class="bad-t">Ошибки: ${esc(d.errors.join('; '))}</p>`:''}`:''}</div>
    ${(v.failed||[]).length?`<div class="st-card"><p class="sub">Не отправлено <b class="bad-t">${v.failed.length}</b></p><div class="bx-fail">${v.failed.map(f=>`<div class="bx-f"><div><b>${esc(f.title)}</b><span class="bad-t">${esc(f.error)}</span><span class="muted">попыток ${f.tries} · с ${esc(Fmt.dateTime(f.added))}</span></div><button class="btn sm" type="button" data-bxre="${esc(f.kind)}|${esc(f.id)}">Повторить</button></div>`).join('')}</div></div>`:''}
    <div class="st-card"><div class="row"><p class="sub" style="margin:0">Журнал обмена</p><span class="sp"></span>
        ${this.sel('id="bxLogMid" data-nodirty', [['', 'Все менеджеры'], ...mg.map(m=>[m.id, m.name])], this.logMid, 'Менеджер')}
        <label class="cab-ck"><input type="checkbox" id="bxErr" data-nodirty${this.errOnly?' checked':''}> Только ошибки</label></div>
      ${L.length?`<div class="bx-log">${L.map(x=>`<div class="${x.level==='error'?'bad-t':x.level==='warn'?'warn-t':''}"><span class="muted">${esc(Fmt.dateTime(x.at))}</span> ${esc(x.text)}</div>`).join('')}</div>`
        :`<p class="empty">${this.errOnly||this.logMid?'Таких записей нет.':'Обменов ещё не было.'}</p>`}</div>`;
  }

  // ---- Старые сделки
  static t_old(){
    const v=this.v, p=this.imp, R=this.R(), cats=[String(v.category||'0'), ...(R.cats||[])];
    const act={ new:'новая', link:'связать', skip:'пропустить' };
    return `<div class="st-card"><p class="sub">Сделки Битрикса, созданные до включения связи</p>
      <p class="muted">Новые сделки воронок обмена приходят сами. Здесь — более ранние: с выбранной даты, по воронкам обмена. Сделка того же клиента (ИНН), открытая в программе и ещё не связанная, — связывается; остальные — новые сделки в программе (без отметки «новая из Битрикса»).</p>
      <div class="row bx-btns"><label class="f bx-num"><span>Созданные с</span><input type="date" id="bxFromD" value="${esc((p&&p.from)||'')}"></label>
        <button class="btn" type="button" id="bxImpPv"${v.on?'':' disabled'}>Показать</button></div>
      ${p?`<p class="muted">Найдено ${p.items.length}${p.items.length>=p.max?` (показаны первые ${p.max})`:''} · воронки: ${esc(cats.map(c=>this.catName(c)).join(', '))} · до ${esc(Fmt.date?Fmt.date(p.until):p.until)}</p>
        ${p.items.length?`<div class="tzi-tw"><table class="tzi-t bx-it"><thead><tr><th><input type="checkbox" id="bxImpAll" checked aria-label="Все"></th><th>Сделка Битрикса</th><th>Создана</th><th>Сумма</th><th>Этап</th><th>Менеджер</th><th>Что будет</th></tr></thead><tbody>
          ${p.items.map(x=>`<tr><td><input type="checkbox" data-bximp="${esc(x.id)}"${x.act==='skip'?' disabled':' checked'} aria-label="Загрузить"></td><td>${esc(x.title)} <span class="muted">№ ${esc(x.id)}</span></td><td>${esc(x.created)}</td><td>${x.sum?esc(Money.rub(+x.sum)):'—'}</td><td>${esc(x.stage)}</td><td>${esc(x.manager)}</td><td><b>${esc(act[x.act]||x.act)}</b> <span class="muted">${esc(x.why||'')}</span></td></tr>`).join('')}</tbody></table></div>
          <div class="row" style="margin-top:12px"><button class="btn primary" type="button" id="bxImpGo">Загрузить отмеченные</button></div>`:''}`:''}</div>`;
  }

  // ---------------------------------------------------------------- действия
  static async run(fn, ok){ try{ const r=await fn(); if (r && r.on!==undefined) this.v=r; this.render(ok?{t:typeof ok==='function'?ok(r):ok}:null); }catch(e){ this.render({t:String(e.message||e), err:true}); } }
  static save(body, msg){ return this.run(()=>ajson('bitrix', body), msg||'Сохранено'); }
  static result(r){ const x=r.result||{}; return x.error ? 'Ошибка: '+x.error : `Готово: отправлено ${x.sent||0}, получено изменений ${x.pulled||0}, новых сделок ${x.created||0}${x.skipped?` (пропущено по правилам ${x.skipped})`:''}, дел ${x.tasks||0}`; }

  static bind(t){
    const $m=s=>this.m.querySelector(s), all=s=>[...this.m.querySelectorAll(s)];
    all('[data-bxtab]').forEach(b=>{ b.onclick=()=>{ this.tab=b.dataset.bxtab; this.render(); if (this.NEED_C.includes(this.tab)) this.loadC(); }; });
    if (t==='mirror' && $m('#bxMirror')) MirrorPanel.open($m('#bxMirror'));
    if (t==='link'){
      $m('#bxOn').onchange=e=>this.run(()=>ajson('bitrix', {on:e.target.checked}), e.target.checked?'Связь включена: открытые сделки поставлены в очередь отправки':'Связь выключена: обмен остановлен, данные в Битриксе остаются');
      $m('#bxTest').onclick=async e=>{ e.target.disabled=true; e.target.textContent='Проверяю…';
        try{ const u=$m('#bxUrl').value.trim(); if (u) this.v=await ajson('bitrix', {url:u});
          this.c=await ajson('bitrix/test', {}); this.render({t:'Связь с Битрикс24 есть. Настройте вкладки «Обмен», «Менеджеры», «Воронки» и включите связь.'}); }
        catch(err){ this.render({t:String(err.message||err), err:true}); } };
      if ($m('#bxDel')) $m('#bxDel').onclick=async()=>{ if (!await stConfirm('Удалить адрес вебхука?', 'Обмен с Битрикс24 остановится. Данные в обеих системах останутся.', 'Удалить')) return;
        this.c=null; this.run(()=>ajson('bitrix', {url:''}), 'Адрес удалён, связь выключена'); };
      const busy=(b, t2)=>{ b.disabled=true; b.textContent=t2; };
      if ($m('#bxRun')) $m('#bxRun').onclick=e=>{ busy(e.target, 'Обмениваюсь…'); this.run(()=>ajson('bitrix/run', {}), r=>this.result(r)); };
      if ($m('#bxPull')) $m('#bxPull').onclick=e=>{ busy(e.target, 'Загружаю…'); this.run(()=>ajson('bitrix/pull', {}), r=>this.result(r)); };
      if ($m('#bxPush')) $m('#bxPush').onclick=e=>{ const n=$m('#bxNum').value.trim(); if (!n) return this.render({t:'Укажите номер сделки', err:true});
        busy(e.target, 'Выгружаю…'); this.run(()=>ajson('bitrix/push', {number:n}), r=>this.result(r)); };
      if ($m('#bxRetry')) $m('#bxRetry').onclick=()=>this.run(()=>ajson('bitrix/resend', {}), 'Записи с ошибкой будут отправлены при следующем обмене');
      if ($m('#bxAll')) $m('#bxAll').onclick=async()=>{ if (!await stConfirm('Выгрузить все сделки?', 'Все сделки программы, включая выигранные и проигранные, будут отправлены в Битрикс24 (уже связанные — обновятся).', 'Выгрузить')) return;
        this.run(()=>ajson('bitrix/resend', {what:'all'}), r=>`В очередь поставлено сделок: ${r.queued||0}`); };
    }
    if (t==='flow'){
      let mode=this.R().mode;
      all('[data-bxmode]').forEach(b=>{ b.onclick=()=>{ mode=b.dataset.bxmode; all('[data-bxmode]').forEach(x=>{ x.classList.toggle('on', x===b); x.setAttribute('aria-pressed', x===b); }); }; });
      $m('#bxSaveFlow').onclick=()=>{ const flow={}; all('[data-bxflow]').forEach(s=>{ if (s.value) flow[s.dataset.bxflow]=s.value; }); this.save({mode, flow}); };
    }
    if (t==='mgr' && this.c){
      $m('#bxSaveMgr').onclick=()=>{ const users={}, mgr={};
        all('[data-bxm]').forEach(r=>{ const id=r.dataset.bxm, q=k=>r.querySelector(`[data-k="${k}"]`);
          if (q('user').value) users[id]=q('user').value;
          mgr[id]={ on:q('on').checked, dir:q('dir').value, cat:q('cat').value }; });
        this.save({users, mgr, fallback:$m('#bxFb').value}); };
    }
    if (t==='cats' && this.c){
      const need=[...new Set(all('[data-bxcat]').map(b=>b.dataset.bxcat))].filter(c=>!(this.c.stagesBy||{})[c]);
      need.forEach(async cat=>{ try{ const r=await ajson('bitrix/stages', {category:cat}); this.c.stagesBy={...(this.c.stagesBy||{}), [cat]:r.stages}; if (this.tab==='cats') this.render(); }
        catch(e){ this.render({t:String(e.message||e), err:true}); } });
      const collect=()=>{ const stagesBy={}; all('[data-bxcat]').forEach(b=>{ const m={}; b.querySelectorAll('[data-bxst]').forEach(s=>{ if (s.value) m[s.dataset.bxst]=s.value; });
        if (b.querySelector('[data-bxst]')) stagesBy[b.dataset.bxcat]=m; }); return stagesBy; };
      $m('#bxCat').onchange=e=>this.save({category:e.target.value}, 'Основная воронка изменена — проверьте этапы');
      all('[data-bxcats]').forEach(c=>{ c.onchange=()=>{ const cats=all('[data-bxcats]').filter(x=>x.checked).map(x=>x.dataset.bxcats);
        this.save({cats, stagesBy:collect()}, 'Воронки обмена изменены — сопоставьте этапы'); }; });
      $m('#bxSaveCats').onclick=()=>{ const sb=collect(), main=String(this.v.category||'0'); this.save({stagesBy:sb, ...(sb[main]?{stages:sb[main]}:{})}); };
    }
    if (t==='fields' && this.c){
      all('[data-bxf] [data-k="dir"]').forEach(s=>{ s.onchange=()=>s.closest('tr').classList.toggle('off', s.value==='off'); });
      $m('#bxSaveFields').onclick=()=>{ const fields={};
        all('[data-bxf]').forEach(r=>{ const q=k=>r.querySelector(`[data-k="${k}"]`), x={dir:q('dir').value}; if (q('bx')) x.bx=q('bx').value; if (q('win')) x.win=q('win').value; fields[r.dataset.bxf]=x; });
        this.save({fields}); };
      $m('#bxFieldsDef').onclick=async()=>{ if (!await stConfirm('Все поля — по умолчанию?', 'Направления, поля Битрикса и «кто главный» вернутся к исходным: экономика — в свои поля программы, прочие поля не передаются.', 'Вернуть')) return;
        this.save({fields:{}}, 'Поля — по умолчанию'); };
    }
    if (t==='send'){
      $m('#bxSaveSend').onclick=()=>{ const files={}; all('[data-bxfile]').forEach(c=>{ files[c.dataset.bxfile]=c.checked; }); const kinds={}; all('[data-bxtask]').forEach(s=>{ kinds[s.dataset.bxtask]=s.value; });
        this.save({ send:{rows:$m('#bxRows').checked, rowsHow:$m('#bxRowsHow').value, files, fileMB:$m('#bxMB').value},
          company:{find:$m('#bxFind').value, create:$m('#bxCreate').checked, reqs:$m('#bxReqs').checked, contacts:$m('#bxCons').value},
          tasks:{kinds, cancel:$m('#bxCancel').checked, other:$m('#bxOther').checked} }); };
    }
    if (t==='sched'){
      $m('#bxSaveSched').onclick=()=>this.save({pollSec:+$m('#bxPoll').value||90, sched:{from:$m('#bxFrom').value, to:$m('#bxTo').value, batch:$m('#bxBatch').value, tries:$m('#bxTries').value}});
    }
    if (t==='log'){
      $m('#bxErr').onchange=e=>{ this.errOnly=e.target.checked; this.render(); };
      $m('#bxLogMid').onchange=e=>{ this.logMid=e.target.value; this.render(); };
      $m('#bxDry').onclick=async e=>{ e.target.disabled=true; e.target.textContent='Проверяю…';
        try{ this.dry=await ajson('bitrix/dry', {}); this.render({t:'Пробный прогон готов — ничего не записано'}); }catch(err){ this.render({t:String(err.message||err), err:true}); } };
      all('[data-bxre]').forEach(b=>{ b.onclick=()=>{ const [kind, id]=b.dataset.bxre.split('|'); b.disabled=true; b.textContent='Отправляю…';
        this.run(()=>ajson('bitrix/resend', {kind, id}), r=>{ const x=r.result||{}; return x.error ? 'Не отправлено: '+x.error : x.failed ? 'Снова ошибка — см. «Не отправлено»' : 'Отправлено'; }); }; });
    }
    if (t==='old'){
      $m('#bxImpPv').onclick=async e=>{ const from=$m('#bxFromD').value; if (!from) return this.render({t:'Выберите дату', err:true});
        e.target.disabled=true; e.target.textContent='Ищу…';
        try{ this.imp={...await ajson('bitrix/import/preview', {from}), from}; this.render(); }catch(err){ this.render({t:String(err.message||err), err:true}); } };
      if ($m('#bxImpAll')) $m('#bxImpAll').onchange=e=>all('[data-bximp]:not(:disabled)').forEach(c=>{ c.checked=e.target.checked; });
      if ($m('#bxImpGo')) $m('#bxImpGo').onclick=async()=>{ const ids=all('[data-bximp]:checked').map(c=>c.dataset.bximp); if (!ids.length) return this.render({t:'Ничего не отмечено', err:true});
        if (!await stConfirm(`Загрузить сделок: ${ids.length}?`, 'Сделки Битрикса появятся в кабинете у своих менеджеров; связанные — обновятся при следующем обмене.', 'Загрузить')) return;
        const from=this.imp.from; this.imp=null;
        this.run(()=>ajson('bitrix/import', {from, ids}), r=>{ const x=r.result||{}; return `Загружено: новых ${x.created||0}, связано ${x.linked||0}, пропущено ${x.skipped||0}`; }); };
    }
  }
}
