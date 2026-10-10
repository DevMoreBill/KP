// «Настройки → Умолчания»: что программа подставляет сама. У каждого значения — переключатель (выключено — поле
// остаётся пустым, решает менеджер) и своё значение; «↺» — вернуть встроенное. Реестр — js/core/defaults.js.
'use strict';

async function stDefaults(m){
  const r=await aapi('defaults'), V=r.values||{};
  const optsOf=o=>typeof o.opts==='function' ? o.opts() : (o.opts||[]);
  const row=([key, , label, type, builtin, o={}])=>{
    const x=V[key], own=x&&typeof x==='object';
    const on = type==='bool' ? (own&&'on' in x ? !!x.on : !!builtin) : o.req ? true : own&&'on' in x ? !!x.on : !o.off;
    const v = own && x.v!=null && String(x.v)!=='' ? String(x.v) : String(builtin??'');
    const inp = type==='bool' ? '' : type==='select'
      ? `<select data-dv aria-label="${esc(label)}"${on?'':' disabled'}>${optsOf(o).map(([a,b])=>`<option value="${esc(a)}"${String(a)===v?' selected':''}>${esc(b)}</option>`).join('')}</select>`
      : `<span class="df-in"><input type="text" data-dv value="${esc(v)}" aria-label="${esc(label)}"${type==='num'?' inputmode="decimal"':''}${on?'':' disabled'} placeholder="${esc(String(builtin||(o.list?'выберите или впишите':'')))}"${o.list?` list="dfl-${esc(key)}"`:''} autocomplete="off">${o.unit?`<i>${esc(o.unit)}</i>`:''}</span>${o.list?`<datalist id="dfl-${esc(key)}">${o.list().map(z=>`<option value="${esc(z)}">`).join('')}</datalist>`:''}`;
    return `<div class="df-row${on?'':' off'}${own?' own':''}" data-dk="${esc(key)}" data-type="${type}">
      <label class="sw df-sw" title="${o.req?'Обязательное значение — всегда действует':'Включить / выключить'}"><input type="checkbox" data-don${on?' checked':''}${o.req?' disabled':''}><span></span></label>
      <div class="df-l"><b>${esc(label)}</b>${o.hint?`<small class="muted">${esc(o.hint)}</small>`:''}</div>
      <div class="df-v">${inp}</div>
      <button type="button" class="icon df-rs" data-dreset title="Вернуть встроенное значение${type==='bool'?'':': '+esc(String(builtin||'пусто'))}" aria-label="Вернуть встроенное"${own?'':' disabled'}>↺</button></div>`; };
  m.innerHTML=`<div class="st-card df-top"><p class="sub" style="margin:0">Что программа подставляет сама</p>
      <p class="muted">Включено — значение подставляется в новые КП, расчёты и карточки (менеджер может изменить). Выключено — поле остаётся пустым, решает менеджер.
      «↺» — вернуть значение программы. Уже созданные КП не меняются.</p>
      <label class="ck st-own"><input type="checkbox" id="dfOwn" data-nodirty${stDefaults.only?' checked':''}> Только изменённые (${Object.keys(V).filter(k=>DEF_BY[k]).length})</label></div>
    ${DEF_GROUPS.map(([g,t])=>{ const rows=DEF_SCHEMA.filter(x=>x[1]===g); return rows.length?`<div class="st-card df-g"><p class="sub">${esc(t)}</p>${DEF_GROUP_HINTS[g]?`<p class="muted df-gh">${esc(DEF_GROUP_HINTS[g])}</p>`:''}${rows.map(row).join('')}</div>`:''; }).join('')}
    <div class="df-bar"><span class="muted" id="dfSt">Изменений нет</span><button class="btn ghost" type="button" data-dall>Вернуть все встроенные</button><button class="btn primary" type="button" data-dsave disabled>Сохранить</button></div>`;
  m.classList.toggle('st-only', !!stDefaults.only);
  m.querySelector('#dfOwn').onchange=e=>{ stDefaults.only=e.target.checked; m.classList.toggle('st-only', e.target.checked); };
  const dirty=()=>{ const b=m.querySelector('[data-dsave]'); b.disabled=false; $('#dfSt').textContent='Есть несохранённые изменения'; };
  m.onchange=e=>{ const rw=e.target.closest('.df-row'); if (!rw) return;
    if (e.target.matches('[data-don]')){ rw.classList.toggle('off', !e.target.checked); const v=rw.querySelector('[data-dv]'); if (v) v.disabled=!e.target.checked; }
    rw.dataset.ch='1'; dirty(); };
  m.oninput=e=>{ const rw=e.target.closest('.df-row'); if (rw){ rw.dataset.ch='1'; dirty(); } };
  m.onclick=async e=>{
    const rs=e.target.closest('[data-dreset]'); if (rs){ const rw=rs.closest('.df-row'); await stDefSave(m, {[rw.dataset.dk]:null}, 'Возвращено встроенное значение'); return; }
    if (e.target.closest('[data-dall]')){ if (!await stConfirm('Вернуть все значения программы?','Ваши умолчания удалятся, будут действовать встроенные значения.','Вернуть')) return;
      return stDefSave(m, Object.fromEntries(Object.keys(V).map(k=>[k,null])), 'Все умолчания — как в программе'); }
    if (!e.target.closest('[data-dsave]')) return;
    const out={};
    m.querySelectorAll('.df-row[data-ch]').forEach(rw=>{ const k=rw.dataset.dk, sc=DEF_BY[k]; if (!sc) return; const [, , , type, builtin, o={}]=sc;
      const on=rw.querySelector('[data-don]').checked, el=rw.querySelector('[data-dv]'), v=el?el.value.trim():'';
      if (type==='num' && v && !Number.isFinite(parseFloat(v.replace(',','.')))) { rw.classList.add('bad'); return; }
      const same = type==='bool' ? on===!!builtin : on===(o.req?true:!o.off) && (v===String(builtin??'') || (!v && !on));
      out[k] = same ? null : {on, v}; });
    if (m.querySelector('.df-row.bad')) return toast('Проверьте числа — отмечены красным');
    stDefSave(m, out, 'Умолчания сохранены — действуют для новых КП и расчётов');
  };
}

async function stDefSave(m, values, msg){
  try{ const r=await ajson('defaults', {values}); DEFS_SRV=r.values||{}; try{ localStorage.setItem('kp.defaults', JSON.stringify(DEFS_SRV)); }catch(_){}
    toast(msg); stDefaults(m); }
  catch(err){ toast('Не сохранено: '+(err.message||err)); }
}
stDefaults.only = false;     // фильтр «Только изменённые» — запоминается, пока открыта программа
