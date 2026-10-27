import { Modal } from '../../core/modal.js';
import { esc } from '../../core/util.js';

/** Окно «Права администратора»: главный или доступ к вкладкам (нет / просмотр / изменение) и отдельные действия. */
export class AdminRightsEditor {
  static LEVELS = [
    ['none', 'нет'],
    ['view', 'просмотр'],
    ['edit', 'изменение'],
  ];
  static ACTION_HINT = {
    delete: 'удалять КП, товары, клиентов, менеджеров, поставщиков; восстанавливать и очищать корзину',
    db: 'заменять и восстанавливать базу, загружать в неё файлы и файл настроек, выгружать базу целиком',
    updates: 'устанавливать и откатывать обновления программы, ночное обновление',
    secrets: 'менять ключи API, адрес вебхука Битрикс24, пароли почты, 1С и Яндекс Диска',
  };

  static _select(attrs, current, label, first = '') {
    const lead = first ? `<option value="" selected>${esc(first)}</option>` : '';
    const options =
      lead +
      this.LEVELS.map(
        ([value, text]) => `<option value="${value}"${value === current ? ' selected' : ''}>${text}</option>`,
      ).join('');
    return `<select ${attrs} aria-label="${esc(label)}">${options}</select>`;
  }

  static _groups(schema, sections) {
    const groups = [...new Set(schema.sections.map(row => row.group))];
    return groups
      .map(group => {
        const rows = schema.sections
          .filter(row => row.group === group)
          .map(
            row =>
              `<div class="ar-row"><span>${esc(row.label)}</span>${this._select(`data-arsec="${esc(row.key)}"`, sections[row.key] || 'none', row.label)}</div>`,
          )
          .join('');
        return `<div class="ar-group"><div class="ar-row ar-gh"><b>${esc(group)}</b>${this._select(`data-argroup="${esc(group)}" title="Сразу всем вкладкам раздела"`, '', `Весь раздел «${group}»`, 'всем вкладкам…')}</div>${rows}</div>`;
      })
      .join('');
  }

  static _actions(schema, actions) {
    return schema.actions
      .map(
        row =>
          `<label class="ar-act"><input type="checkbox" data-aract="${esc(row.key)}"${actions.includes(row.key) ? ' checked' : ''}><span><b>${esc(row.label)}</b><small class="muted">${esc(this.ACTION_HINT[row.key] || '')}</small></span></label>`,
      )
      .join('');
  }

  static _html(user, schema) {
    const rights = user.rights || { sections: {}, actions: [] };
    return `<h3>Права: ${esc(user.name || user.login)}</h3>
      <label class="ar-main"><input type="checkbox" data-armain${user.main ? ' checked' : ''}><span><b>Главный администратор</b><small class="muted">Может всё, в том числе добавлять администраторов и менять их права и пароли.</small></span></label>
      <div class="ar-body"${user.main ? ' hidden' : ''}>
        <div class="row ar-all"><span class="muted">Всем вкладкам:</span>${this.LEVELS.map(([value, text]) => `<button class="btn ghost sm" type="button" data-arall="${value}">${text}</button>`).join('')}</div>
        <p class="muted ar-note">«Просмотр» — раздел виден, но ничего не сохраняется; «нет» — раздела нет в меню. «Главная» и «Мой пароль» доступны всем.</p>
        <div class="ar-groups">${this._groups(schema, rights.sections || {})}</div>
        <p class="sub ar-ah">Отдельные действия — нужны и доступ «изменение» к разделу, и галочка</p>
        ${this._actions(schema, rights.actions || [])}
      </div>
      <div class="row"><button class="btn" type="button" data-arv="0">Отмена</button><span class="sp"></span><button class="btn primary" type="button" data-arv="1">Сохранить</button></div>`;
  }

  /**
   * Открыть окно.
   * @param {{login: string, name?: string, main: boolean, rights?: object}} user
   * @param {{sections: object[], actions: object[]}} schema
   * @returns {Promise<{main: boolean, rights: object}|null>} null — отмена
   */
  static open(user, schema) {
    return new Promise(resolve => {
      let result = null;
      const modal = new Modal(this._html(user, schema), 'ar-dlg');
      const box = modal.d;
      box.addEventListener('change', event => this._change(box, event.target));
      box.addEventListener('click', event => {
        const all = event.target.closest('[data-arall]');
        if (all) box.querySelectorAll('[data-arsec]').forEach(select => (select.value = all.dataset.arall));
        const choice = event.target.closest('[data-arv]');
        if (!choice) return;
        if (choice.dataset.arv === '1') result = this._read(box);
        modal.close();
      });
      box.addEventListener('close', () => resolve(result));
    });
  }

  static _change(box, target) {
    if (target.matches('[data-armain]')) box.querySelector('.ar-body').hidden = target.checked;
    if (!target.matches('[data-argroup]') || !target.value) return;
    target
      .closest('.ar-group')
      .querySelectorAll('[data-arsec]')
      .forEach(select => (select.value = target.value));
    target.value = ''; // заголовок группы — снова «всем вкладкам…»: у вкладок могут быть разные уровни
  }

  static _read(box) {
    const sections = {};
    box.querySelectorAll('[data-arsec]').forEach(select => {
      if (select.value !== 'none') sections[select.dataset.arsec] = select.value;
    });
    const actions = [...box.querySelectorAll('[data-aract]:checked')].map(input => input.dataset.aract);
    return { main: box.querySelector('[data-armain]').checked, rights: { sections, actions } };
  }

  /**
   * Коротко о правах — строкой в списке администраторов.
   * @param {{main: boolean, rights?: object}} user
   * @param {{sections: object[], actions: object[]}} schema
   * @returns {string}
   */
  static summary(user, schema) {
    if (user.main) return 'главный — может всё';
    const sections = (user.rights && user.rights.sections) || {};
    const edit = Object.values(sections).filter(level => level === 'edit').length;
    const view = Object.values(sections).filter(level => level === 'view').length;
    const actions = (user.rights && user.rights.actions) || [];
    const names = schema.actions.filter(row => actions.includes(row.key)).map(row => row.label.split(':')[0]);
    if (!edit && !view) return 'нет доступа ни к одному разделу — только «Главная» и свой пароль';
    return `изменение — ${edit}, просмотр — ${view} из ${schema.sections.length} вкладок${names.length ? `; ${names.join(', ').toLowerCase()}` : ''}`;
  }
}
