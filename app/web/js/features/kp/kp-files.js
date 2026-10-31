import { ShortName } from './journal-row.js';
import { Toast } from '../../core/toast.js';
import { Modal } from '../../core/modal.js';
import { Fmt } from '../../core/str.js';
import { esc } from '../../core/util.js';
import { S } from '../../core/state.js';
import { Api } from '../../core/net.js';
import { DefRegistry } from '../../core/defaults.js';
import { FEAT } from '../../core/features.js';
import { UiKit } from '../../core/ui-kit.js';
import { KpForm } from '../../core/kp-form.js';
import { KpDate } from '../../core/kp-date.js';
import { AdminDialog } from '../../core/admin-dialog.js';

/**
 * Справочные документы к КП (сервер: app/kp_files.py): паспорта, сертификаты, схемы, опросные листы — хранятся вместе
 * с КП и в документ КП не входят. Добавить — кнопкой, перетаскиванием или вставкой (Ctrl+V); удаляет администратор,
 * свой файл в первые минуты после загрузки — автор.
 */
export class KpFilesPanel {
  static EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'dwg', 'dxf', 'zip', 'txt'];
  static ACCEPT = KpFilesPanel.EXTS.map(ext => `.${ext}`).join(',');
  static ABOUT = 'Файлы хранятся вместе с КП и в документ КП не входят: паспорта, сертификаты, схемы, опросные листы.';
  static MINUTE = 60000;
  static BYTES_IN_MB = 1048576;
  /** номер КП → {items, limits} | null — загружается */
  static data = new Map();
  /** открытые окна документов: {kid, draw} */
  static wins = new Set();
  /** поле документов под курсором — для Ctrl+V */
  static hover = null;

  /**
   * Функция включена.
   * @returns {boolean}
   */
  static enabled() {
    return FEAT.on('kpFiles');
  }

  /**
   * Адрес документов КП (или одного документа).
   * @param {string} kid
   * @param {number} [fid]
   * @returns {string}
   */
  static url(kid, fid) {
    return `/api/kp/${encodeURIComponent(kid)}/files${fid != null ? `/${encodeURIComponent(fid)}` : ''}`;
  }

  /**
   * Загруженные документы КП.
   * @param {string} kid
   * @returns {object[]}
   */
  static items(kid) {
    return (this.data.get(kid) || {}).items || [];
  }

  /**
   * Сколько документов у КП.
   * @param {string} kid
   * @returns {number}
   */
  static count(kid) {
    return this.items(kid).length;
  }

  /**
   * Предел файла, МБ.
   * @param {string} kid
   * @returns {number}
   */
  static maxMB(kid) {
    return ((this.data.get(kid) || {}).limits || {}).fileMB || DefRegistry.num('kp.fileMB', 25);
  }

  /**
   * Загрузить список документов КП.
   * @param {string} kid
   * @returns {Promise<object>}
   */
  static async load(kid) {
    if (!this.data.get(kid)) this.data.set(kid, null);
    try {
      this.data.set(kid, await Api.request(this.url(kid)));
    } catch (error) {
      this.data.set(kid, { items: [], limits: {}, err: error.message });
    }
    this.refresh(kid);
    return this.data.get(kid);
  }

  /**
   * Перерисовать места, где показаны документы этого КП.
   * @param {string} kid
   */
  static refresh(kid) {
    if (S.kpId === kid && KpForm.step() === 'conds') KpForm.render();
    for (const win of this.wins) if (win.kid === kid) win.draw();
  }

  /**
   * Заголовок блока с «?».
   * @returns {string}
   */
  static head() {
    return `<h3 class="kf-h"><span aria-hidden="true">📎</span> Справочные документы${UiKit.tip(`<p>${this.ABOUT}</p><p>Прикрепить — кнопкой, перетаскиванием файлов в рамку или вставкой: выделите рамку и нажмите Ctrl+V (скопированный файл или снимок экрана).</p><p>Отправить клиенту — в окне письма галочками. Удалить ошибочный файл может администратор («Настройки → Сохранённые КП»).</p>`)}</h3>`;
  }

  /**
   * Блок в разделе «Условия»: КП ещё не сохранено — подсказка, иначе — список и добавление.
   * @returns {string}
   */
  static stepHtml() {
    if (!this.enabled()) return '';
    if (!S.kpId) {
      return `<div class="kf-step">${this.head()}<p class="muted kf-wait">Сохраните КП, затем прикрепите документы. ${this.ABOUT}</p></div>`;
    }
    if (!this.data.has(S.kpId)) this.load(S.kpId);
    return `<div class="kf-step" data-id="kf-step">${this.head()}${this.box(S.kpId)}</div>`;
  }

  /**
   * Рамка документов.
   * @param {string} kid
   * @param {{admin?: boolean}} [view] admin — с кнопкой «Удалить» (окно из «Настроек»)
   * @returns {string}
   */
  static box(kid, view = {}) {
    const key = esc(kid);
    const list = this._list(kid, view);
    return `<div class="kf-box" data-kfdrop="${key}" tabindex="0" aria-label="Справочные документы КП: перетащите файлы или нажмите Ctrl+V">
      ${list ? `<div class="kf-l">${list}</div>` : ''}
      <div class="kf-add"><button class="btn sm" type="button" data-kfadd="${key}">＋ Прикрепить файл</button><button class="btn sm ghost kf-clip" type="button" data-kfclip="${key}" title="Скопированный снимок экрана или картинка; файл из проводника — Ctrl+V в этой рамке">Из буфера</button>
        <span class="muted kf-hint"><span class="kf-drag">или перетащите сюда · </span>PDF, Word, Excel, JPG, PNG, DWG, DXF, ZIP, TXT до ${esc(String(this.maxMB(kid)))} МБ</span></div></div>`;
  }

  static _list(kid, view) {
    const data = this.data.get(kid);
    if (data == null) return '<p class="muted kf-load">Загружаю…</p>';
    if (data.err) return `<p class="msg err">${esc(data.err)}</p>`;
    return data.items.map(file => this.row(kid, file, view)).join('');
  }

  /**
   * Строка документа.
   * @param {string} kid
   * @param {object} file
   * @param {{admin?: boolean}} view
   * @returns {string}
   */
  static row(kid, file, view) {
    const href = this.url(kid, file.id);
    const ext = String(file.ext || '').replace(/[^a-z]/g, '');
    const drop = view.admin || this.ownLeft(file) ? this.delButton(kid, file, view) : '';
    return `<div class="kf-r" data-id="kf-${esc(String(file.id))}"><span class="kf-ext kf-${ext}" aria-hidden="true">${esc(ext.toUpperCase() || '?')}</span>
      <div class="kf-m"><a class="kf-n" href="${href}" download title="Скачать «${esc(file.name)}»">${esc(file.name)}</a>
        <span class="muted">${Fmt.size(file.size)} · ${esc(KpDate.ddmm(file.added))}${file.by ? ` · ${esc(ShortName.of(file.by))}` : ''}</span>
        <input type="text" class="kf-note" data-kfnote="${esc(String(file.id))}" data-kid="${esc(kid)}" value="${esc(file.note || '')}" maxlength="300" placeholder="Примечание: что это за документ" aria-label="Примечание к файлу ${esc(file.name)}" autocomplete="off"></div>
      <div class="acts"><a class="btn sm kf-dl" href="${href}" download aria-label="Скачать «${esc(file.name)}»"><span aria-hidden="true">⬇</span><span class="kf-dlt"> Скачать</span></a>${drop}</div></div>`;
  }

  /**
   * Сколько минут автор ещё может удалить свой документ (сервер присылает undoUntil только автору), 0 — нельзя.
   * @param {object} file
   * @returns {number}
   */
  static ownLeft(file) {
    return file.undoUntil ? Math.max(0, Math.ceil((Date.parse(file.undoUntil) - Date.now()) / this.MINUTE)) : 0;
  }

  /**
   * Кнопка «Удалить».
   * @param {string} kid
   * @param {object} file
   * @param {{admin?: boolean}} view
   * @returns {string}
   */
  static delButton(kid, file, view) {
    const own = !view.admin;
    const left = own ? this.ownLeft(file) : 0;
    return `<button class="btn sm danger" type="button" data-kfdel="${esc(String(file.id))}" data-kid="${esc(kid)}"${own ? ' data-kfown="1"' : ''}
      title="${own ? `Свой файл, прикреплённый по ошибке, можно удалить ещё ${left} мин` : 'Удалить документ'}">Удалить</button>`;
  }

  /**
   * Окно документов КП (журнал, «КП сохранено», «Настройки»).
   * @param {string} kid
   * @param {string} [number]
   * @param {{admin?: boolean, onClose?: Function}} [view] onClose(число документов)
   */
  static open(kid, number, view = {}) {
    const modal = new Modal(
      `<div class="dlg-h"><h3><span aria-hidden="true">📎</span> Справочные документы · КП № ${esc(number || kid)}</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted kf-about">${esc(this.ABOUT)}</p><div class="kf-host"></div>
      <div class="dlg-acts"><button class="btn" type="button" data-x>Готово</button></div>`,
      'kf-dlg',
    );
    const win = {
      kid,
      draw: () => {
        const host = modal.$('.kf-host');
        if (host) host.innerHTML = this.box(kid, view);
      },
    };
    this.wins.add(win);
    modal.d.addEventListener('close', () => {
      this.wins.delete(win);
      if (view.onClose) view.onClose(this.count(kid));
    });
    modal.d.addEventListener('click', event => {
      if (event.target.closest('[data-x]')) modal.close();
    });
    win.draw();
    this.load(kid);
  }

  /**
   * Выбрать файлы на компьютере.
   * @param {string} kid
   */
  static pick(kid) {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = this.ACCEPT;
    input.hidden = true;
    document.body.appendChild(input);
    input.onchange = () => {
      const files = [...input.files];
      input.remove();
      if (files.length) this.upload(kid, files);
    };
    input.addEventListener('cancel', () => input.remove());
    input.click();
  }

  /**
   * Имя файла для сервера: снимок экрана из буфера («image.png») — «Снимок ДД.ММ.ГГГГ ЧЧ-ММ-СС.png».
   * @param {File} file
   * @returns {string}
   */
  static nameOf(file) {
    const name = String(file.name || '').trim();
    if (name && !/^image\.(png|jpe?g)$/i.test(name)) return name;
    const now = new Date();
    const two = value => String(value).padStart(2, '0');
    const ext = /jpe?g/.test(file.type || name) ? 'jpg' : 'png';
    return `Снимок ${two(now.getDate())}.${two(now.getMonth() + 1)}.${now.getFullYear()} ${two(now.getHours())}-${two(now.getMinutes())}-${two(now.getSeconds())}.${ext}`;
  }

  /**
   * Почему файл не прикрепить ('' — можно).
   * @param {string} name
   * @param {File} file
   * @param {number} max предел файла, МБ
   * @returns {string}
   */
  static problem(name, file, max) {
    const ext = (name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
    if (!this.EXTS.includes(ext)) {
      return `«${name}» — такой файл не прикрепить (можно PDF, Word, Excel, JPG, PNG, DWG, DXF, ZIP, TXT)`;
    }
    if (file.size > max * this.BYTES_IN_MB) return `«${name}» — ${Fmt.size(file.size)}, можно до ${max} МБ`;
    if (!file.size) return `«${name}» — пустой файл`;
    return '';
  }

  /**
   * Прикрепить файлы к КП.
   * @param {string} kid
   * @param {File[]} files
   */
  static async upload(kid, files) {
    if (!this.data.get(kid)) await this.load(kid);
    const max = this.maxMB(kid);
    const bad = [];
    let done = 0;
    for (const [i, file] of files.entries()) {
      const name = this.nameOf(file);
      const why = this.problem(name, file, max);
      if (why) {
        bad.push(why);
        continue;
      }
      Toast.show(files.length > 1 ? `Прикрепляю ${i + 1} из ${files.length}: ${name}` : `Прикрепляю «${name}»…`);
      try {
        await Api.request(`${this.url(kid)}?name=${encodeURIComponent(name)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: file,
        });
        done++;
      } catch (error) {
        bad.push(error.message);
      }
    }
    await this.load(kid);
    if (bad.length) Toast.show(`${done ? `Прикреплено: ${done}. ` : ''}Не прикреплено: ${bad.join('; ')}`);
    else if (done) Toast.show(done > 1 ? `Прикреплено документов: ${done}` : 'Документ прикреплён к КП');
  }

  /**
   * «Из буфера»: снимок экрана или картинка читаются сразу; файл из проводника браузер отдаёт только по Ctrl+V.
   * @param {string} kid
   */
  static async clip(kid) {
    const images = await this._clipboardImages();
    if (images.length) {
      this.upload(kid, images);
      return;
    }
    const zone = [...document.querySelectorAll('[data-kfdrop]')].find(box => box.dataset.kfdrop === kid);
    if (zone) zone.focus();
    Toast.show('Нажмите Ctrl+V — скопированные файлы или снимок экрана прикрепятся к КП');
  }

  static async _clipboardImages() {
    if (!navigator.clipboard || !navigator.clipboard.read) return [];
    const out = [];
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find(kind => kind === 'image/png' || kind === 'image/jpeg');
        if (type) {
          out.push(new File([await item.getType(type)], type === 'image/png' ? 'image.png' : 'image.jpg', { type }));
        }
      }
    } catch {
      return []; // нет доступа к буферу — дальше подсказка про Ctrl+V
    }
    return out;
  }

  /**
   * Сохранить примечание к документу.
   * @param {HTMLInputElement} input
   */
  static async note(input) {
    const kid = input.dataset.kid;
    const fid = +input.dataset.kfnote;
    const file = this.items(kid).find(row => row.id === fid);
    const value = input.value.trim();
    if (!file || value === (file.note || '')) return;
    try {
      const answer = await Api.request(this.url(kid, fid), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ note: value }),
      });
      file.note = answer.note;
      Toast.show('Примечание сохранено');
    } catch (error) {
      Toast.show(`Примечание не сохранено: ${error.message}`);
    }
  }

  /**
   * Удаление администратором («Настройки»), с подтверждением.
   * @param {string} kid
   * @param {number} fid
   */
  static remove(kid, fid) {
    return this._remove(kid, fid, `/api/admin/kpfiles/${encodeURIComponent(kid)}/${encodeURIComponent(fid)}/delete`);
  }

  /**
   * Удаление автором своего свежего файла, с подтверждением.
   * @param {string} kid
   * @param {number} fid
   */
  static removeOwn(kid, fid) {
    return this._remove(kid, fid, `${this.url(kid, fid)}/remove`);
  }

  static async _remove(kid, fid, url) {
    const file = this.items(kid).find(row => row.id === fid);
    if (!file) return;
    const sure = await AdminDialog.confirm(
      'Удалить документ?',
      `«${file.name}» удалится с сервера безвозвратно — у КП № ${kid} его больше не будет.`,
      'Удалить',
    );
    if (!sure) return;
    try {
      await Api.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: '{}',
      });
      Toast.show('Документ удалён');
    } catch (error) {
      Toast.show(`Не удалено: ${error.message}`);
    }
    this.load(kid);
  }

  static _zone(el) {
    return el && el.closest ? el.closest('[data-kfdrop]') : null;
  }

  /** Кнопки, примечания, перетаскивание и вставка файлов. */
  static listen() {
    document.addEventListener('click', event => this._click(event.target));
    document.addEventListener('change', event => {
      const note = event.target.closest && event.target.closest('[data-kfnote]');
      if (note) this.note(note);
    });
    document.addEventListener('keydown', event => {
      const note = event.target.closest && event.target.closest('[data-kfnote]');
      if (note && event.key === 'Enter') {
        event.preventDefault();
        note.blur();
      }
    });
    document.addEventListener('pointerover', event => {
      this.hover = this._zone(event.target);
    });
    ['dragover', 'dragleave', 'drop'].forEach(kind =>
      document.addEventListener(kind, event => this._drag(kind, event)),
    );
    document.addEventListener('paste', event => this._paste(event));
  }

  static _click(target) {
    const add = target.closest('[data-kfadd]');
    if (add) {
      this.pick(add.dataset.kfadd);
      return;
    }
    const clip = target.closest('[data-kfclip]');
    if (clip) {
      this.clip(clip.dataset.kfclip);
      return;
    }
    const drop = target.closest('[data-kfdel]');
    if (!drop) return;
    if (drop.dataset.kfown) this.removeOwn(drop.dataset.kid, +drop.dataset.kfdel);
    else this.remove(drop.dataset.kid, +drop.dataset.kfdel);
  }

  static _drag(kind, event) {
    const zone = this._zone(event.target);
    if (!zone) return;
    event.preventDefault();
    zone.classList.toggle('over', kind === 'dragover');
    if (kind !== 'drop') return;
    const files = [...((event.dataTransfer && event.dataTransfer.files) || [])];
    if (files.length) this.upload(zone.dataset.kfdrop, files);
    else Toast.show('Перетащите файл с компьютера (из проводника или с рабочего стола)');
  }

  static _paste(event) {
    const active = document.activeElement;
    const zone = this._zone(active) || (this.hover && this.hover.isConnected ? this.hover : null);
    if (!zone) return;
    if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return; // в примечание вставляется текст
    const files = [...((event.clipboardData && event.clipboardData.files) || [])];
    if (!files.length) return;
    event.preventDefault();
    this.upload(zone.dataset.kfdrop, files);
  }
}
