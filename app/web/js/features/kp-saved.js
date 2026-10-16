// Окно «КП сохранено» (функция saveDlg): все следующие шаги в одном месте — файл, письмо клиенту, ход сделки,
// заготовка, новое КП. Без функции — прежнее сообщение с кнопками под «Сохранить КП».
'use strict';

class KpSaved {
  static async row(){
    try{ return ((await api(`/api/history?limit=5&offset=0&q=${encodeURIComponent(S.number)}`)).items||[]).find(z=>z.id===S.kpId) || null; }catch(e){ return null; }
  }
  /** o: {pdfOk, pdfErr, isNew} */
  static open(o){
    const remote=SRV.info&&SRV.info.local===false, id=esc(S.kpId), t=totalsS(), cs=curSh(kpCur()), tr=FEAT.on('track');
    const btn=(a, label, cls='', title='')=>`<button class="btn${cls?' '+cls:''}" type="button" ${a}${title?` title="${esc(title)}"`:''}>${label}</button>`;
    const m=new Modal(`<div class="dlg-h"><h3><span class="ks-ok" aria-hidden="true">✓</span> КП № ${esc(S.number)} ${o.isNew?'сохранено':'— изменения сохранены'}</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted" style="margin:0 0 4px">${esc(S.client||'')} · ${money(t.sum)} ${esc(cs)} · ${S.items.length} поз.${o.pdfOk?' · DOCX и PDF':''}</p>
      ${o.pdfErr?`<div class="msg err">PDF не создан: ${esc(o.pdfErr)} ${btn('data-a="printPdf"', 'Печать → «Сохранить как PDF»', 'sm')}</div>`:''}
      <div class="ks-g">
        <section><p class="sub">Файл</p><div class="ks-b">${btn(`data-a="openDoc" data-id="${id}"`, remote?'Скачать .docx':'Открыть в Word')}${o.pdfOk?btn(`data-a="openPdf" data-id="${id}"`, remote?'Скачать PDF':'Открыть PDF'):''}
          ${remote&&!SRV.info.docsShare?'':btn(`data-a="showDoc" data-id="${id}"`, remote?'Путь к файлу':'Показать в папке')}
          ${KpFilesPanel.on()?btn('data-ks="files"', `📎 Справочные документы${KpFilesPanel.count(S.kpId)?' ('+KpFilesPanel.count(S.kpId)+')':''}`, '', KpFilesPanel.ABOUT):''}</div></section>
        ${FEAT.on('mail')||tr?`<section><p class="sub">Клиенту</p><div class="ks-b">${FEAT.on('mail')?btn(`data-a="mailKp" data-id="${id}"`, '✉ Отправить по почте', 'primary', 'Письмо клиенту с файлом КП'):''}
          ${tr?btn('data-ks="sent"', 'Отметить «Отправлено»', '', 'Если отправили сами — из своей почты или мессенджера')+btn('data-ks="remind"', '⏰ Напоминание', '', 'Когда перезвонить клиенту'):''}</div></section>`:''}
        <section><p class="sub">Дальше</p><div class="ks-b">${btn('data-ks="new"', '＋ Новое КП')}${Presets.on()?btn('data-ks="preset"', 'Сохранить как заготовку', '', 'Позиции, цены и условия — для следующих КП'):''}${btn('data-x', 'Продолжить правку', 'ghost')}</div></section>
      </div>`, 'ks-dlg');
    m.d.addEventListener('click', async e=>{ const t=e.target;
      if (t.closest('[data-x]')) return m.close();
      if (t.closest('[data-a="mailKp"]')) return m.close();          // окно письма открывает общий обработчик
      const b=t.closest('[data-ks]'); if (!b) return; const k=b.dataset.ks;
      if (k==='new'){ m.close(); return NewKp.open(); }
      if (k==='files') return KpFilesPanel.open(S.kpId, S.number, {onClose:n=>{ b.textContent='📎 Справочные документы'+(n?` (${n})`:''); }});
      if (k==='preset'){ m.close(); return Presets.ask(); }
      if (k==='sent'){ try{ await KpTrack.put(S.kpId, {status:'sent'}); b.disabled=true; b.textContent='✓ Отправлено'; Reminders.load(); toast(`КП № ${S.number}: отправлено`); }catch(err){ toast('Не получилось: '+err.message); } return; }
      if (k==='remind'){ const r=await this.row(); m.close(); return KpTrack.open(r || {id:S.kpId, number:S.number, client:S.client, track:{}}); } });
  }
}
