// Раздел 4 «Титульный лист».
'use strict';

function stepCover(){
  const c=S.cover, n=stationsOf().length, multi=n>=2;
  const kp = c.kpis.map((_,j)=>`<div class="kprow"><span class="item-no">${j+1}</span>${field('Значение',`cover.kpis.${j}.num`,{ph:['32','40','230/400','9,3'][j]})}${field('Ед.',`cover.kpis.${j}.unit`,{ph:['кВт','кВт','В','л/ч'][j]})}${field('Подпись',`cover.kpis.${j}.cap`,{ph:['номинальная мощность','максимальная','три фазы, 50 Гц','расход топлива'][j]})}</div>`).join('');
  const src = S.items.find(x=>x.hint);
  const withPhoto=S.items.filter(x=>x.photo);
  const cur=S.items.find(x=>x.id===S.cover.photoFrom && x.photo) || withPhoto[0];
  const ci = cur ? S.items.indexOf(cur) : S.items.length ? 0 : -1;
  const photoCtl = multi ? '' : withPhoto.length>1
    ? `<label class="f"><span>Фото на титуле</span><select data-cvphoto>${withPhoto.map(x=>`<option value="${esc(x.id)}"${x===cur?' selected':''}>${esc(x.name||'Позиция')}</option>`).join('')}</select></label>`
    : withPhoto.length ? '' : `<p class="muted" style="margin:0">У позиций нет фото — титул будет без фотографии.</p>`;
  const help = multi
    ? `<p>В КП ${n} ${plural(n,'модель','модели','моделей')}: на титуле будет блок «Оборудование в предложении» с фото, мощностью, исполнением и количеством каждой модели. Заголовок и описание подставятся сами; заполните поля, чтобы задать свои. Ключевые параметры в этом режиме не выводятся.</p><p>Фото модели — первое фото позиции; поменять — в карточке позиции.</p>`
    : `<p>Поля заполняются из каталога при выборе оборудования — проверьте и поправьте при необходимости.</p><p>Щелчок по превью — предпросмотр всего КП.</p>`;
  return `<section class="step" id="st-cover"><h2><span class="n">4</span>Титульный лист${tip(help)}</h2>
  ${templatePicker()}
  <div class="cvtop"><div class="cvthumb" id="cvThumb" data-a="kpPreview" title="Предпросмотр всего КП"></div><div class="cvinfo">
    ${field('Тип оборудования','cover.title',{ph:'Дизель-генераторные установки'})}${field('Модель / серия','cover.model',{req:!multi,ph:'HERTZ HG 45 CH'})}
    ${field('Описание под заголовком','cover.desc',{area:1,rows:3,ph:'Установки в кожухе номинальной мощностью …'})}
    ${photoCtl}
    <div class="row">${ci>=0&&!multi?`<button class="btn ghost" type="button" data-a="edit" data-i="${ci}" data-tab="desc">${cur?'Заменить фото':'Добавить фото'}</button>`:''}<button class="btn" type="button" data-a="kpPreview">Предпросмотр КП</button></div></div></div>
  ${multi?'':`<details class="more"${c.kpis.some(k=>k.num)?'':' open'}><summary>Ключевые параметры на титуле <span class="muted">${c.kpis.filter(k=>k.num).length} из 4</span></summary>
    <div class="kpgrid">${kp}</div>
    ${src?`<button class="btn ghost" type="button" data-a="coverFrom">Заполнить из позиции «${esc(src.name||'')}»</button>`:''}</details>`}
  </section>`;
}

function applyCover(h, force){
  if (CATED) return;   // правка позиции каталога не трогает титул текущего КП
  const c=S.cover;
  const put=(k,v)=>{ if(v && (force || !c[k])) c[k]=v; };
  put('title',h.title); put('model',h.model); put('desc',h.desc);
  if (Array.isArray(h.kpis) && h.kpis.length && (force || !c.kpis.some(k=>k.num))) c.kpis=[0,1,2,3].map(n=>({num:h.kpis[n]?.num||'',unit:h.kpis[n]?.unit||'',cap:h.kpis[n]?.cap||''}));
}
