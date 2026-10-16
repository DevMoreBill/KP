'use strict';
// «⋯ → Мои настройки» — личные настройки менеджера (сервер: app/user_prefs.py). Хранятся на сервере у менеджера и действуют
// на любом компьютере, где он работает: тема, стартовый экран, шаблон КП, свои значения для новых КП (город, валюта,
// условия — поверх умолчаний отдела), подпись и копия себе в письмах клиентам.

class MyPrefs {
  static p = {};
  static uid = '';
  static START = [['auto','Как в программе («Мой день» или каталог)'],['myday','«Мой день»'],['catalog','Каталог'],['journal','Журнал КП'],['none','Ничего — сразу текущее КП']];
  static THEME = [['auto','Как в системе'],['light','Светлая'],['dark','Тёмная']];

  static async load(){
    try{ const r=await api('/api/me/prefs'); this.uid=r.id||''; this.p=r.prefs||{}; }catch(e){ this.p={}; }
    this.apply(); return this.p;
  }

  /** своё значение для новых КП (поверх умолчаний отдела) — или null */
  static def(key){ const v=(this.p.defaults||{})[key]; return v!=null && String(v).trim()!=='' ? String(v) : null; }

  static apply(){
    if (Theme.NAMES.includes(this.p.theme)) Theme.set(this.p.theme);
    if (this.p.template){ try{ localStorage.setItem('kp.template', this.p.template); }catch(e){} }
  }

  /** стартовый экран после загрузки программы */
  static start(){
    const s=this.p.start||'auto';
    if (s==='none') return true;
    if (s==='myday' && MyDay.on()){ MyDay.open(); return true; }
    if (s==='journal' && typeof openJournal==='function'){ openJournal(); return true; }
    if (s==='catalog'){ if (catCache.length) openCatalog({}); return true; }
    return false;          // как в программе
  }

  /** письмо клиенту: подпись в конце текста, копия себе — по настройке */
  static mail(f){
    const sign=String(this.p.mailSign||'').trim();
    if (sign && !String(f.body||'').includes(sign)) f.body=String(f.body||'').replace(/\s+$/,'')+'\n\n'+sign;
    if (this.p.mailCopy===false) f.cc='';
    return f;
  }

  /** тема из меню «⋯» — запомнить и в личных настройках */
  static async rememberTheme(t){ if (!this.uid) return; this.p={...this.p, theme:t}; try{ await this.save(this.p); }catch(e){ /* без сервера тема всё равно в браузере */ } }

  static async save(p){ const r=await api('/api/me/prefs', {method:'PUT', headers:{'Content-Type':'application/json; charset=utf-8'}, body:JSON.stringify(p)}); this.p=r.prefs||{}; this.uid=r.id||this.uid; return this.p; }

  static open(){
    if (!meId()) return toast('Сначала выберите себя в разделе «Менеджер» — настройки сохраняются для менеджера');
    const p=this.p, D=p.defaults||{}, me=MGRS.find(x=>x.id===meId());
    const opt=(list, v)=>list.map(([k,l])=>`<option value="${esc(k)}"${(v||'auto')===k?' selected':''}>${esc(l)}</option>`).join('');
    const company=k=>{ const sc=DEF_BY[k]; if (!sc) return ''; const x=DEFS_SRV[k]; return x&&x.v!=null&&String(x.v)!=='' ? String(x.v) : String(sc[4]??''); };
    const conds=DEF_SCHEMA.filter(x=>x[1]==='cond');
    const tpls=TEMPLATES.filter(t=>!t.error);
    const m=new Modal(`<div class="dlg-h"><h3>Мои настройки<small>${esc(me?me.name:'')}</small></h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted" style="margin-top:0">Только для вас и на любом компьютере, где вы работаете. Общие правила отдела задаёт администратор («Настройки → Умолчания»); пустое поле — как у отдела.</p>
      <div class="grid g2"><label class="f"><span>Тема</span><select id="mpTheme">${opt(this.THEME, p.theme)}</select></label>
        <label class="f"><span>При запуске открывать</span><select id="mpStart">${opt(this.START, p.start)}</select></label>
        <label class="f"><span>Шаблон новых КП</span><select id="mpTpl"><option value="">Как в программе</option>${tpls.map(t=>`<option value="${esc(t.id)}"${p.template===t.id?' selected':''}>${esc(t.name)}</option>`).join('')}</select></label>
        <label class="f"><span>Валюта новых КП</span><select id="mpCur"><option value="">Как у отдела (${esc(company('kp.cur'))})</option>${[['RUB','Рубли'],['USD','Доллары США'],['EUR','Евро'],['CNY','Юани']].map(([k,l])=>`<option value="${k}"${D['kp.cur']===k?' selected':''}>${l}</option>`).join('')}</select></label>
        <label class="f"><span>Город в КП</span><input type="text" id="mpCity" value="${esc(D['kp.city']||'')}" placeholder="${esc(company('kp.city'))}" autocomplete="off"></label></div>
      <details class="more"${conds.some(c=>D[c[0]])?' open':''}><summary>Мои условия для новых КП</summary>
        <div class="grid g2" style="margin-top:8px">${conds.map(([k, , l])=>`<label class="f"><span>${esc(l)}</span><input type="text" data-mpd="${esc(k)}" value="${esc(D[k]||'')}" placeholder="${esc(company(k)||'как у отдела')}" autocomplete="off"></label>`).join('')}</div></details>
      <p class="sub" style="margin:14px 0 6px">Письма клиентам</p>
      <label class="f"><span>Подпись — добавляется в конец письма</span><textarea id="mpSign" rows="4" placeholder="С уважением,&#10;${esc(me?me.name:'Иван Петров')}&#10;${esc(me&&me.phone||'+7 (…)')}">${esc(p.mailSign||'')}</textarea></label>
      <label class="mp-ck"><input type="checkbox" id="mpCopy"${p.mailCopy===false?'':' checked'}> Ставить меня в копию письма${me&&me.email?' ('+esc(me.email)+')':''}</label>
      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:14px"><button class="btn" type="button" data-x>Отмена</button><button class="btn primary" type="button" data-mpsave>Сохранить</button></div>`, 'mp-dlg');
    m.d.onclick=async e=>{ if (e.target.closest('[data-x]')) return m.close();
      if (!e.target.closest('[data-mpsave]')) return;
      const defs={}; if (m.$('#mpCity').value.trim()) defs['kp.city']=m.$('#mpCity').value.trim(); if (m.$('#mpCur').value) defs['kp.cur']=m.$('#mpCur').value;
      m.d.querySelectorAll('[data-mpd]').forEach(i=>{ if (i.value.trim()) defs[i.dataset.mpd]=i.value.trim(); });
      try{ await this.save({theme:m.$('#mpTheme').value, start:m.$('#mpStart').value, template:m.$('#mpTpl').value, defaults:defs,
          mailSign:m.$('#mpSign').value, mailCopy:m.$('#mpCopy').checked});
        if (!m.$('#mpTpl').value){ try{ localStorage.removeItem('kp.template'); }catch(_){} }
        this.apply(); m.close(); toast('Мои настройки сохранены — для новых КП и писем'); }
      catch(err){ toast('Не сохранено: '+(err.message||err)); } };
  }
}
