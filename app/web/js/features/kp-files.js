// Справочные документы к КП (сервер: app/kp_files.py): паспорта, сертификаты, схемы, опросные листы — хранятся на сервере
// вместе с КП и в документ КП не входят. Где: раздел «Условия» (блок внизу), окно «КП сохранено», журнал → «📎» и «⋯»,
// письмо клиенту (галочки вложений). Добавить — кнопкой, перетаскиванием или вставкой из буфера (Ctrl+V); скачать,
// примечание. Удаляет только администратор: «Настройки → Сохранённые КП» → «📎».
'use strict';

class KpFilesPanel {
  static EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'dwg', 'dxf', 'zip', 'txt'];
  static ACCEPT = KpFilesPanel.EXTS.map(x=>'.'+x).join(',');
  static ABOUT = 'Файлы хранятся вместе с КП и в документ КП не входят: паспорта, сертификаты, схемы, опросные листы.';
  static data = new Map();       // номер КП → {items, limits} | null — загружается
  static wins = new Set();       // открытые окна документов: {kid, m, o, draw}
  static hover = null;           // поле документов под курсором — для Ctrl+V

  static on(){ return FEAT.on('kpFiles'); }
  static url(kid, fid){ return `/api/kp/${encodeURIComponent(kid)}/files${fid!=null?'/'+encodeURIComponent(fid):''}`; }
  static items(kid){ return (this.data.get(kid)||{}).items||[]; }
  static count(kid){ return this.items(kid).length; }
  static maxMB(kid){ return ((this.data.get(kid)||{}).limits||{}).fileMB || DEFN('kp.fileMB', 25); }
  static size(b){ b=+b||0; return b<1024*1024 ? Math.max(1, Math.round(b/1024))+' КБ' : (b/1048576).toFixed(b<10*1048576?1:0).replace('.', ',')+' МБ'; }

  static async load(kid){
    if (!this.data.get(kid)) this.data.set(kid, null);
    try{ this.data.set(kid, await api(this.url(kid))); }catch(e){ this.data.set(kid, {items:[], limits:{}, err:e.message}); }
    this.refresh(kid);
    return this.data.get(kid);
  }

  /** перерисовать места, где показаны документы этого КП */
  static refresh(kid){
    if (typeof S!=='undefined' && S.kpId===kid && STEP==='conds') renderForm();
    for (const w of this.wins) if (w.kid===kid) w.draw();
  }

  // ---------- вид
  static head(){
    return `<h3 class="kf-h"><span aria-hidden="true">📎</span> Справочные документы${tip(`<p>${this.ABOUT}</p><p>Прикрепить — кнопкой, перетаскиванием файлов в рамку или вставкой: выделите рамку и нажмите Ctrl+V (скопированный файл или снимок экрана).</p><p>Отправить клиенту — в окне письма галочками. Удалить ошибочный файл может администратор («Настройки → Сохранённые КП»).</p>`)}</h3>`;
  }

  /** блок в разделе «Условия»: КП ещё не сохранено — подсказка, иначе — список и добавление */
  static stepHtml(){
    if (!this.on()) return '';
    if (!S.kpId) return `<div class="kf-step">${this.head()}<p class="muted kf-wait">Сохраните КП, затем прикрепите документы. ${this.ABOUT}</p></div>`;
    if (!this.data.has(S.kpId)) this.load(S.kpId);
    return `<div class="kf-step" data-id="kf-step">${this.head()}${this.box(S.kpId)}</div>`;
  }

  /** o.admin — с кнопкой «Удалить» (окно из «Настроек») */
  static box(kid, o={}){
    const d=this.data.get(kid), k=esc(kid);
    const list = d==null ? '<p class="muted kf-load">Загружаю…</p>' : d.err ? `<p class="msg err">${esc(d.err)}</p>` : d.items.map(x=>this.row(kid, x, o)).join('');
    return `<div class="kf-box" data-kfdrop="${k}" tabindex="0" aria-label="Справочные документы КП: перетащите файлы или нажмите Ctrl+V">
      ${list?`<div class="kf-l">${list}</div>`:''}
      <div class="kf-add"><button class="btn sm" type="button" data-kfadd="${k}">＋ Прикрепить файл</button><button class="btn sm ghost kf-clip" type="button" data-kfclip="${k}" title="Скопированный снимок экрана или картинка; файл из проводника — Ctrl+V в этой рамке">Из буфера</button>
        <span class="muted kf-hint"><span class="kf-drag">или перетащите сюда · </span>PDF, Word, Excel, JPG, PNG, DWG, DXF, ZIP, TXT до ${esc(String(this.maxMB(kid)))} МБ</span></div></div>`;
  }

  static row(kid, x, o){
    const href=this.url(kid, x.id), ext=String(x.ext||'').replace(/[^a-z]/g, '');
    return `<div class="kf-r" data-id="kf-${esc(String(x.id))}"><span class="kf-ext kf-${ext}" aria-hidden="true">${esc(ext.toUpperCase()||'?')}</span>
      <div class="kf-m"><a class="kf-n" href="${href}" download title="Скачать «${esc(x.name)}»">${esc(x.name)}</a>
        <span class="muted">${this.size(x.size)} · ${esc(KpDate.ddmm(x.added))}${x.by?' · '+esc(jShort(x.by)):''}</span>
        <input type="text" class="kf-note" data-kfnote="${esc(String(x.id))}" data-kid="${esc(kid)}" value="${esc(x.note||'')}" maxlength="300" placeholder="Примечание: что это за документ" aria-label="Примечание к файлу ${esc(x.name)}" autocomplete="off"></div>
      <div class="acts"><a class="btn sm kf-dl" href="${href}" download aria-label="Скачать «${esc(x.name)}»"><span aria-hidden="true">⬇</span><span class="kf-dlt"> Скачать</span></a>${o.admin?`<button class="btn sm danger" type="button" data-kfdel="${esc(String(x.id))}" data-kid="${esc(kid)}">Удалить</button>`:''}</div></div>`;
  }

  /** окно документов КП (журнал, «КП сохранено», «Настройки»); o: {admin, onClose(число документов)} */
  static open(kid, number, o={}){
    const m=new Modal(`<div class="dlg-h"><h3><span aria-hidden="true">📎</span> Справочные документы · КП № ${esc(number||kid)}</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted kf-about">${esc(this.ABOUT)}</p><div class="kf-host"></div>
      <div class="dlg-acts"><button class="btn" type="button" data-x>Готово</button></div>`, 'kf-dlg');
    const w={kid, m, o, draw:()=>{ const h=m.$('.kf-host'); if (h) h.innerHTML=this.box(kid, o); }};
    this.wins.add(w);
    m.d.addEventListener('close', ()=>{ this.wins.delete(w); if (o.onClose) o.onClose(this.count(kid)); });
    m.d.addEventListener('click', e=>{ if (e.target.closest('[data-x]')) m.close(); });
    w.draw(); this.load(kid);
  }

  // ---------- действия
  static pick(kid){
    const f=document.createElement('input'); f.type='file'; f.multiple=true; f.accept=this.ACCEPT; f.hidden=true; document.body.appendChild(f);
    f.onchange=()=>{ const L=[...f.files]; f.remove(); if (L.length) this.upload(kid, L); };
    f.addEventListener('cancel', ()=>f.remove());
    f.click();
  }

  /** имя файла для сервера: снимок экрана из буфера («image.png») — «Снимок ДД.ММ.ГГГГ ЧЧ-ММ.png» */
  static nameOf(f){
    const n=String(f.name||'').trim();
    if (n && !/^image\.(png|jpe?g)$/i.test(n)) return n;
    const d=new Date(), p=x=>String(x).padStart(2, '0'), ext=/jpe?g/.test(f.type||n)?'jpg':'png';
    return `Снимок ${p(d.getDate())}.${p(d.getMonth()+1)}.${d.getFullYear()} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.${ext}`;
  }

  static async upload(kid, files){
    if (!this.data.get(kid)) await this.load(kid);
    const max=this.maxMB(kid), bad=[]; let ok=0;
    for (const [i, f] of files.entries()){
      const name=this.nameOf(f), ext=(name.match(/\.([^.]+)$/)||[])[1]?.toLowerCase();
      if (!this.EXTS.includes(ext)){ bad.push(`«${name}» — такой файл не прикрепить (можно PDF, Word, Excel, JPG, PNG, DWG, DXF, ZIP, TXT)`); continue; }
      if (f.size>max*1048576){ bad.push(`«${name}» — ${this.size(f.size)}, можно до ${max} МБ`); continue; }
      if (!f.size){ bad.push(`«${name}» — пустой файл`); continue; }
      toast(files.length>1 ? `Прикрепляю ${i+1} из ${files.length}: ${name}` : `Прикрепляю «${name}»…`);
      try{ await api(this.url(kid)+'?name='+encodeURIComponent(name), {method:'POST', headers:{'Content-Type':'application/octet-stream'}, body:f}); ok++; }
      catch(e){ bad.push(e.message); }
    }
    await this.load(kid);
    if (bad.length) toast((ok?`Прикреплено: ${ok}. `:'')+'Не прикреплено: '+bad.join('; '));
    else if (ok) toast(ok>1 ? `Прикреплено документов: ${ok}` : 'Документ прикреплён к КП');
  }

  /** «Из буфера»: снимок экрана или картинка читаются сразу; файл из проводника браузер отдаёт только по Ctrl+V */
  static async clip(kid){
    if (navigator.clipboard && navigator.clipboard.read){
      try{ const out=[];
        for (const it of await navigator.clipboard.read()){ const t=it.types.find(x=>x==='image/png'||x==='image/jpeg');
          if (t) out.push(new File([await it.getType(t)], t==='image/png'?'image.png':'image.jpg', {type:t})); }
        if (out.length) return this.upload(kid, out);
      }catch(e){ /* нет доступа к буферу — дальше подсказка про Ctrl+V */ }
    }
    const z=[...document.querySelectorAll('[data-kfdrop]')].find(x=>x.dataset.kfdrop===kid); if (z) z.focus();
    toast('Нажмите Ctrl+V — скопированные файлы или снимок экрана прикрепятся к КП');
  }

  static async note(inp){
    const kid=inp.dataset.kid, fid=+inp.dataset.kfnote, x=this.items(kid).find(z=>z.id===fid), v=inp.value.trim();
    if (!x || v===(x.note||'')) return;
    try{ const r=await api(this.url(kid, fid), {method:'PUT', headers:{'Content-Type':'application/json; charset=utf-8'}, body:JSON.stringify({note:v})});
      x.note=r.note; toast('Примечание сохранено'); }
    catch(e){ toast('Примечание не сохранено: '+e.message); }
  }

  /** удаление — только администратор («Настройки»), с подтверждением */
  static async remove(kid, fid){
    const x=this.items(kid).find(z=>z.id===fid); if (!x) return;
    if (!await stConfirm('Удалить документ?', `«${x.name}» удалится с сервера безвозвратно — у КП № ${kid} его больше не будет.`, 'Удалить')) return;
    try{ await api(`/api/admin/kpfiles/${encodeURIComponent(kid)}/${encodeURIComponent(fid)}/delete`, {method:'POST', headers:{'Content-Type':'application/json; charset=utf-8'}, body:'{}'});
      toast('Документ удалён'); }
    catch(e){ toast('Не удалено: '+e.message); }
    this.load(kid);
  }

  static zone(el){ return el && el.closest ? el.closest('[data-kfdrop]') : null; }

  static bind(){
    document.addEventListener('click', e=>{
      const a=e.target.closest('[data-kfadd]'); if (a) return this.pick(a.dataset.kfadd);
      const c=e.target.closest('[data-kfclip]'); if (c) return this.clip(c.dataset.kfclip);
      const d=e.target.closest('[data-kfdel]'); if (d) return this.remove(d.dataset.kid, +d.dataset.kfdel);
    });
    document.addEventListener('change', e=>{ const n=e.target.closest && e.target.closest('[data-kfnote]'); if (n) this.note(n); });
    document.addEventListener('keydown', e=>{ const n=e.target.closest && e.target.closest('[data-kfnote]'); if (n && e.key==='Enter'){ e.preventDefault(); n.blur(); } });
    document.addEventListener('pointerover', e=>{ this.hover=this.zone(e.target); });
    ['dragover', 'dragleave', 'drop'].forEach(ev=>document.addEventListener(ev, e=>{
      const z=this.zone(e.target); if (!z) return;
      e.preventDefault(); z.classList.toggle('over', ev==='dragover');
      if (ev!=='drop') return;
      const files=[...(e.dataTransfer && e.dataTransfer.files || [])];
      if (files.length) this.upload(z.dataset.kfdrop, files); else toast('Перетащите файл с компьютера (из проводника или с рабочего стола)');
    }));
    document.addEventListener('paste', e=>{
      const act=document.activeElement, z=this.zone(act) || (this.hover && this.hover.isConnected ? this.hover : null); if (!z) return;
      if (act && /^(INPUT|TEXTAREA|SELECT)$/.test(act.tagName)) return;          // в примечание вставляется текст
      const files=[...(e.clipboardData && e.clipboardData.files || [])];
      if (!files.length) return;
      e.preventDefault(); this.upload(z.dataset.kfdrop, files);
    });
  }
}

KpFilesPanel.bind();
