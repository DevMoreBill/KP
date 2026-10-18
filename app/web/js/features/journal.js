// Журнал КП: список сохранённых КП, открытие, копия, удаление.
'use strict';

// журнал КП — «Настройки → Значения программы → Интерфейс»
DefRegistry.add([['journal', 'Журнал и отчёт по КП', 'ui', 'Список сохранённых КП («⋯ → Журнал КП»): постранично, с поиском по номеру, клиенту, ИНН и позициям; отчёт за период — кнопка «Отчёт» в журнале.']], [
  ['ui.jPage', 'journal', 'КП на одной странице журнала', 'num', '50', {unit:'шт.', req:true, min:10, max:500,
    hint:'Сколько КП журнал загружает сразу; следующие — кнопкой «Показать ещё». Больше — меньше нажатий, но дольше открывается журнал на слабом компьютере или телефоне. Пример: 50.'}],
  ['ui.jDelay', 'journal', 'Задержка поиска в журнале', 'num', '220', {unit:'мс', req:true, min:0, max:2000,
    hint:'Сколько программа ждёт после последней нажатой клавиши в строке поиска журнала, прежде чем спросить сервер. 1000 мс = 1 секунда. Меньше — результат быстрее, но больше запросов при наборе; при медленной сети лучше 300–500.'}],
]);

const jShort = n => { const p=String(n||'').trim().split(/\s+/); return p.length>1 ? p[0]+' '+p.slice(1).map(x=>x[0]+'.').join(' ') : (p[0]||''); };

// экономика КП из журнала: сумма в рублях (для итогов), прибыль и маржа — по позициям с закупкой
function jEcon(r){
  const e=r.econ||null, cur=(e&&e.cur)||'RUB', cs=curSh(cur), pc=v=>v==null||!Number.isFinite(v)?'—':v.toFixed(1).replace('.',',')+' %';
  if (!FEAT.on('deal')) return { sum:`${money((e?e.sum:r.sum)||0)} ${cs}`, line:'', sumRub: cur==='RUB'?((e?e.sum:r.sum)||0):(e&&e.sumRub)||null, profitRub:null };   // экономика выключена
  if (r.locked) return { sum:`${money(r.sum||0)} ${cs}`, line:'<span class="muted">экономика — у автора КП</span>', sumRub: cur==='RUB'?(r.sum||0):null, profitRub:null };
  // заполнен расчёт «Экономика сделки» — показываем его (с логистикой, растаможкой и финансированием)
  if (r.deal){ const dd=r.deal, sumRub = cur==='RUB' ? (e?e.sum:r.sum)||0 : (e&&e.sumRub)||null;
    const line = dd.confirmed ? `<span class="${dd.profit<0?'bad-t':'ok-t'}">прибыль ${money(Math.round(dd.profit*100))} руб.</span> · маржа ${pc(dd.margin)} <span class="muted">по расчёту сделки</span>`
      : `прибыль от ${money(dd.lo*100)} до ${money(dd.hi*100)} руб. <span class="muted">— нужен ввозной НДС</span>`;
    return { sum:`${money((e?e.sum:r.sum)||0)} ${cs}`, line, sumRub, profitRub: dd.confirmed ? Math.round(dd.profit*100) : null }; }
  const sumRub = cur==='RUB' ? (e?e.sum:r.sum)||0 : (e&&e.sumRub)||null;
  const profitRub = e&&e.withCost ? (cur==='RUB' ? e.profit : (e.sumRub&&e.sum ? Math.round(e.profit*e.sumRub/e.sum) : null)) : null;
  const line = !e ? '<span class="muted">считаю…</span>'
    : e.withCost ? `<span class="${e.profit<0?'bad-t':'ok-t'}">прибыль ${money(e.profit)} ${cs}</span> · маржа ${pc(e.margin)}${e.withCost<e.positions?` <span class="muted">(${e.withCost} из ${e.positions} поз.)</span>`:''}${e.discount?` · скидка ${money(e.discount)}`:''}`
    : '<span class="muted">закупка не указана</span>';
  return { sum:`${money((e?e.sum:r.sum)||0)} ${cs}`, line, sumRub, profitRub };
}

// строка журнала КП (класс JournalRow): частые действия — «Открыть» и «Копия», остальные (файл, письмо, экономика,
// версии) — в меню «⋯», чтобы в длинном списке не рябило от кнопок
class JournalRow {
  // тендер: номер закупки и ссылка на неё; ссылка — только http(s)
  static tender(r){ const t=r.tender; if (!t || !t.number) return ''; const u=/^https?:\/\//i.test(t.url||'') ? t.url : '';
    return `<span class="jr-t" title="КП для тендера${u?': '+esc(u):''}">Тендер № ${esc(t.number)}${u?` <a href="${esc(u)}" target="_blank" rel="noopener noreferrer" aria-label="Открыть закупку на площадке">↗</a>`:''}</span>`; }

  static html(r, e){
    return `<div class="jr${r.tender&&r.tender.number?' tnd':''}"><div class="jr-n"><span class="n">№ ${esc(r.number)}</span><span class="muted">от ${esc(KPGen.ruDate(r.date))}</span>${this.tender(r)}${r.files&&FEAT.on('kpFiles')?`<button type="button" class="jr-f" data-jkf="${esc(r.id)}" data-jn="${esc(r.number)}" title="Справочные документы: ${esc(String(r.files))}" aria-label="Справочные документы КП № ${esc(r.number)}: ${esc(String(r.files))}">📎 ${esc(String(r.files))}</button>`:''}${r.savedAt?`<span class="muted" title="Последнее сохранение">сохр. ${esc(Fmt.dateTime(r.savedAt))}</span>`:''}</div>
      <div class="jr-m"><b>${ClientCard.link({inn:String(r.clientInn||'').replace(/\D/g,''), name:r.client}, r.client)}</b><span class="muted">${(r.items&&r.items[0])?esc(r.items[0])+(r.positions>1?` и ещё ${r.positions-1}`:''):''}</span>${r.manager?`<span class="jr-a" title="${esc([r.manager,r.managerPost].filter(Boolean).join(', '))}">Автор: ${esc(jShort(r.manager))}</span>`:''}</div>
      <div class="jr-e"><b>${e.sum}</b><span>${e.line}</span><span class="jr-st">${KpTrack.chip(r)}</span></div>
      <div class="acts"><button class="btn" type="button" data-jo="${esc(r.id)}" title="Открыть КП для просмотра и правки">Открыть</button><button class="btn" type="button" data-jc="${esc(r.id)}" title="Новое КП на основе этого: позиции, цены и условия — те же, получатель — новый">Копия</button>${this.menu(r)}</div></div>`;
  }

  static menu(r){
    const id=esc(r.id), it=(attrs, text, title)=>`<button type="button" ${attrs}${title?` title="${title}"`:''}>${text}</button>`;
    return `<details class="jr-more" data-id="${id}"><summary class="btn" title="Другие действия с КП" aria-label="Другие действия с КП № ${esc(r.number)}">⋯</summary><div class="menu-l">${[
      SRV.info&&SRV.info.local===false ? it(`data-a="openDoc" data-id="${id}"`, 'Скачать файл КП (Word)') : it(`data-a="openDoc" data-id="${id}"`, 'Открыть файл КП в Word'),
      r.file&&FEAT.on('mail') ? it(`data-jm="${id}"`, 'Отправить клиенту…', 'Письмо клиенту с файлом КП') : '',
      FEAT.on('kpFiles') ? it(`data-jkf="${id}" data-jn="${esc(r.number)}"`, 'Справочные документы…', 'Паспорта, сертификаты, схемы к КП — в документ КП не входят') : '',
      r.locked||!FEAT.on('deal') ? '' : it(`data-je="${id}"`, 'Экономика сделки'),
      FEAT.on('versions') ? it(`data-jv="${id}" data-jn="${esc(r.number)}"`, 'Прежние версии КП') : ''].join('')}</div></details>`;
  }

  // меню у нижнего края списка открывается вверх, у левого края — вправо (на телефоне оно — панель снизу экрана)
  static place(d){
    const m=d.querySelector('.menu-l'), box=d.closest('.dlg-b'); d.classList.remove('up','lft');
    if (!d.open || !m || !box || getComputedStyle(m).position==='fixed') return;
    const r=m.getBoundingClientRect(), b=box.getBoundingClientRect();
    if (r.left < b.left) d.classList.add('lft');
    if (r.bottom > b.bottom && r.height+8 < r.top-b.top) d.classList.add('up');
  }
}

async function openJournal(){
  const d=$('#dlg'); d.classList.add('wide');
  d.innerHTML=`<div class="dlg-h"><h3>Журнал КП</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
   <div class="dlg-b"><div class="jbar"><input type="text" id="jQ" placeholder="Поиск: номер КП или закупки, получатель, ИНН, позиция" autocomplete="off"><select id="jK" aria-label="Вид КП"><option value="">Все КП</option><option value="std">Обычные</option><option value="tender">Тендеры</option></select><select id="jA" aria-label="Автор"><option value="">Все авторы</option></select><select id="jS" aria-label="Статус КП"${FEAT.on('track')?'':' hidden'}><option value="">Все статусы</option><option value="open">Не закрытые</option>${Object.entries(KP_STATUS).map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select><button class="btn" type="button" id="jMe" title="Только мои КП">Мои</button><button class="btn" type="button" id="jDr"${FEAT.on('drafts')?'':' hidden'} title="Незаконченные КП и несохранённые правки">Черновики</button><button class="btn" type="button" id="jRep"${FEAT.on('report')?'':' hidden'} title="Отчёт по КП, прибыли и марже за период — по менеджерам и категориям">Отчёт</button></div>
   <div class="jtot muted" id="jTot"></div><div class="jfun" id="jFun"></div><div id="jList"><p class="empty">Загружаю…</p></div></div>`;
  d.showModal(); d.querySelector('[data-close]').onclick=()=>{ d.close(); d.classList.remove('wide'); };
  // журнал — постранично: поиск, автор и итоги считает сервер, в браузер приходят только видимые КП
  const J={rows:[], total:0, agg:null, seq:0, size:Math.round(DEFN('ui.jPage', 50)), any:false};
  const draw=()=>{ const a=J.agg||{};
    $('#jTot').innerHTML = J.total ? `КП: <b>${J.total}</b> · на сумму <b>${money(a.sum||0)} руб.</b>${a.profitN&&FEAT.on('deal')?` · прибыль <b>${money(a.profit)} руб.</b> <span>(по ${a.profitN} КП с закупкой)</span>`:''}` : '';
    const fn=J.funnel||{}, nn=k=>(fn[k]||{}).n||0, won=nn('won'), lost=nn('lost');
    $('#jFun').innerHTML = FEAT.on('track') && Object.keys(fn).length ? Object.entries(KP_STATUS).filter(([k])=>nn(k)).map(([k,l])=>`<button type="button" class="jf st-${k}${$('#jS').value===k?' on':''}" data-jf="${k}" title="Показать только «${l}»"><b>${nn(k)}</b> ${l} <span>${money((fn[k]||{}).sum||0)} руб.</span></button>`).join('')
      + (won+lost?`<span class="jf-c" title="Выиграно из закрытых (выиграно + проиграно)">Конверсия <b>${Math.round(won/(won+lost)*100)} %</b></span>`:'') : '';
    const more=J.total-J.rows.length, op=$('#jList .jr-more[open]');      // открытое меню «⋯» переживает перерисовку
    $('#jList').innerHTML = J.rows.length ? J.rows.map(r=>JournalRow.html(r, jEcon(r))).join('')
        + (more>0?`<div class="row" style="justify-content:center;margin-top:10px"><button class="btn" type="button" data-jmore>Показать ещё ${Math.min(more,J.size)} из ${more}</button></div>`:'')
      : `<p class="empty">${J.any?'Ничего не найдено.':'Журнал пуст. Сохранённые КП появятся здесь.'}</p>`;
    if (op) for (const x of $('#jList').querySelectorAll('.jr-more')) if (x.dataset.id===op.dataset.id){ x.open=true; JournalRow.place(x); } };
  const load=async more=>{ const seq=++J.seq, au=$('#jA').value, q=$('#jQ').value.trim(), kd=$('#jK').value, ks=$('#jS').value;
    let r; try{ r=await api(`/api/history?limit=${J.size}&offset=${more?J.rows.length:0}&q=${encodeURIComponent(q)}&author=${encodeURIComponent(au)}&kind=${encodeURIComponent(kd)}&status=${encodeURIComponent(ks)}`); }
    catch(e){ if (seq===J.seq) $('#jList').innerHTML='<p class="empty">Журнал недоступен.</p>'; return; }
    if (seq!==J.seq || !d.open) return;          // пока ждали ответ, изменили поиск
    J.rows = more ? J.rows.concat(r.items||[]) : (r.items||[]); J.total=r.total||0; J.agg=r.agg||null; J.funnel=r.funnel||null; if (!q && !au && !kd && !ks) J.any=J.total>0; else J.any=true;
    if (!$('#jA').dataset.ok){ $('#jA').dataset.ok='1'; $('#jA').innerHTML+=(r.authors||[]).map(a=>`<option>${esc(a)}</option>`).join(''); }
    draw();
    // КП, сохранённые прежней версией: экономика считается по сохранённому состоянию КП
    await Promise.all((r.items||[]).filter(x=>!x.econ && !x.locked).map(async x=>{          // параллельно (не по очереди)
      try{ const st=await api(`/api/kp/${x.id}/state`); if (seq===J.seq) x.econ=kpEconomics(st); }catch(e){ x.econ={cur:'RUB',sum:x.sum||0,withCost:0,positions:x.positions||0}; } }));
    if (d.open && seq===J.seq) draw(); };
  let qT=0; $('#jQ').oninput=()=>{ clearTimeout(qT); qT=setTimeout(()=>load(false), DEFN('ui.jDelay', 220)); }; $('#jA').onchange=$('#jK').onchange=$('#jS').onchange=()=>load(false);
  $('#jFun').onclick=e=>{ const b=e.target.closest('[data-jf]'); if (!b) return; const s=$('#jS'); s.value = s.value===b.dataset.jf ? '' : b.dataset.jf; load(false); };
  $('#jDr').onclick=()=>Drafts.dialog();
  $('#jRep').onclick=()=>KpReport.open({author:$('#jA').value, kind:$('#jK').value});
  $('#jMe').onclick=()=>{ const me=(AUTH.user&&AUTH.user.name)||meName(), a=$('#jA');
    if (!me) return toast('Выберите себя в разделе «Менеджер» — тогда журнал покажет ваши КП');
    if (![...a.options].some(o=>o.value===me)) return toast('У вас ещё нет сохранённых КП');
    a.value = a.value===me ? '' : me; $('#jMe').classList.toggle('on', a.value===me); load(false); };
  await load(false);
  $('#jList').addEventListener('toggle', e=>{ if (e.target.classList.contains('jr-more')) JournalRow.place(e.target); }, true);
  $('#jList').onclick=async e=>{
    if (e.target.closest('.jr-t a')) return;        // ссылка на закупку открывается в браузере
    if (e.target.closest('[data-jmore]')) return load(true);
    const js=e.target.closest('[data-jst]'); if (js){ const r=J.rows.find(x=>x.id===js.dataset.jst); if (r) KpTrack.open(r, tr=>{ r.track=tr; draw(); load(false); }); return; }
    const jm=e.target.closest('[data-jm]'); if (jm){ const r=J.rows.find(x=>x.id===jm.dataset.jm); if (r) MailDlg.open(r.id, r.number, tr=>{ r.track=tr; draw(); }); return; }
    const jkf=e.target.closest('[data-jkf]'); if (jkf){ const r=J.rows.find(x=>x.id===jkf.dataset.jkf); return KpFilesPanel.open(jkf.dataset.jkf, jkf.dataset.jn, {onClose:n=>{ if (r && (r.files||0)!==n){ r.files=n; draw(); } }}); }
    const jv=e.target.closest('[data-jv]'); if (jv) return openKpVersions(jv.dataset.jv, jv.dataset.jn, ()=>{ d.close(); d.classList.remove('wide'); });
    const o=e.target.closest('[data-jo]'), c=e.target.closest('[data-jc]'), ec=e.target.closest('[data-je]'); if(!o&&!c&&!ec) return;
    try{
      if (!await Drafts.stash()) return;
      const st=await api(`/api/kp/${(o||c||ec).dataset[o?'jo':c?'jc':'je']}/state`);
      S=Object.assign(freshState(), st); if (!c){ const m=J.rows.find(x=>x.id===st.kpId); if (m && m.file) S._file=m.file; }
      if (c){ delete S.kpId; delete S.number; delete S.createdAt; delete S._rev; S.date=today(); ClientFields.clear(S); S.authorId=meId();
        if (S.tender && S.tender.on) S.tender={on:true, number:'', url:''}; }     // копия тендерного КП — под другую закупку
      d.close(); d.classList.remove('wide'); renderForm(); persist(); window.scrollTo({top:0}); if (c) Drafts.loaded();
      if (ec) return openDeal();
      toast(c?(S.tender&&S.tender.on?'Создана копия — укажите получателя и № закупки':'Создана копия — укажите получателя'):'КП № '+S.number+' открыто для редактирования');
    }catch(err){ toast('Не удалось открыть КП'); }
  };
}

// история версий КП: при каждом пересохранении прежний вариант остаётся в базе (последние 30)
async function openKpVersions(id, number, closeJournal){
  let list=[]; try{ list=await api(`/api/kp/${encodeURIComponent(id)}/versions`); }catch(e){ toast('История версий недоступна'); return; }
  const m=new Modal(`<div class="dlg-h"><h3>Версии КП № ${esc(number||id)}</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
    <p class="muted">Текущая версия — в журнале. Здесь — прежние варианты: сохраняются автоматически при каждом пересохранении КП (последние 30).</p>
    <div class="kpver-l">${list.length?list.map((v,k)=>`<div class="st-row"><div><b>Версия ${list.length-k}</b><span class="muted">до сохранения ${esc(Fmt.dateTime(v.created))}${v.by?' ('+esc(v.by)+')':''}${v.sum!=null?` · ${money(v.sum)} ${esc(curSh(v.cur||'RUB'))}`:''}${v.client?' · '+esc(v.client):''}</span></div>
      <div class="acts"><button class="btn" type="button" data-vc="${v.id}" title="Что изменилось с тех пор">Сравнить с текущей</button><button class="btn" type="button" data-vo="${v.id}">Открыть</button></div></div>`).join(''):'<p class="empty">Прежних версий нет — КП сохранялось один раз.</p>'}</div>`, 'kpver');
  const done=()=>m.close();
  m.d.onclick=async e=>{ if (e.target.closest('[data-x]')) return done();
    const vc=e.target.closest('[data-vc]'); if (vc) return KpDiff.open(id, vc.dataset.vc, number);
    const b=e.target.closest('[data-vo]'); if (!b) return;
    try{ if (!await Drafts.stash()) return; const st=await api(`/api/kp/${encodeURIComponent(id)}/versions/${b.dataset.vo}`);
      S=Object.assign(freshState(), st);
      try{ S._rev=(await api(`/api/kp/${encodeURIComponent(id)}/rev`)).rev; }catch(e2){ delete S._rev; }   // прежняя версия заменит текущую правку КП
      done(); closeJournal&&closeJournal(); renderForm(); persist(); window.scrollTo({top:0});
      toast(`Открыта прежняя версия КП № ${S.number||''}. Сохраните КП, чтобы она стала текущей (нынешняя останется в истории).`); }
    catch(err){ toast('Не удалось открыть версию'); } };
}
