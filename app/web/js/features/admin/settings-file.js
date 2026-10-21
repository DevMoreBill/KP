import { AdminApi, AdminDialog } from './admin-core.js';
import { BackupTab } from './backup-tab.js';
import { DataTransfer } from './data-transfer.js';
import { SettingsWindow } from './settings-window.js';
import { StRefresh } from './settings-tools.js';
import { EquipTypes } from '../../core/equip-types.js';
import { Toast } from '../../core/toast.js';
import { Fmt } from '../../core/str.js';
import { esc } from '../../core/util.js';

/** Все настройки программы в файл и обратно (сервер — data_bundle.SettingsFile): ключи API — по галочке, пароли — никогда. */
export class SettingsFileCard {
  static file = null;
  static JSON_FILE = /\.json$/i;

  /**
   * Карточка во вкладке «Файл, изменения, откат».
   * @param {HTMLElement} main
   */
  static render(main) {
    main.innerHTML = `<div class="st-card sf"><p class="sub">Все настройки — в файл и из файла</p>
      <p class="muted">Значения программы, списки, тексты, функции, категории, тарифы доставки, ставки из Китая, нормы станций, фиды, почта (без пароля), права менеджеров, личные настройки — одним файлом: перенести на другой компьютер или сохранить перед большими правками. Пароли в файл не попадают никогда.</p>
      ${BackupTab.row('Сохранить', 'Файл КП_настройки_… в любом формате общего списка (как в «База и копии → Выгрузить»). С ключами API — только если отметить: такой файл храните как пароль.', `<label class="cx-ck"><input type="checkbox" id="sfKeys"> с ключами API</label><select id="bkFmt" aria-label="Формат" data-nodirty>${BackupTab.fmtOpts()}</select><button class="btn primary" type="button" data-sf="save">Сохранить все настройки в файл</button>`)}
      ${BackupTab.row('Загрузить', 'Сначала покажем разделы файла — отметьте, какие заменить. Свои ключи и пароль почты остаются, если в файле их нет.', '<input type="file" id="sfFile" accept=".xlsx,.json,.xml,.yml,.zip" class="sr-file"><label for="sfFile" class="btn">Загрузить настройки из файла…</label>')}
      <div id="sfPrev"></div></div>`;
    main.querySelector('#sfKeys').onchange = async event => {
      if (!event.target.checked) return;
      const sure = await AdminDialog.confirm(
        'Сохранить вместе с ключами API?',
        'В файл попадут ключи сервисов (проверка контрагентов, перевозчики, PDF, нейросеть, GitHub). Храните его как пароль и не пересылайте по почте и в мессенджерах. Пароли в файл не попадают.',
        'Да, с ключами',
      );
      if (!sure) event.target.checked = false;
    };
    main.onclick = async event => {
      if (event.target.closest('[data-sf="save"]')) {
        const keys = main.querySelector('#sfKeys').checked ? { keys: '1' } : {};
        await DataTransfer.download(
          `settings-file?${new URLSearchParams({ fmt: BackupTab.fmtOf(main), ...keys })}`,
          null,
        );
        return;
      }
      const apply = event.target.closest('[data-sfapply]');
      if (apply) this.apply(main, apply);
    };
    main.querySelector('#sfFile').onchange = event => {
      const file = event.target.files[0];
      event.target.value = '';
      if (file) this.preview(main, file);
    };
  }

  static _type(file) {
    return this.JSON_FILE.test(file.name) ? 'application/json; charset=utf-8' : 'application/octet-stream';
  }

  /**
   * Разделы файла: что отличается от текущих настроек.
   * @param {HTMLElement} main
   * @param {File} file
   */
  static async preview(main, file) {
    const box = main.querySelector('#sfPrev');
    box.innerHTML = `<p class="muted">Проверяю «${esc(file.name)}»…</p>`;
    try {
      const reply = await AdminApi.get('settings-file/preview', {
        method: 'POST',
        headers: { 'Content-Type': this._type(file) },
        body: file,
      });
      this.file = file;
      const rows = reply.sections
        .map(
          section =>
            `<label class="sf-r"><input type="checkbox" data-sfk="${esc(section.key)}"${section.same ? '' : ' checked'}><span>${esc(section.label)}</span><small class="${section.same ? 'muted' : 'warn-t'}">${section.same ? 'как сейчас' : 'отличается'}</small></label>`,
        )
        .join('');
      box.innerHTML = `<p class="muted">Файл от ${esc(Fmt.dateTime(reply.createdAt))}${reply.app ? `, версия программы ${esc(reply.app)}` : ''}${reply.keys ? ' · <b class="warn-t">с ключами API</b>' : ''}. Отметьте, что заменить:</p>
        <div class="sf-list">${rows}</div>
        <div class="row"><button class="btn primary" type="button" data-sfapply>Загрузить отмеченное</button><span class="muted">Каждое изменение попадёт в «Историю» — его можно вернуть.</span></div>`;
    } catch (error) {
      this.file = null;
      box.innerHTML = `<p class="msg err" style="text-align:left">${esc(error.message || error)}</p>`;
    }
  }

  /**
   * Заменить отмеченные разделы.
   * @param {HTMLElement} main
   * @param {HTMLButtonElement} button
   */
  static async apply(main, button) {
    const file = this.file;
    const keys = [...main.querySelectorAll('[data-sfk]:checked')].map(input => input.dataset.sfk);
    if (!file) return;
    if (!keys.length) {
      Toast.show('Отметьте разделы');
      return;
    }
    if (
      !(await AdminDialog.confirm(
        `Заменить настройки (${keys.length})?`,
        'Отмеченные разделы станут как в файле. Прежние значения — в «Истории изменений», их можно вернуть.',
        'Заменить',
      ))
    )
      return;
    button.disabled = true;
    try {
      const reply = await AdminApi.get(`settings-file?sections=${encodeURIComponent(keys.join(','))}`, {
        method: 'POST',
        headers: { 'Content-Type': this._type(file) },
        body: file,
      });
      this.file = null;
      Toast.show(
        `Загружено разделов: ${reply.applied.length}${reply.errors.length ? `; не загружено: ${reply.errors.join('; ')}` : ''}`,
      );
      await StRefresh.all();
      await EquipTypes.load();
      SettingsWindow.tab();
    } catch (error) {
      button.disabled = false;
      Toast.show(`Не загружено: ${error.message || error}`);
    }
  }
}
