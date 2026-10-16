// «Мой день» — первый экран при запуске (функция myDay): напоминания, черновики, мои КП в работе, быстрые действия.
// Открывается и из меню «⋯ → Мой день». «Показывать при запуске» — настройка этого браузера.
'use strict';

// сколько строк в блоках «Моего дня» — «Настройки → Значения программы → Интерфейс»
DefRegistry.add([['myday', '«Мой день»', 'ui', 'Первый экран при запуске: напоминания, черновики и КП менеджера. Здесь — сколько строк показывать в каждом блоке; остальное открывается кнопкой «Все».']], [
  ['ui.mdRem', 'myday', 'Напоминаний в «Моём дне»', 'num', '5', {unit:'шт.', req:true, min:1, max:30, hint:'Сколько ближайших напоминаний («перезвонить», «истекает срок КП», «отправлено — ответа нет») видно сразу. Остальные — по кнопке «Все».'}],
  ['ui.mdDrafts', 'myday', 'Черновиков в «Моём дне»', 'num', '4', {unit:'шт.', req:true, min:1, max:30, hint:'Сколько последних незаконченных КП видно сразу. Остальные — по кнопке «Все».'}],
  ['ui.mdKp', 'myday', 'КП менеджера в «Моём дне»', 'num', '6', {unit:'шт.', req:true, min:1, max:30, hint:'Сколько последних КП менеджера показывать в блоке «Мои КП в работе» (или «Мои последние КП», если ход сделки не ведётся). Все КП — в журнале.'}],
]);

class MyDay {
  static KEY = 'kp.myday.off';
  static on(){ return FEAT.on('myDay'); }
  static atStart(){ try{ return localStorage.getItem(this.KEY)!=='1'; }catch(e){ return true; } }
  static setAtStart(v){ try{ v ? localStorage.removeItem(this.KEY) : localStorage.setItem(this.KEY, '1'); }catch(e){} }
  static badge(){ document.querySelectorAll('[data-a=myDay]').forEach(b=>{ b.hidden=!this.on(); }); }
  static myName(){ return (AUTH.user&&AUTH.user.name)||meName()||''; }
  static hello(){ const h=new Date().getHours(); return h<5?'Доброй ночи':h<12?'Доброе утро':h<18?'Добрый день':'Добрый вечер'; }

  /** мои КП: незакрытые (если ведётся ход сделки) или последние */
  static async kps(){
    const me=this.myName(); if (!me) return [];
    const st=FEAT.on('track') ? 'open' : '';
    try{ return (await api(`/api/history?limit=${Math.round(DEFN('ui.mdKp', 6))}&offset=0&author=${encodeURIComponent(me)}&status=${st}`)).items||[]; }catch(e){ return []; }
  }
  static section(title, body, more=''){ return `<section class="md-s"><div class="md-h"><p class="sub">${title}</p>${more}</div>${body}</section>`; }

  static async open(){
    if (!this.on()) return;
    const [D, K]=await Promise.all([Drafts.on()?Drafts.list():[], this.kps()]);
    if (FEAT.on('reminders')) await Reminders.load();
    const R=FEAT.on('reminders') ? Reminders.items : [], first=(this.myName().split(/\s+/)[1]||this.myName().split(/\s+/)[0]||'');
    const dt=new Date().toLocaleDateString('ru-RU', {weekday:'long', day:'numeric', month:'long'});
    const nR=Math.round(DEFN('ui.mdRem', 5)), nD=Math.round(DEFN('ui.mdDrafts', 4));
    const rem = R.length ? R.slice(0, nR).map((x, i)=>`<div class="md-r${x.overdue?' over':''}"><span aria-hidden="true">${Reminders.icon(x.kind)}</span><div><b>${esc(x.text)}</b><span class="muted">КП № ${esc(x.number)} · ${esc(x.client)}${x.overdue?' · <span class="bad-t">просрочено</span>':''}</span></div><button class="btn sm" type="button" data-mdr="${i}">Открыть КП</button></div>`).join('')
      : '<p class="empty">На сегодня напоминаний нет.</p>';
    const kp = K.length ? K.map(r=>`<div class="md-r"><span class="md-n">№ ${esc(r.number)}</span><div><b>${esc(r.client||'—')}</b><span class="muted">${esc(KPGen.ruDate(r.date))} · ${money(r.sum||0)} ${esc(curSh((r.econ&&r.econ.cur)||'RUB'))}</span>${FEAT.on('track')?`<span class="md-st">${KpTrack.chip(r)}</span>`:''}</div><button class="btn sm" type="button" data-mdk="${esc(r.id)}">Открыть</button></div>`).join('')
      : `<p class="empty">${this.myName()?'Незакрытых КП нет.':'Выберите себя в разделе «Менеджер» — здесь появятся ваши КП.'}</p>`;
    const m=new Modal(`<div class="dlg-h"><div><h3>${this.hello()}${first?', '+esc(first):''}!</h3><span class="muted md-date">${esc(dt)}</span></div><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <div class="md-q"><button class="btn primary" type="button" data-mdq="new">＋ Новое КП</button>${Presets.on()?'<button class="btn" type="button" data-mdq="preset">По заготовке</button>':''}
        <button class="btn" type="button" data-mdq="journal">Журнал КП</button><button class="btn" type="button" data-mdq="catalog">Каталог</button>${Drafts.meaningful(S)?`<button class="btn ghost" type="button" data-x title="Вернуться к открытому КП">Продолжить ${S.kpId?'КП № '+esc(S.number):'текущее КП'}</button>`:''}</div>
      <div class="md-g"><div class="md-col">
        ${FEAT.on('reminders')?this.section(`Напоминания${R.length?` <b class="md-c">${R.length}</b>`:''}`, rem, R.length>nR?'<button class="lnk" type="button" data-mdall>Все</button>':''):''}
        ${Drafts.on()?this.section(`Черновики${D.length?` <b class="md-c">${D.length}</b>`:''}`, D.length?D.slice(0, nD).map(r=>`<div class="md-r"><div><b>${esc(r.client||'Клиент не указан')}</b><span class="muted">${esc(Drafts.title(r))} · ${r.positions||0} поз. · ${esc(Fmt.dateTime(r.updated))}</span></div><button class="btn sm" type="button" data-dro="${esc(r.id)}">Продолжить</button></div>`).join(''):'<p class="empty">Незаконченных КП нет.</p>', D.length>nD?'<button class="lnk" type="button" data-mddr>Все</button>':''):''}</div>
        ${this.section(FEAT.on('track')?'Мои КП в работе':'Мои последние КП', kp, '<button class="lnk" type="button" data-mdq="journal">Журнал</button>')}
      </div>
      <label class="md-start"><input type="checkbox" id="mdStart"${this.atStart()?' checked':''}> Показывать при запуске программы</label>`, 'myday-dlg');
    m.$('#mdStart').onchange=e=>{ this.setAtStart(e.target.checked); toast(e.target.checked?'«Мой день» будет открываться при запуске':'«Мой день» — в меню «⋯»'); };
    m.d.onclick=async e=>{ const t=e.target;
      if (t.closest('[data-x]')) return m.close();
      const q=t.closest('[data-mdq]'); if (q){ m.close(); const k=q.dataset.mdq;
        if (k==='new') return NewKp.open(); if (k==='preset') return NewKp.open(); if (k==='journal') return openJournal(); if (k==='catalog') return openCatalog({}); }
      if (t.closest('[data-mdall]')){ m.close(); return Reminders.open(); }
      if (t.closest('[data-mddr]')){ m.close(); return Drafts.dialog(); }
      const r=t.closest('[data-mdr]'); if (r){ const x=R[+r.dataset.mdr]; m.close(); return KpLoader.byId(x.id).catch(err=>toast('Не открылось: '+err.message)); }
      const k=t.closest('[data-mdk]'); if (k){ m.close(); return KpLoader.byId(k.dataset.mdk).catch(err=>toast('Не открылось: '+err.message)); }
      const s=t.closest('[data-jst]'); if (s){ const row=K.find(x=>x.id===s.dataset.jst); if (row){ m.close(); KpTrack.open(row); } return; }
      const o=t.closest('[data-dro]'); if (o){ m.close(); return Drafts.open(o.dataset.dro); } };
  }
  /** при запуске: «Мой день» вместо каталога */
  static start(){ this.badge(); if (this.on() && this.atStart()){ this.open(); return true; } return false; }
}
