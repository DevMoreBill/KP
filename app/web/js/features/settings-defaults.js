// «Настройки → Значения программы»: всё, что программа подставляет и с чем считает, — по разделам (слева), с поиском
// и подробным пояснением у каждого значения. У значения — переключатель (выключено — поле остаётся пустым, решает
// менеджер; у обязательных переключателя нет), своё значение (галочка, выбор из списка или число с проверкой границ)
// и «↺» — вернуть значение программы. Реестр — js/core/defaults.js (DefRegistry) и файлы разделов.
'use strict';

class DefaultsTab {
  static sec = 'kp';       // открытый раздел (запоминается, пока открыта программа)
  static q = '';           // строка поиска
  static only = false;     // «Только изменённые»

  static optsOf(o){ return typeof o.opts==='function' ? o.opts() : (o.opts||[]); }
  static fmt(v, o={}){ let t=String(v??'').trim(); if (/^-?\d+(\.\d+)?$/.test(t)) t=Number(t).toLocaleString('ru-RU', { maximumFractionDigits:6 }); return t ? t+(o.unit ? ' '+o.unit : '') : 'пусто'; }
  /** строка значения */
  static row(V, [key, , label, type, builtin, o={}]){
    const x=V[key], own=x && typeof x==='object';
    const on=type==='bool' ? (own && 'on' in x ? !!x.on : !!builtin) : o.req ? true : own && 'on' in x ? !!x.on : !o.off;
    const v=own && x.v!=null && String(x.v)!=='' ? String(x.v) : String(builtin??'');
    const nf=n=>Number(n).toLocaleString('ru-RU', { maximumFractionDigits:6 }), lim=type==='num' && (o.min!=null || o.max!=null) ? `${o.min!=null ? 'от '+nf(o.min) : ''}${o.min!=null && o.max!=null ? ' ' : ''}${o.max!=null ? 'до '+nf(o.max) : ''}` : '';
    const inp=type==='bool' ? '' : type==='select'
      ? `<select data-dv aria-label="${esc(label)}"${on ? '' : ' disabled'}>${this.optsOf(o).map(([a, b])=>`<option value="${esc(a)}"${String(a)===v ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select>`
      : `<span class="df-in"><input type="text" data-dv value="${esc(v)}" aria-label="${esc(label)}"${type==='num' ? ' inputmode="decimal"' : ''}${on ? '' : ' disabled'} placeholder="${esc(String(builtin||(o.list ? 'выберите или впишите' : '')))}"${o.list ? ` list="dfl-${esc(key)}"` : ''} autocomplete="off">${o.unit ? `<i>${esc(o.unit)}</i>` : ''}</span>${o.list ? `<datalist id="dfl-${esc(key)}">${this.optsOf({opts:o.list}).map(([a])=>`<option value="${esc(a)}">`).join('')}</datalist>` : ''}`;
    const prog=type==='bool' ? (builtin ? 'включено' : 'выключено') : type==='select' ? ((this.optsOf(o).find(([a])=>String(a)===String(builtin))||[, builtin])[1]||'пусто') : this.fmt(builtin, o);
    return `<div class="df-row${on ? '' : ' off'}${own ? ' own' : ''}" data-dk="${esc(key)}" data-type="${type}">
      <label class="sw df-sw" title="${o.req ? 'Обязательное значение — всегда действует' : 'Включить / выключить'}"><input type="checkbox" data-don${on ? ' checked' : ''}${o.req ? ' disabled' : ''}><span></span></label>
      <div class="df-l"><b>${esc(label)}</b>${o.hint ? `<small class="muted">${esc(o.hint)}</small>` : ''}<small class="df-pv">В программе: ${esc(prog)}${lim ? ` · допустимо ${esc(lim)}` : ''}</small><small class="df-err" hidden></small></div>
      <div class="df-v">${inp}</div>
      <button type="button" class="icon df-rs" data-dreset title="Вернуть значение программы: ${esc(prog)}" aria-label="Вернуть значение программы"${own ? '' : ' disabled'}>↺</button></div>`;
  }
  static match(r, q){ if (!q) return true; const o=r[5]||{}; return [r[0], r[2], o.hint, o.unit].join(' ').toLowerCase().includes(q); }
  /** группы раздела (или всех разделов при поиске): [[группа, название, строки]] */
  static groups(V){
    const q=this.q.trim().toLowerCase();
    return DEF_GROUPS.map(([g, t])=>[g, t, DEF_SCHEMA.filter(r=>r[1]===g && (q || DefRegistry.section(g)===this.sec) && this.match(r, q) && (!this.only || V[r[0]]))]).filter(x=>x[2].length);
  }
  static async render(m){
    const r=await aapi('defaults'), V=r.values||{};
    const cnt=s=>DEF_SCHEMA.filter(x=>DefRegistry.section(x[1])===s).length, own=s=>DEF_SCHEMA.filter(x=>DefRegistry.section(x[1])===s && V[x[0]]).length;
    const secs=DefRegistry.SECTIONS.filter(([s])=>cnt(s));
    if (!secs.some(([s])=>s===this.sec) && secs.length) this.sec=secs[0][0];
    const cur=secs.find(([s])=>s===this.sec)||[];
    m.innerHTML=`<div class="df-wrap">
      <nav class="df-nav" aria-label="Разделы">${secs.map(([s, t])=>`<button type="button" class="df-nb${s===this.sec && !this.q ? ' on' : ''}" data-dsec="${s}">${esc(t)}<small>${cnt(s)}${own(s) ? ` · изменено ${own(s)}` : ''}</small></button>`).join('')}</nav>
      <div class="df-main">
        <div class="st-card df-top"><div class="df-tl"><input type="search" id="dfQ" data-nodirty placeholder="Найти значение: например, «НДС», «страхование», «копии»" value="${esc(this.q)}" autocomplete="off">
          <label class="ck st-own"><input type="checkbox" id="dfOwn" data-nodirty${this.only ? ' checked' : ''}> Только изменённые (${Object.keys(V).filter(k=>DEF_BY[k]).length})</label></div>
          <p class="muted">${this.q ? 'Найдено во всех разделах.' : esc(cur[2]||'')} Значения действуют для новых КП и расчётов — уже созданные КП не меняются.
          Переключатель выключен — поле остаётся пустым, решает менеджер. «↺» — вернуть значение программы.</p></div>
        <div id="dfList">${this.list(V)}</div></div></div>
      <div class="df-bar"><span class="muted" id="dfSt">Изменений нет</span><button class="btn ghost" type="button" data-dall>Вернуть все значения программы</button><button class="btn primary" type="button" data-dsave disabled>Сохранить</button></div>`;
    this.bind(m, V);
  }
  static list(V){
    const G=this.groups(V);
    return G.length ? G.map(([g, t, rows])=>`<div class="st-card df-g"><p class="sub">${esc(t)}${this.q ? ` <small class="muted">· ${esc((DefRegistry.SECTIONS.find(([s])=>s===DefRegistry.section(g))||[, ''])[1])}</small>` : ''}</p>${DEF_GROUP_HINTS[g] ? `<p class="muted df-gh">${esc(DEF_GROUP_HINTS[g])}</p>` : ''}${rows.map(x=>this.row(V, x)).join('')}</div>`).join('')
      : '<p class="muted st-card">Ничего не найдено. Попробуйте другое слово или снимите «Только изменённые».</p>';
  }
  static bind(m, V){
    const dirty=()=>{ m.querySelector('[data-dsave]').disabled=false; $('#dfSt').textContent='Есть несохранённые изменения'; };
    const relist=()=>{ m.querySelector('#dfList').innerHTML=this.list(V); m.querySelectorAll('.df-nb').forEach(b=>b.classList.toggle('on', !this.q && b.dataset.dsec===this.sec)); };
    const q=m.querySelector('#dfQ'); let t=0;
    q.oninput=()=>{ clearTimeout(t); t=setTimeout(()=>{ if (this.changed(m) && !confirm('Несохранённые изменения пропадут. Продолжить?')){ q.value=this.q; return; } this.q=q.value; relist(); }, 200); };
    m.querySelector('#dfOwn').onchange=e=>{ this.only=e.target.checked; relist(); };
    m.onchange=e=>{ const rw=e.target.closest('.df-row'); if (!rw) return;
      if (e.target.matches('[data-don]')){ rw.classList.toggle('off', !e.target.checked); const v=rw.querySelector('[data-dv]'); if (v) v.disabled=!e.target.checked; }
      rw.dataset.ch='1'; this.validate(rw); dirty(); };
    m.oninput=e=>{ const rw=e.target.closest('.df-row'); if (rw){ rw.dataset.ch='1'; this.validate(rw); dirty(); } };
    m.onclick=async e=>{
      const sb=e.target.closest('[data-dsec]');
      if (sb){ if (this.changed(m) && !confirm('Несохранённые изменения пропадут. Перейти в другой раздел?')) return; this.sec=sb.dataset.dsec; this.q=''; q.value=''; return this.render(m); }
      const rs=e.target.closest('[data-dreset]'); if (rs){ const rw=rs.closest('.df-row'); await this.save(m, { [rw.dataset.dk]:null }, 'Возвращено значение программы'); return; }
      if (e.target.closest('[data-dall]')){ if (!await stConfirm('Вернуть все значения программы?', 'Все ваши значения во всех разделах удалятся, будут действовать значения программы.', 'Вернуть')) return;
        return this.save(m, Object.fromEntries(Object.keys(V).map(k=>[k, null])), 'Все значения — как в программе'); }
      if (!e.target.closest('[data-dsave]')) return;
      const out={};
      m.querySelectorAll('.df-row[data-ch]').forEach(rw=>{ const k=rw.dataset.dk, sc=DEF_BY[k]; if (!sc || !this.validate(rw)) return; const [, , , type, builtin, o={}]=sc;
        const on=rw.querySelector('[data-don]').checked, el=rw.querySelector('[data-dv]'), v=el ? el.value.trim() : '';
        const same=type==='bool' ? on===!!builtin : on===(o.req ? true : !o.off) && (v===String(builtin??'') || (!v && !on));
        out[k]=same ? null : { on, v }; });
      if (m.querySelector('.df-row.bad')) return toast('Проверьте значения — отмечены красным');
      this.save(m, out, 'Значения сохранены — действуют для новых КП и расчётов');
    };
  }
  static changed(m){ return !!m.querySelector('.df-row[data-ch]'); }
  /** проверка числа строки: подсветка и текст ошибки; true — верно */
  static validate(rw){
    const el=rw.querySelector('[data-dv]'), on=rw.querySelector('[data-don]').checked, err=on && el ? DefRegistry.check(rw.dataset.dk, el.value) : '';
    rw.classList.toggle('bad', !!err); const s=rw.querySelector('.df-err'); s.hidden=!err; s.textContent=err ? 'Ошибка: '+err : '';
    return !err;
  }
  static async save(m, values, msg){
    try{ const r=await ajson('defaults', { values }); DEFS_SRV=r.values||{}; try{ localStorage.setItem('kp.defaults', JSON.stringify(DEFS_SRV)); }catch(_){ /* без хранилища браузера */ }
      toast(msg); this.render(m); }
    catch(err){ toast('Не сохранено: '+(err.message||err)); }
  }
}
// вход из «Настроек» (вкладка «Значения программы»)
function stDefaults(m){ return DefaultsTab.render(m); }

async function defaultsLoad(){
  try{ const r=await api('/api/defaults'); DEFS_SRV=r && typeof r==='object' ? r : {}; try{ localStorage.setItem('kp.defaults', JSON.stringify(DEFS_SRV)); }catch(_){ /* без хранилища браузера */ } }catch(e){ /* сервер недоступен — значения из браузера */ }
}
