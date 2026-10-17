// «Настройки → Сотрудники и система → Подключения и ключи → Битрикс24»: связь кабинета менеджера с Битрикс24 (сервер — app/bitrix.py).
// Адрес входящего вебхука (ключ хранится только на сервере и сюда не возвращается), проверка связи, воронка, «наш этап → стадия»,
// «менеджер → пользователь Битрикса» (по e-mail сами), как часто спрашивать изменения, очередь и журнал обмена.
'use strict';

class BitrixPanel {
  static v=null;        // настройка и состояние (/api/admin/bitrix)
  static c=null;        // ответ проверки: воронки, стадии, пользователи, подсказка по e-mail
  static m=null;
  static async open(m, note){
    this.m=m;
    try{ this.v=await aapi('bitrix'); }catch(e){ m.innerHTML=`<p class="msg err">${esc(e.message||e)}</p>`; return; }
    this.render(note);
  }
  static when(iso){ return iso ? Fmt.dateTime(iso) : '—'; }
  static render(note){
    const v=this.v, c=this.c, q=v.queue||{}, L=v.linked||{};
    const stOpts=(cur)=>c ? `<option value="">— не передавать —</option>${c.stages.map(s=>`<option value="${esc(s.id)}"${s.id===cur?' selected':''}>${esc(s.name)}${s.sem==='S'?' (успех)':s.sem==='F'?' (провал)':''}</option>`).join('')}` : '';
    const uOpts=(cur)=>c ? `<option value="">— не сопоставлен —</option>${c.users.map(u=>`<option value="${esc(u.id)}"${u.id===cur?' selected':''}>${esc(u.name)}${u.email?' · '+esc(u.email):''}</option>`).join('')}` : '';
    const users={...(c?c.auto:{}), ...(v.users||{})}, stages=v.stages||{};
    this.m.innerHTML=`<div class="st-card"><div class="row"><p class="sub" style="margin:0">Битрикс24 — сделки, дела и КП в обе стороны</p><span class="sp"></span>
        <label class="sw"><input type="checkbox" id="bxOn"${v.on?' checked':''}${v.hasUrl?'':' disabled'}><span>${v.on?'включена':'выключена'}</span></label></div>
      <p class="muted">${v.on?`Сделки программы, их КП (Word, PDF, справочные документы, Excel экономики), товары, экономика и дела уходят в Битрикс24 сами; стадии, даты, ответственные, дела и новые сделки воронки приходят обратно раз в ${Math.round((v.pollSec||90)/60*10)/10} мин.`
        :'Задайте адрес вебхука, нажмите «Проверить связь», выберите воронку, сопоставьте этапы и менеджеров — и включите.'}</p>
      ${v.on||q.queued?`<p class="bx-st">Последний обмен: <b>${esc(this.when(v.lastRun))}</b> · в Битриксе сделок <b>${L.deals||0}</b>, компаний <b>${L.companies||0}</b>, дел <b>${L.tasks||0}</b>
        · в очереди <b>${q.queued||0}</b>${q.failed?` · <span class="bad-t">с ошибкой ${q.failed}: ${esc(q.lastError||'')}</span>`:''}</p>
        <div class="row"><button class="btn" type="button" id="bxRun"${v.on?'':' disabled'}>Обменяться сейчас</button>${q.failed?'<button class="btn" type="button" id="bxRetry">Отправить снова</button>':''}
          <button class="btn ghost" type="button" id="bxAll"${v.on?'':' disabled'} title="Все сделки программы, включая закрытые">Выгрузить все сделки</button></div>`:''}
      ${note?`<p class="msg${note.err?' err':''}" style="text-align:left">${esc(note.t)}</p>`:''}</div>
    <div class="st-card"><p class="sub">Подключение</p>
      <label class="f"><span>Адрес входящего вебхука ${v.hasUrl?`<b class="ok-t">задан: ${esc(v.url)}</b>`:''}</span><input type="password" id="bxUrl" autocomplete="off" placeholder="${v.hasUrl?'Новый адрес — заменит текущий':'https://bitrix24.kompr.ru/rest/1/ключ/'}"></label>
      <div class="row" style="margin-top:10px"><button class="btn primary" type="button" id="bxTest">${v.hasUrl?'Проверить связь':'Сохранить и проверить'}</button>${v.hasUrl?'<button class="btn ghost" type="button" id="bxDel">Удалить адрес</button>':''}
        <label class="f bx-poll"><span>Спрашивать изменения раз в, с</span><input type="number" id="bxPoll" min="30" max="3600" value="${v.pollSec||90}" inputmode="numeric"></label></div>
      <details class="more"><summary>Как получить адрес вебхука</summary><ol class="muted">
        <li>В Битрикс24 под администратором: «Приложения» → «Разработчикам» → «Другое» → «Входящий вебхук».</li>
        <li>Права: «CRM (crm)», «Пользователи (user)», «Диск (disk)» — для файлов КП; сохраните.</li>
        <li>Скопируйте «Вебхук для вызова rest api» (вида https://bitrix24.kompr.ru/rest/1/…/) и вставьте сюда. Никому не пересылайте: по этому адресу открыта CRM.</li>
        <li>Сервер программы должен открывать адрес Битрикса (проверка — кнопкой выше).</li></ol></details></div>
    ${c?`<div class="st-card"><p class="sub">Связь есть: ${esc(c.user)}${c.admin?' (администратор портала)':''}</p>
      <div class="bx-map"><label>Воронка Битрикса</label><select id="bxCat">${c.categories.map(x=>`<option value="${esc(x.id)}"${String(v.category||'0')===x.id?' selected':''}>${esc(x.name)}</option>`).join('')}</select></div>
      <p class="sub" style="margin-top:12px">Этапы программы → стадии Битрикса</p>
      ${v.stagesOur.map(s=>`<div class="bx-map"><label>${esc(s.label)}</label><select data-bxst="${esc(s.key)}">${stOpts(stages[s.key]||'')}</select></div>`).join('')}
      <p class="muted">Без стадии этап не передаётся (стадия в Битриксе остаётся как есть). Стадии «успех» и «провал» без пары — это «Выиграно» и «Проиграно».</p>
      <p class="sub" style="margin-top:12px">Менеджеры → пользователи Битрикса</p>
      ${c.managers.map(m=>`<div class="bx-map"><label>${esc(m.name)}${c.auto[m.id]&&!(v.users||{})[m.id]?' <em class="muted">по e-mail</em>':''}</label><select data-bxu="${esc(m.id)}">${uOpts(users[m.id]||'')}</select></div>`).join('')}
      <div class="row" style="margin-top:12px"><button class="btn primary" type="button" id="bxSave">Сохранить соответствия</button></div></div>`:''}
    <div class="st-card"><p class="sub">Журнал обмена</p>${(v.log||[]).length?`<div class="bx-log">${v.log.map(x=>`<div class="${x.level==='error'?'bad-t':x.level==='warn'?'warn-t':''}"><span class="muted">${esc(Fmt.dateTime(x.at))}</span> ${esc(x.text)}</div>`).join('')}</div>`:'<p class="empty">Обменов ещё не было.</p>'}</div>`;
    this.bind();
  }
  static async run(fn, ok){ try{ const r=await fn(); if (r && r.on!==undefined) this.v=r; this.render(ok?{t:typeof ok==='function'?ok(r):ok}:null); }catch(e){ this.render({t:String(e.message||e), err:true}); } }
  static bind(){
    const $m=s=>this.m.querySelector(s);
    $m('#bxOn').onchange=e=>this.run(()=>ajson('bitrix', {on:e.target.checked}), e.target.checked?'Связь включена: открытые сделки поставлены в очередь отправки':'Связь выключена: обмен остановлен, данные в Битриксе остаются');
    $m('#bxTest').onclick=async e=>{ e.target.disabled=true; e.target.textContent='Проверяю…';
      try{ const u=$m('#bxUrl').value.trim(), p=+$m('#bxPoll').value;
        if (u || p!==this.v.pollSec) this.v=await ajson('bitrix', {...(u?{url:u}:{}), ...(p?{pollSec:p}:{})});
        this.c=await ajson('bitrix/test', {}); this.render({t:'Связь с Битрикс24 есть. Выберите воронку, проверьте этапы и менеджеров и нажмите «Сохранить соответствия».'}); }
      catch(err){ this.render({t:String(err.message||err), err:true}); } };
    if ($m('#bxDel')) $m('#bxDel').onclick=async()=>{ if (!await stConfirm('Удалить адрес вебхука?', 'Обмен с Битрикс24 остановится. Данные в обеих системах останутся.', 'Удалить')) return;
      this.c=null; this.run(()=>ajson('bitrix', {url:''}), 'Адрес удалён, связь выключена'); };
    if ($m('#bxCat')) $m('#bxCat').onchange=async e=>{ try{ this.c=await ajson('bitrix/test', {category:e.target.value}); this.v=await aapi('bitrix'); this.render({t:'Стадии воронки загружены — сопоставьте этапы'}); }
      catch(err){ this.render({t:String(err.message||err), err:true}); } };
    if ($m('#bxSave')) $m('#bxSave').onclick=()=>{ const stages={}, users={};
      this.m.querySelectorAll('[data-bxst]').forEach(s=>{ if (s.value) stages[s.dataset.bxst]=s.value; });
      this.m.querySelectorAll('[data-bxu]').forEach(s=>{ if (s.value) users[s.dataset.bxu]=s.value; });
      this.run(()=>ajson('bitrix', {category:$m('#bxCat').value, stages, users, pollSec:+$m('#bxPoll').value||90}), 'Соответствия сохранены'); };
    if ($m('#bxRun')) $m('#bxRun').onclick=e=>{ e.target.disabled=true; e.target.textContent='Обмениваюсь…';
      this.run(()=>ajson('bitrix/run', {}), r=>{ const x=r.result||{}; return x.error ? 'Ошибка: '+x.error : `Готово: отправлено ${x.sent||0}, получено изменений ${x.pulled||0}, новых сделок ${x.created||0}, дел ${x.tasks||0}`; }); };
    if ($m('#bxRetry')) $m('#bxRetry').onclick=()=>this.run(()=>ajson('bitrix/resend', {}), 'Записи с ошибкой будут отправлены при следующем обмене');
    if ($m('#bxAll')) $m('#bxAll').onclick=async()=>{ if (!await stConfirm('Выгрузить все сделки?', 'Все сделки программы, включая выигранные и проигранные, будут отправлены в Битрикс24 (уже связанные — обновятся).', 'Выгрузить')) return;
      this.run(()=>ajson('bitrix/resend', {what:'all'}), r=>`В очередь поставлено сделок: ${r.queued||0}`); };
  }
}
