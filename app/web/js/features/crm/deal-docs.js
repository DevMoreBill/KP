import { KpDate } from '../kp/kp-date.js';
import { KpFilesPanel } from '../kp/kp-files.js';
import { ShortName } from '../kp/journal-row.js';
import { AdminDialog } from '../admin/admin-core.js';
import { Api, AdminSession } from '../../core/net.js';
import { Fmt } from '../../core/str.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';
import { FEAT } from '../../core/features.js';

/**
 * «Документы» в карточке сделки: договор, спецификация, счёт, акт, УПД, сканы — вид документа чипом, файл кнопкой,
 * перетаскиванием или Ctrl+V. После поставки или выигрыша без акта и УПД раздел раскрыт и подсвечен.
 */
export class DealDocs {
  static ORDER = ['contract', 'spec', 'invoice', 'act', 'upd', 'other'];
  static CLOSING = ['act', 'upd'];
  static kind = '';

  /**
   * Раздел карточки.
   * @param {object} deal ответ /api/crm/deal
   * @returns {string}
   */
  /**
   * Содержимое вкладки «Документы».
   * @param {object} deal
   * @returns {string}
   */
  static body(deal) {
    return this._body(deal);
  }

  /**
   * Вкладка «Документы» для карточки сделки (функция выключена — нет).
   * @param {object} deal
   * @returns {object} {docs: {title, badge, tone, body}} или {}
   */
  static panel(deal) {
    if (!FEAT.on('dealDocs')) return {};
    return { docs: { title: 'Документы', ...this.badge(deal), body: () => this.body(deal) } };
  }

  /**
   * Сколько документов (для вкладки) и тон: пора закрывающие, а их нет — «warn».
   * @param {object} deal
   * @returns {{badge: string, tone: string}}
   */
  static badge(deal) {
    if (deal.closingDue) return { badge: '!', tone: 'warn' };
    const count = (deal.files || []).length;
    return { badge: count ? String(count) : '', tone: '' };
  }

  static _body(deal) {
    const kind = this._current(deal);
    const names = deal.fileKinds || {};
    const chips = this.ORDER.map(
      key =>
        `<button type="button" role="radio" aria-checked="${key === kind}" class="chip sm${key === kind ? ' on' : ''}" data-ddkind="${key}">${esc(names[key] || key)}</button>`,
    ).join('');
    const rows = (deal.files || []).map(file => this._row(deal, file)).join('');
    const list = rows
      ? `<div class="kf-l">${rows}</div>`
      : '<p class="muted dd-none">Документов по сделке пока нет.</p>';
    return `<div class="dd-box" data-dddrop tabindex="0" aria-label="Документы сделки: перетащите файлы или нажмите Ctrl+V">
      <div class="dd-top"><span class="dd-q">Что прикрепляете</span><div class="dd-k" role="radiogroup" aria-label="Что прикрепляете">${chips}</div></div>
      <button class="dd-drop" type="button" data-ddpick><span class="dd-dt">📎 Прикрепить файл</span><span class="muted">или перетащите сюда · Ctrl+V — снимок или скан</span></button>
      ${list}</div>`;
  }

  // вид по умолчанию: пора закрывать — УПД, договора нет — договор
  static _current(deal) {
    if (this.kind) return this.kind;
    if (deal.closingDue) return 'upd';
    return (deal.files || []).some(file => file.kind === 'contract') ? 'other' : 'contract';
  }

  static _row(deal, file) {
    const href = this.url(deal.id, file.id);
    const ext = String(file.ext || '').replace(/[^a-z]/g, '');
    const kind = (deal.fileKinds || {})[file.kind] || '';
    const drop =
      KpFilesPanel.ownLeft(file) || AdminSession.csrf
        ? `<button class="btn sm danger" type="button" data-dddel="${esc(String(file.id))}"${KpFilesPanel.ownLeft(file) ? ' data-ddown="1"' : ''}>Удалить</button>`
        : '';
    return `<div class="kf-r"><span class="kf-ext kf-${ext}" aria-hidden="true">${esc(ext.toUpperCase() || '?')}</span>
      <div class="kf-m"><a class="kf-n" href="${href}" download title="Скачать «${esc(file.name)}»">${esc(file.name)}</a>
        <span class="muted"><b class="dd-kind">${esc(kind)}</b> · ${Fmt.size(file.size)} · ${esc(KpDate.ddmm(file.added))}${file.by ? ` · ${esc(ShortName.of(file.by))}` : ''}</span></div>
      <div class="acts"><a class="btn sm kf-dl" href="${href}" download aria-label="Скачать «${esc(file.name)}»"><span aria-hidden="true">⬇</span><span class="kf-dlt"> Скачать</span></a>${drop}</div></div>`;
  }

  /**
   * Адрес документов сделки (или одного документа).
   * @param {string} did
   * @param {number} [fid]
   * @returns {string}
   */
  static url(did, fid) {
    return `/api/crm/deal/${encodeURIComponent(did)}/files${fid != null ? `/${encodeURIComponent(fid)}` : ''}`;
  }

  /**
   * Щелчки, перетаскивание и вставка файлов в окне сделки.
   * @param {HTMLElement} dialog
   * @param {() => object} current открытая сделка
   * @param {(task: () => Promise<object|null>) => void} apply сохранить по очереди с прочими правками карточки
   */
  static bind(dialog, current, apply) {
    const send = files => apply(() => this.upload(current(), files));
    dialog.addEventListener('click', event => {
      const chip = event.target.closest('[data-ddkind]');
      const drop = event.target.closest('[data-dddel]');
      if (chip) this._pickKind(chip);
      else if (event.target.closest('[data-ddpick]')) this.pick(send);
      else if (drop) apply(() => this.remove(current(), +drop.dataset.dddel, !!drop.dataset.ddown));
    });
    ['dragover', 'dragleave', 'drop'].forEach(kind =>
      dialog.addEventListener(kind, event => this._drag(kind, event, send)),
    );
    dialog.addEventListener('paste', event => this._paste(event, send));
  }

  static _pickKind(chip) {
    this.kind = chip.dataset.ddkind;
    chip.parentElement.querySelectorAll('[data-ddkind]').forEach(one => {
      const active = one === chip;
      one.classList.toggle('on', active);
      one.setAttribute('aria-checked', String(active));
    });
  }

  /**
   * Выбрать файлы на компьютере.
   * @param {(files: File[]) => void} done
   */
  static pick(done) {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = KpFilesPanel.ACCEPT;
    input.hidden = true;
    document.body.appendChild(input);
    input.onchange = () => {
      const files = [...input.files];
      input.remove();
      if (files.length) done(files);
    };
    input.addEventListener('cancel', () => input.remove());
    input.click();
  }

  static _drag(kind, event, done) {
    const zone = event.target.closest && event.target.closest('[data-dddrop]');
    if (!zone) return;
    event.preventDefault();
    zone.classList.toggle('over', kind === 'dragover');
    if (kind !== 'drop') return;
    const files = [...((event.dataTransfer && event.dataTransfer.files) || [])];
    if (files.length) done(files);
    else Toast.show('Перетащите файл с компьютера (из проводника или с рабочего стола)');
  }

  static _paste(event, done) {
    const active = document.activeElement;
    if (!active || !active.closest || !active.closest('[data-dddrop]')) return;
    const files = [...((event.clipboardData && event.clipboardData.files) || [])];
    if (!files.length) return;
    event.preventDefault();
    done(files);
  }

  /**
   * Прикрепить файлы выбранного вида → карточка сделки после загрузки (или null).
   * @param {object} deal
   * @param {File[]} files
   * @returns {Promise<object|null>}
   */
  static async upload(deal, files) {
    const kind = this._current(deal);
    const max = KpFilesPanel.maxMB('');
    const bad = [];
    let card = null;
    for (const [index, file] of files.entries()) {
      const name = KpFilesPanel.nameOf(file);
      const why = KpFilesPanel.problem(name, file, max);
      if (why) {
        bad.push(why);
        continue;
      }
      Toast.show(files.length > 1 ? `Прикрепляю ${index + 1} из ${files.length}: ${name}` : `Прикрепляю «${name}»…`);
      try {
        card = await Api.request(`${this.url(deal.id)}?kind=${kind}&name=${encodeURIComponent(name)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: file,
        });
      } catch (error) {
        bad.push(error.message);
      }
    }
    const label = (deal.fileKinds || {})[kind] || 'Документ';
    if (bad.length) Toast.show(`Не прикреплено: ${bad.join('; ')}`);
    else if (card)
      Toast.show(`${label}: прикреплено ${files.length > 1 ? `файлов ${files.length}` : `«${files[0].name}»`}`);
    this.kind = '';
    return card;
  }

  /**
   * Удалить документ (автор — в первые минуты, администратор — когда открыты «Настройки») → карточка или null.
   * @param {object} deal
   * @param {number} fid
   * @param {boolean} own удаляет автор
   * @returns {Promise<object|null>}
   */
  static async remove(deal, fid, own) {
    const file = (deal.files || []).find(row => row.id === fid);
    if (!file) return null;
    const sure = await AdminDialog.confirm(
      'Удалить документ?',
      `«${file.name}» удалится с сервера безвозвратно.`,
      'Удалить',
    );
    if (!sure) return null;
    const url = own
      ? `${this.url(deal.id, fid)}/remove`
      : `/api/admin/dealfiles/${encodeURIComponent(deal.id)}/${encodeURIComponent(fid)}/delete`;
    try {
      const answer = await Api.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: '{}',
      });
      Toast.show('Документ удалён');
      return own ? answer : await Api.request(`/api/crm/deal/${encodeURIComponent(deal.id)}`);
    } catch (error) {
      Toast.show(`Не удалено: ${error.message}`);
      return null;
    }
  }
}
