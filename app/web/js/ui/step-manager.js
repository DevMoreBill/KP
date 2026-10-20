import { UiKit } from './ui-kit.js';

/** Раздел 6 «Менеджер»: контакты в КП, справочник менеджеров, папка КП. */
export class ManagerStep {
  /**
   * HTML раздела.
   * @returns {string}
   */
  static html() {
    const field = (label, key, opts) => UiKit.field(label, `manager.${key}`, opts);
    const folder = esc(KpFile.folder() || 'Фамилия');
    return `<section class="step" id="st-manager"><h2><span class="n">6</span>Менеджер${UiKit.tip('<p>Выберите себя из списка — контакты подставятся. Справочник менеджеров общий для отдела и хранится в базе программы; это устройство запомнит выбор.</p><p>Правки контактов выбранного менеджера сохраняются в справочнике сами. Нового менеджера сохраните кнопкой «Сохранить в справочник».</p><p>Если вход в программу по паролю — в КП всегда вы сами, выбрать другого менеджера нельзя; свои контакты правьте здесь же.</p>')}</h2>
  ${MgrBar.html()}
  <div class="grid g2">${field('ФИО', 'name', { req: 1 })}${field('Должность', 'position')}
  ${field('Телефон', 'phone', { req: 1 })}${field('Добавочный', 'ext')}${field('Мобильный', 'mobile')}${field('E-mail', 'email', { type: 'email' })}</div>
  <details class="more"><summary>Сайт, адрес, часы работы и папка КП</summary>
    <div class="grid g2" style="padding:10px 0 14px">${field('Сайт', 'site')}${field('Часы работы', 'hours')}</div>
    <div class="grid">${field('Адрес', 'address')}</div>
    <div class="grid" style="padding:12px 0 14px">${field('Папка для КП менеджера', 'folder', { ph: KpFile.folder() || 'Фамилия' })}
      <p class="muted" style="margin:0">КП сохраняются в «Коммерческие предложения / ${folder}». По умолчанию — фамилия из ФИО.</p></div></details></section>`;
  }
}
