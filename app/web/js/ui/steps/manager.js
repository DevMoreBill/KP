// Раздел 6 «Менеджер».
'use strict';

function stepManager(){
  const m='manager.';
  return `<section class="step" id="st-manager"><h2><span class="n">5</span>Контакты менеджера</h2>
  <p class="hint">Запоминаются на этом устройстве — в следующий раз заполнять не придётся.</p>
  <div class="grid g2">${field('ФИО',m+'name',{req:1})}${field('Должность',m+'position')}
  ${field('Телефон',m+'phone',{req:1})}${field('Добавочный',m+'ext')}${field('Мобильный',m+'mobile')}${field('E-mail',m+'email',{type:'email'})}
  ${field('Сайт',m+'site')}${field('Часы работы',m+'hours')}</div>
  <div class="grid" style="margin-top:14px">${field('Адрес',m+'address')}</div>
  <div class="grid g2" style="margin-top:14px">${field('Папка для КП менеджера',m+'folder',{ph:managerFolder()||'Фамилия'})}<div class="muted" style="align-self:end;padding-bottom:10px">КП сохраняются в «Коммерческие предложения / ${esc(managerFolder()||'Фамилия')}». По умолчанию — фамилия из ФИО.</div></div></section>`;
}
