// Раздел 6 «Менеджер».
'use strict';

function stepManager(){
  const m='manager.';
  return `<section class="step" id="st-manager"><h2><span class="n">6</span>Менеджер${tip('<p>Выберите себя из списка — контакты подставятся. Справочник менеджеров общий для отдела и хранится в базе программы; это устройство запомнит выбор.</p><p>Правки контактов выбранного менеджера сохраняются в справочнике сами. Нового менеджера сохраните кнопкой «Сохранить в справочник».</p><p>Если вход в программу по паролю — в КП всегда вы сами, выбрать другого менеджера нельзя; свои контакты правьте здесь же.</p>')}</h2>
  ${MgrBar.html()}
  <div class="grid g2">${field('ФИО',m+'name',{req:1})}${field('Должность',m+'position')}
  ${field('Телефон',m+'phone',{req:1})}${field('Добавочный',m+'ext')}${field('Мобильный',m+'mobile')}${field('E-mail',m+'email',{type:'email'})}</div>
  <details class="more"><summary>Сайт, адрес, часы работы и папка КП</summary>
    <div class="grid g2" style="padding:10px 0 14px">${field('Сайт',m+'site')}${field('Часы работы',m+'hours')}</div>
    <div class="grid">${field('Адрес',m+'address')}</div>
    <div class="grid" style="padding:12px 0 14px">${field('Папка для КП менеджера',m+'folder',{ph:managerFolder()||'Фамилия'})}
      <p class="muted" style="margin:0">КП сохраняются в «Коммерческие предложения / ${esc(managerFolder()||'Фамилия')}». По умолчанию — фамилия из ФИО.</p></div></details></section>`;
}
