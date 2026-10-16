// «Настройки → Фиды поставщиков → Логотипы производителей»: заменить или поставить логотип марки — он встаёт на всё её
// оборудование в каталоге и закрепляется за маркой: фиды его не меняют, новые позиции получают его (сервер: app/maker_logos.py).
'use strict';

class MakerLogoPanel {
  static items = null;
  static q = '';
  static open = false;
  static ACCEPT = 'image/png,image/jpeg,image/webp';

  /** блок в окне фидов: свёрнут, пока не нужен */
  static html(){
    return `<details class="st-card ml-box" id="mlBox"${this.open ? ' open' : ''}><summary class="sub" style="margin:0;cursor:pointer">Логотипы производителей${tip('<p>Логотип марки ставится на всё её оборудование в каталоге (все написания: «Remeza», «REMEZA», «Ремеза») и закрепляется за ней: загрузка фидов его не меняет, новые позиции этой марки получают его.</p><p>«Открепить» — логотип на оборудовании останется, но фиды снова смогут ставить свой.</p><p>Картинка — PNG, JPEG или WebP до 2 МБ; лучше на прозрачном или белом фоне.</p>')}</summary>
      <div id="mlBody">${this.items ? this.body() : '<p class="muted">Загружаю…</p>'}</div></details>`;
  }
  static body(){
    const q=this.q.trim().toLowerCase(), L=(this.items||[]).filter(x=>!q || x.maker.toLowerCase().includes(q)), pinned=(this.items||[]).filter(x=>x.pinned).length;
    return `<div class="row" style="gap:8px;margin:6px 0"><input type="search" data-ml="q" value="${esc(this.q)}" placeholder="Найти производителя" style="flex:1 1 auto">
        <span class="muted">${(this.items||[]).length} ${plural((this.items||[]).length, 'производитель', 'производителя', 'производителей')}${pinned ? `, закреплено ${pinned}` : ''}</span></div>
      <div class="st-list ml-list">${L.slice(0, 300).map(x=>`<div class="st-row ml-row"><div class="ml-pic">${x.logo ? `<img src="${esc(x.logo.src)}" alt="">` : '<span class="muted">нет</span>'}</div>
        <div class="ml-t"><b>${esc(x.maker)}</b><span class="muted">${x.n} ${plural(x.n, 'позиция', 'позиции', 'позиций')}${x.pinned ? ' · <span class="ok-t">закреплён</span>' : ''}</span></div>
        <div class="acts"><label class="btn">${x.logo ? 'Заменить…' : 'Поставить…'}<input type="file" accept="${this.ACCEPT}" data-ml="file" data-maker="${esc(x.maker)}" hidden></label>
          ${x.pinned ? `<button class="btn" type="button" data-ml="unpin" data-maker="${esc(x.maker)}">Открепить</button>` : ''}</div></div>`).join('') || '<p class="muted">Не найдено.</p>'}</div>`;
  }
  /** обработчики в окне фидов (m — содержимое вкладки) */
  static bind(m){
    const box=m.querySelector('#mlBox'); if (!box) return;
    box.addEventListener('toggle', ()=>{ this.open=box.open; if (box.open && !this.items) this.load(m); });
    if (box.open && !this.items) this.load(m);
    box.addEventListener('input', e=>{ if (e.target.dataset.ml==='q'){ this.q=e.target.value; this._list(m); } });
    box.addEventListener('change', e=>{ const t=e.target; if (t.dataset.ml==='file' && t.files && t.files[0]) this.put(m, t.dataset.maker, t.files[0]); });
    box.addEventListener('click', e=>{ const b=e.target.closest('[data-ml="unpin"]'); if (b) this.unpin(m, b.dataset.maker); });
  }
  static async load(m){
    try{ this.items=(await aapi('logos')).items||[]; }catch(err){ this.items=[]; toast(err.message||String(err)); }
    const el=m.querySelector('#mlBody'); if (el) el.innerHTML=this.body();
  }
  static _list(m){ const el=m.querySelector('.ml-list'), tmp=document.createElement('div'); if (!el) return; tmp.innerHTML=this.body(); el.replaceWith(tmp.querySelector('.ml-list')); }
  static _read(file){ return new Promise((res, rej)=>{ const r=new FileReader(); r.onload=()=>res(String(r.result||'')); r.onerror=()=>rej(r.error); r.readAsDataURL(file); }); }
  static async put(m, maker, file){
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast('Нужна картинка PNG, JPEG или WebP');
    if (file.size>2*1024*1024) return toast('Картинка больше 2 МБ — уменьшите её');
    if (!await stConfirm(`Логотип «${maker}»?`, 'Встанет на всё оборудование этого производителя в каталоге и закрепится за ним: фиды его не поменяют, новые позиции получат его.', 'Поставить')) return;
    try{ const r=await ajson('logos', { maker, image:await this._read(file) });
      toast(`Логотип «${r.maker}» закреплён${r.items ? ` — обновлено ${r.items} ${plural(r.items, 'позиция', 'позиции', 'позиций')}` : ''}`);
      loadLogos(true);
      this.items=null; await this.load(m); }
    catch(err){ toast(err.message||String(err)); }
  }
  static async unpin(m, maker){
    if (!await stConfirm(`Открепить логотип «${maker}»?`, 'На оборудовании он останется; фиды снова смогут ставить свой логотип.', 'Открепить')) return;
    try{ await ajson('logos', { maker, unpin:true }); toast('Логотип откреплён'); loadLogos(true); this.items=null; await this.load(m); }
    catch(err){ toast(err.message||String(err)); }
  }
}
