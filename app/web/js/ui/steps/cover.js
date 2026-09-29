// Раздел 4 «Титульный лист».
'use strict';

function stepCover(){
  const c=S.cover;
  const k = c.kpis.map((_,j)=>`<div class="grid" style="gap:6px">${field('Значение',`cover.kpis.${j}.num`,{ph:['32','40','230/400','9,3'][j]})}${field('Ед.',`cover.kpis.${j}.unit`,{ph:['кВт','кВт','В','л/ч'][j]})}${field('Подпись',`cover.kpis.${j}.cap`,{ph:['номинальная мощность','максимальная','три фазы, 50 Гц','расход топлива'][j]})}</div>`).join('');
  const src = S.items.find(x=>x.hint);
  const tp = templatePicker();
  return `<section class="step" id="st-cover">${''}<h2><span class="n">3</span>Титульный лист</h2>
  ${tp}
  ${(()=>{ const n=stationsOf().length; return n>=2
    ? `<p class="hint"><b>В КП ${n} ${plural(n,'модель','модели','моделей')} оборудования.</b> На титуле будет блок «Оборудование в предложении» с фото, мощностью, исполнением и количеством каждой модели. Заголовок и описание подставятся автоматически — если заполните поля ниже вручную, будут использованы ваши. Ключевые параметры в этом режиме не выводятся.</p>`
    : `<p class="hint">Фото на титул берётся из первой позиции с фото. Поля ниже заполняются автоматически при выборе оборудования из каталога — проверьте и поправьте при необходимости.</p>`; })()}
  <div class="grid g2">${field('Тип оборудования','cover.title',{ph:'Дизель-генераторные установки'})}${field('Модель / серия','cover.model',{req:1,ph:'HERTZ HG 45 CH'})}</div>
  <div class="grid" style="margin-top:14px">${field('Описание под заголовком','cover.desc',{area:1,rows:2,ph:'Установки в кожухе номинальной мощностью …'})}</div>
  <p class="sub" style="margin-top:18px">Ключевые параметры <span class="muted">пустые не выводятся</span></p>
  <div class="grid g4">${k}</div>
  ${src?`<div class="row" style="margin-top:12px"><button class="btn ghost" type="button" data-a="coverFrom">Заполнить из позиции «${esc(src.name||'')}»</button></div>`:''}</section>`;
}

function applyCover(h, force){
  const c=S.cover;
  const put=(k,v)=>{ if(v && (force || !c[k])) c[k]=v; };
  put('title',h.title); put('model',h.model); put('desc',h.desc);
  if (Array.isArray(h.kpis) && h.kpis.length && (force || !c.kpis.some(k=>k.num))) c.kpis=[0,1,2,3].map(n=>({num:h.kpis[n]?.num||'',unit:h.kpis[n]?.unit||'',cap:h.kpis[n]?.cap||''}));
}
