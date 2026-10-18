// Ход сделки по КП (сервер: app/kp_track.py): статус (подготовлено → отправлено → в работе → выиграно / проиграно),
// напоминание «перезвонить», срок действия КП, письмо клиенту с файлом КП. Хранится отдельно от КП — пересохранение не стирает.
// KpTrack — окно статуса; Reminders — колокольчик в шапке; MailDlg — письмо клиенту.
'use strict';

const KP_STATUS = { new:'Подготовлено', sent:'Отправлено', work:'В работе', won:'Выиграно', lost:'Проиграно' };
// причины проигрыша — список «Причины проигрыша КП» в «Настройках → Списки и выборы»
const KP_LOST = ['Цена выше, чем у конкурентов', 'Сроки поставки', 'Выбрали другого поставщика', 'Закупка отменена или перенесена',
  'Не прошли по техническим требованиям', 'Нет ответа от клиента', 'Другое'];

// напоминания хода сделки — «Настройки → Значения программы → КП и документы»
DefRegistry.add([['remind', 'Напоминания и ход сделки', 'kp', 'Напоминание «перезвонить» ставится в окне статуса КП (журнал → кнопка статуса). Колокольчик в шапке показывает, что пора сделать.']], [
  ['kp.remQuick', 'remind', 'Кнопки быстрого напоминания — через сколько дней', 'text', '1, 3, 7', {req:true,
    hint:'Числа через запятую — по кнопке на каждое (не больше 5): «1» — кнопка «Завтра», «7» — «Через неделю», остальные — «Через N дн.». Пример: «1, 2, 5, 14» — четыре кнопки. Дата напоминания всё равно выбирается и вручную в календаре.'}],
  ['kp.remSnooze', 'remind', '«Отложить» в напоминаниях — на', 'num', '1', {unit:'дн.', req:true, min:1, max:30,
    hint:'На сколько дней переносит напоминание кнопка «+N дн.» в окне колокольчика. Пример: 1 — на завтра, 3 — через три дня.'}],
  ['kp.remRefresh', 'remind', 'Проверять новые напоминания — раз в', 'num', '10', {unit:'мин', req:true, min:1, max:120,
    hint:'Как часто открытая программа сама спрашивает у сервера новые напоминания (колокольчик в шапке). Меньше — быстрее появляется напоминание, больше — реже запросы к серверу.'}],
]);

// даты хода сделки: ДД.ММ.ГГГГ, сдвиг на дни, срок действия КП (как kp_track.OfferTerm на сервере)
class KpDate {
  static ddmm(iso){ const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; }
  static addDays(iso, n){ const d=new Date((iso||today())+'T12:00:00'); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }
  static workDays(base, n){ const d=new Date(base+'T12:00:00'); for (let k=0; k<n;){ d.setDate(d.getDate()+1); if (d.getDay()%6) k++; } return d.toISOString().slice(0,10); }
  /** срок действия КП (ГГГГ-ММ-ДД) по условию «Срок действия предложения»: «30 дней», «10 рабочих дней», «2 недели», «1 месяц»,
   *  «до 31.12.2026» — от даты КП. '' — не указан или не распознан */
  static validUntil(st=S){
    const c=(st.conditions||[]).find(x=>/действ/i.test(x.label||'')), v=String(c&&c.value||'').toLowerCase(); if (!v) return '';
    const dm=v.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/); if (dm) return `${dm[3]}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`;
    const nm=v.match(/(\d{1,3})\s*([а-яё]*)\s*([а-яё]*)/), base=st.date; if (!nm || !base) return '';
    const n=+nm[1], w=nm[2]+' '+nm[3];
    if (/раб/.test(w)) return KpDate.workDays(base, n);
    const mult = /дн|ден|сут/.test(w) ? 1 : /недел/.test(w) ? 7 : /мес/.test(w) ? 30 : 0;
    return mult ? KpDate.addDays(base, n*mult) : '';
  }
}

// ---------- статус КП
class KpTrack {
  static status(tr){ return (tr && tr.status) || 'new'; }
  static chip(r){ if (!FEAT.on('track')) return ''; const tr=r.track||{}, st=KpTrack.status(tr), fu=tr.followUp&&!tr.followUp.done?tr.followUp:null;
    return `<button type="button" class="jst st-${st}" data-jst="${esc(r.id)}" title="Ход сделки: статус, напоминание">${esc(KP_STATUS[st])}${st==='lost'&&tr.reason?` · ${esc(tr.reason)}`:''}</button>`
      + (fu?`<span class="jfu${fu.date<=today()?' due':''}" title="${esc(fu.note||'Напоминание')}">⏰ ${esc(KpDate.ddmm(fu.date))}</span>`:'')
      + (tr.sent&&tr.sent.length?`<span class="jsent" title="Отправлено: ${esc(tr.sent.map(s=>KpDate.ddmm(s.at)+' → '+(s.to||[]).join(', ')).join('; '))}">✉ ${esc(KpDate.ddmm(tr.sent[tr.sent.length-1].at))}</span>`:''); }
  /** запись истории о напоминании: объект {date, note}, прежний формат — текстом; null — напоминание снято */
  static followText(fu){
    if (fu===null) return ' напоминание снято';
    if (!fu) return '';
    if (typeof fu!=='object') return ' напоминание: '+esc(fu);
    return ` напоминание на ${esc(KpDate.ddmm(fu.date))}${fu.note ? ': '+esc(fu.note) : ''}`;
  }
  /** окно статуса; onSave(track) — после сохранения */
  static open(r, onSave){
    const tr=r.track||{}, st=KpTrack.status(tr), fu=tr.followUp&&!tr.followUp.done?tr.followUp:null;
    const reasons=[...new Set([...KP_LOST, ...(tr.reason&&!KP_LOST.includes(tr.reason)?[tr.reason]:[])])];
    const hist=(tr.history||[]).slice().reverse().slice(0,8).map(h=>`<li><span class="muted">${esc(Fmt.dateTime(h.at))} · ${esc(h.by||'')}</span> ${h.status?esc(KP_STATUS[h.status]||h.status):''}${h.reason?' — '+esc(h.reason):''}${h.note?' — '+esc(h.note):''}${KpTrack.followText(h.followUp)}</li>`).join('');
    const m=new Modal(`<div class="dlg-h"><h3>Ход сделки · КП № ${esc(r.number)}</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted" style="margin:0 0 10px">${esc(r.client||'')}</p>
      <div class="kt-seg" role="radiogroup" aria-label="Статус КП">${Object.entries(KP_STATUS).map(([k,l])=>`<button type="button" class="st-${k}${k===st?' on':''}" data-ks="${k}" role="radio" aria-checked="${k===st}">${l}</button>`).join('')}</div>
      <label class="f kt-reason"${st==='lost'?'':' hidden'}><span>Причина проигрыша</span><select id="ktR">${reasons.map(x=>`<option${x===tr.reason?' selected':''}>${esc(x)}</option>`).join('')}</select></label>
      <label class="f"><span>Заметка</span><input type="text" id="ktN" value="${esc(tr.note||'')}" maxlength="500" placeholder="Например: ждём согласования бюджета до 20-го"></label>
      <fieldset class="kt-fu"><legend>Напоминание</legend>
        <div class="row" style="gap:8px;flex-wrap:wrap"><input type="date" id="ktD" value="${esc(fu?fu.date:'')}" aria-label="Дата напоминания">
          ${KpTrack.quick().map(n=>`<button type="button" class="btn sm" data-kd="${n}">${n===1?'Завтра':n===7?'Через неделю':`Через ${n} ${plural(n,'день','дня','дней')}`}</button>`).join('')}
          ${fu?'<button type="button" class="btn sm ghost" data-kdone>Выполнено</button>':''}</div>
        <input type="text" id="ktFN" value="${esc(fu?fu.note:'')}" maxlength="300" placeholder="Что сделать: позвонить главному инженеру, уточнить решение…" aria-label="Что сделать"></fieldset>
      ${hist?`<details class="kt-hist"><summary>История</summary><ul>${hist}</ul></details>`:''}
      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn" type="button" data-x>Отмена</button><button class="btn primary" type="button" data-ksave>Сохранить</button></div>`, 'kt-dlg');
    let cur=st;
    m.d.onclick=async e=>{ const t=e.target;
      if (t.closest('[data-x]')) return m.close();
      const s=t.closest('[data-ks]'); if (s){ cur=s.dataset.ks; m.d.querySelectorAll('[data-ks]').forEach(b=>{ b.classList.toggle('on', b===s); b.setAttribute('aria-checked', b===s); }); m.$('.kt-reason').hidden=cur!=='lost'; return; }
      const kd=t.closest('[data-kd]'); if (kd){ m.$('#ktD').value=KpDate.addDays(today(), +kd.dataset.kd); return; }
      if (t.closest('[data-kdone]')){ try{ const r2=await KpTrack.put(r.id, {followUp:{done:true}}); onSave&&onSave(r2.track); toast('Напоминание выполнено'); m.close(); }catch(err){ toast('Не сохранено: '+err.message); } return; }
      if (!t.closest('[data-ksave]')) return;
      const body={ status:cur, reason:cur==='lost'?m.$('#ktR').value:'', note:m.$('#ktN').value.trim() };
      const dt=m.$('#ktD').value, fn=m.$('#ktFN').value.trim();
      if (dt) body.followUp={date:dt, note:fn}; else if (fu) body.followUp=null;
      try{ const r2=await KpTrack.put(r.id, body); onSave&&onSave(r2.track); toast('КП № '+r.number+': '+KP_STATUS[cur].toLowerCase()); m.close(); Reminders.load(); }
      catch(err){ toast('Не сохранено: '+err.message); } };
  }
  /** дни кнопок быстрого напоминания из «Значений программы» («1, 3, 7»); неверная запись — как в программе */
  static quick(){
    const L=String(DEF('kp.remQuick')||'').split(/[,;\s]+/).map(x=>Math.round(+x)).filter(n=>n>=1 && n<=365);
    return L.length ? [...new Set(L)].slice(0, 5) : [1, 3, 7];
  }
  static put(id, body){ return api(`/api/kp/${encodeURIComponent(id)}/track`, {method:'PUT', headers:{'Content-Type':'application/json; charset=utf-8'}, body:JSON.stringify(body)}); }
}

// ---------- напоминания: колокольчик в шапке (перезвонить, срок действия КП, отправлено без ответа)
class Reminders {
  static items = [];
  static async load(){ if (!FEAT.on('reminders')){ Reminders.items=[]; return Reminders.badge(); } try{ const r=await api('/api/reminders'); Reminders.items=r.items||[]; }catch(e){ Reminders.items=[]; } Reminders.badge(); }
  static badge(){ const b=$('#btnRem'); if (!b) return; const n=Reminders.items.length, due=Reminders.items.some(x=>x.overdue||x.date<=today());
    b.hidden=!n; b.classList.toggle('due', due); $('#remN').textContent=n||''; b.title=n?`Напоминания: ${n}`:'Напоминаний нет'; }
  static snooze(){ return Math.round(DEFN('kp.remSnooze', 1)); }
  /** колокольчик сам проверяет напоминания раз в N минут («Значения программы»), пока вкладка открыта */
  static poll(){ setTimeout(()=>{ if (!document.hidden) Reminders.load(); Reminders.poll(); }, DEFN('kp.remRefresh', 10)*60*1000); }
  static icon(k){ return k==='follow'?'⏰':k==='expire'?'⌛':'✉'; }
  static open(){
    const list=Reminders.items, snz=Reminders.snooze();
    const m=new Modal(`<div class="dlg-h"><h3>Напоминания</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      ${list.length?`<div class="rem-l">${list.map((x,i)=>`<div class="rem-r${x.overdue?' over':''}"><span class="rem-i" aria-hidden="true">${Reminders.icon(x.kind)}</span>
        <div><b>${esc(x.text)}</b><span class="muted">КП № ${esc(x.number)} · ${esc(x.client)} · ${x.kind==='stale'?'с '+esc(KpDate.ddmm(x.date)):esc(KpDate.ddmm(x.date))}${x.overdue?' · <span class="bad-t">просрочено</span>':''}</span></div>
        <div class="acts"><button class="btn sm" type="button" data-ro="${i}">Открыть КП</button><button class="btn sm" type="button" data-rs="${i}">Статус…</button>
        ${x.kind==='follow'?`<button class="btn sm ghost" type="button" data-rd="${i}">Выполнено</button><button class="btn sm ghost" type="button" data-rl="${i}" title="Перенести на ${snz===1?'завтра':snz+' '+plural(snz,'день','дня','дней')}">+${snz} ${plural(snz,'день','дня','дней')}</button>`:''}</div></div>`).join('')}</div>`
      : '<p class="empty">Напоминаний нет. Поставить напоминание — в журнале КП, кнопка статуса у КП.</p>'}`, 'rem-dlg');
    m.d.onclick=async e=>{ const t=e.target; if (t.closest('[data-x]')) return m.close();
      const b=t.closest('[data-ro],[data-rs],[data-rd],[data-rl]'); if (!b) return; const x=list[+(b.dataset.ro??b.dataset.rs??b.dataset.rd??b.dataset.rl)];
      try{
        if (b.dataset.ro!=null){ await KpLoader.byId(x.id); return m.close(); }
        if (b.dataset.rs!=null){ const r=(await api(`/api/history?limit=1&q=${encodeURIComponent(x.number)}`)).items?.find(z=>z.id===x.id) || {id:x.id, number:x.number, client:x.client};
          m.close(); return KpTrack.open(r); }
        if (b.dataset.rd!=null) await KpTrack.put(x.id, {followUp:{done:true}});
        if (b.dataset.rl!=null) await KpTrack.put(x.id, {followUp:{date:KpDate.addDays(today(),snz), note:x.text}});
        await Reminders.load(); m.close(); Reminders.open();
      }catch(err){ toast('Не получилось: '+err.message); } };
  }
}

// открыть сохранённое КП по номеру (из напоминаний, отчёта, «Моего дня», карточки клиента); текущее — в черновики
class KpLoader {
  static async byId(id){
    if (!await Drafts.stash()) return;
    const st=await api(`/api/kp/${encodeURIComponent(id)}/state`);
    S=Object.assign(freshState(), st); document.querySelectorAll('dialog[open]').forEach(d=>d.close()); renderForm(); persist(); window.scrollTo({top:0});
    toast('КП № '+(S.number||id)+' открыто');
  }
}

// ---------- письмо клиенту с файлом КП (сервер отправляет через почту из «Настройки → Почта»)
class MailDlg {
  /** справочные документы КП в письме: сколько всего вложений и не больше ли предела письма («Значения программы» kp.mailMB) */
  static sum(m, f){
    const el=m.$('#mlSum'); if (!el) return;
    const ids=new Set([...m.d.querySelectorAll('[data-mlf]:checked')].map(x=>+x.dataset.mlf));
    const b=(m.$('#mlW').checked?f.wordSize||0:0)+(m.$('#mlP').checked?f.pdfSize||0:0)+(f.files||[]).filter(x=>ids.has(+x.id)).reduce((s,x)=>s+(x.size||0),0);
    const lim=(f.mailMB||18)*1048576, over=b>lim;
    el.className='ml-sum '+(over?'bad-t':'muted');
    el.textContent=`Вложения: ≈ ${Fmt.size(b)} из ${f.mailMB||18} МБ${over?' — снимите галочки с части документов (их можно отправить вторым письмом)':''}`;
  }

  static async open(id, number, onSent){
    let f; try{ f=await api(`/api/kp/${encodeURIComponent(id)}/mailform`); }catch(e){ return toast('Не удалось подготовить письмо: '+e.message); }
    if (!f.on) return toast('Почта не настроена — администратор: «Настройки → Почта»');
    if (!f.word) return toast('Файл КП не найден — сохраните КП');
    f=MyPrefs.mail(f);         // подпись и копия себе — из «Моих настроек»
    const m=new Modal(`<div class="dlg-h"><h3>Отправить КП № ${esc(number)} клиенту</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <label class="f"><span>Кому *</span><input type="text" id="mlTo" value="${esc(f.to)}" placeholder="client@company.ru — несколько через запятую" autocomplete="off"></label>
      <label class="f"><span>Копия</span><input type="text" id="mlCc" value="${esc(f.cc)}" autocomplete="off"></label>
      <label class="f"><span>Тема</span><input type="text" id="mlS" value="${esc(f.subject)}"></label>
      <label class="f"><span>Текст письма</span><textarea id="mlB" rows="9">${esc(f.body)}</textarea></label>
      <div class="ml-files"><span class="muted">Вложения:</span><label><input type="checkbox" id="mlW" checked><span>Word — ${esc(f.word)}</span></label>
        <label><input type="checkbox" id="mlP"${f.pdf?' checked':''}><span>PDF${f.pdf?' — '+esc(f.pdf):' (будет создан)'}</span></label>
        ${(f.files||[]).map(x=>`<label><input type="checkbox" data-mlf="${esc(String(x.id))}" checked><span>📎 ${esc(x.name)} <span class="muted">· ${Fmt.size(x.size)}${x.note?' · '+esc(x.note):''}</span></span></label>`).join('')}
        ${(f.files||[]).length?'<span class="muted ml-sum" id="mlSum"></span>':''}</div>
      ${f.sent&&f.sent.length?`<p class="muted" style="margin:8px 0 0">Уже отправляли: ${f.sent.map(s=>esc(KpDate.ddmm(s.at))+' → '+esc((s.to||[]).join(', '))).join('; ')}</p>`:''}
      <p class="msg" id="mlMsg" hidden></p>
      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn" type="button" data-x>Отмена</button><button class="btn primary" type="button" data-send>Отправить</button></div>`, 'ml-dlg');
    MailDlg.sum(m, f); m.d.onchange=()=>MailDlg.sum(m, f);
    m.d.onclick=async e=>{ if (e.target.closest('[data-x]')) return m.close();
      const b=e.target.closest('[data-send]'); if (!b) return;
      const msg=m.$('#mlMsg'); b.disabled=true; b.textContent='Отправляю…'; msg.hidden=true;
      try{ const r=await api(`/api/kp/${encodeURIComponent(id)}/send`, {method:'POST', headers:{'Content-Type':'application/json; charset=utf-8'},
          body:JSON.stringify({to:m.$('#mlTo').value, cc:m.$('#mlCc').value, subject:m.$('#mlS').value, body:m.$('#mlB').value, word:m.$('#mlW').checked, pdf:m.$('#mlP').checked,
            files:[...m.d.querySelectorAll('[data-mlf]:checked')].map(x=>+x.dataset.mlf)})});
        toast('КП № '+number+' отправлено: '+m.$('#mlTo').value); onSent&&onSent(r.track); m.close(); Reminders.load(); }
      catch(err){ msg.hidden=false; msg.className='msg err'; msg.textContent=err.message; b.disabled=false; b.textContent='Отправить'; } };
  }
}

document.addEventListener('click', e=>{ if (e.target.closest('#btnRem')) Reminders.open(); });   // колокольчик в шапке
