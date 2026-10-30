import { AiChat, AiDirect } from './ai-chat.js';
import { AiParse } from './ai-parse.js';
import { Kit } from '../kit/kit.js';
import { Toast } from '../../core/toast.js';
import { KpState, S } from '../../core/state.js';
import { $, esc } from '../../core/util.js';
import { Attrs } from '../../core/item-attrs.js';
import { EquipTypes } from '../../core/equip-types.js';
import { KpForm } from '../../core/kp-form.js';

/** Окно «Заполнить с ИИ» для элемента станции: описание и характеристики элемента. */
export class AiPart {
  /**
   * Запрос для элемента.
   * @param {object} item станция
   * @param {object} part элемент
   * @returns {string}
   */
  static prompt(item, part) {
    return `Ты — инженер, готовишь технико-коммерческое предложение на русском языке.
Элемент ${EquipTypes.byId(Attrs.of(item).cat).item.toLowerCase()}${item.name ? ` «${item.name}»` : ''}: «${part.name || 'элемент'}».
Составь техническое описание элемента и таблицу его характеристик. Бери ТОЛЬКО факты из исходных данных (и приложенных файлов), ничего не придумывай; нет данных — пустая строка. Значения — с единицами измерения, десятичный разделитель — запятая.
Ответ — строго один JSON-объект в блоке кода, без пояснений:
\`\`\`json
{"name":"наименование элемента","desc":"назначение, конструкция, комплектация — 2–5 предложений","maker":"производитель","model":"модель","rows":[{"k":"Параметр, ед.","v":"значение"}]}
\`\`\`
ИСХОДНЫЕ ДАННЫЕ:
${String(part._src || '').trim() || '(только наименование — найди данные производителя; если не уверен — оставь пустым)'}`;
  }

  static _step2(i, j) {
    const direct = AiDirect.state;
    const sites = AiChat.sitesHtml('aiPartCopy', i, ` data-j="${j}"`);
    if (!direct.enabled) {
      return `<span class="muted">Кнопка с названием копирует запрос и открывает сайт — вставьте (Ctrl+V) и отправьте. Можно приложить PDF или скриншот.</span>${sites}`;
    }
    return `<div class="row"><button class="btn primary" type="button" id="aipAuto">✨ Заполнить автоматически — ${esc(direct.provider)}</button><span class="muted" id="aipSt"></span></div>
        <details class="ai-pr"><summary>или через ИИ-чат в браузере</summary>${sites}</details>`;
  }

  static _html(i, j, part) {
    const answer = AiParse.parse(part._ans);
    return `<div class="dlg-h"><h3>Заполнить с ИИ: ${esc(part.name || 'элемент')}</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
    <div class="dlg-b ai3"><ol class="ai-steps">
      <li><b>Что известно об элементе</b><span class="muted">Текст паспорта, коммерческого предложения поставщика, требования заказчика — или просто модель.</span>
        <textarea id="aipSrc" rows="5" placeholder="Например: контейнер 40 футов HC, утепление 100 мм, ворота 2,4 × 2,5 м, отопление 2 × 3 кВт">${esc(part._src || '')}</textarea></li>
      <li><b>${AiDirect.state.enabled ? 'Заполните автоматически' : 'Отправьте запрос в любой ИИ'}</b>${this._step2(i, j)}</li>
      <li><b>Вставьте ответ ИИ</b><textarea id="aipAns" rows="5" placeholder="Скопируйте ответ целиком и вставьте сюда (Ctrl+V)">${esc(part._ans || '')}</textarea>
        <div class="ai-prev" id="aipPrev">${AiParse.summary(answer)}</div>
        <div class="row"><button class="btn primary" type="button" id="aipOk" ${answer && answer.kind !== 'bad' ? '' : 'disabled'}>Заполнить элемент</button></div></li></ol></div>`;
  }

  static _fill(part, data) {
    if (data.name && !String(part.name || '').trim()) part.name = String(data.name);
    if (data.desc) part.desc = String(data.desc);
    const rows = (data.rows || [])
      .concat(...(data.groups || []).map(group => group.rows || []))
      .filter(row => row && row.k && row.v)
      .map(row => ({ k: String(row.k), v: String(row.v) }));
    if (rows.length) part.rows = rows;
    this._maker(part, data);
  }

  static _maker(part, data) {
    if (!data.maker && !data.model) return;
    part.attrs = {
      ...(part.attrs || {}),
      ...(data.maker ? { maker: String(data.maker) } : {}),
      ...(data.model ? { model: String(data.model) } : {}),
    };
    if (data.maker && !part.sup) part.sup = String(data.maker);
  }

  static _auto(dialog, ctx) {
    return async event => {
      event.target.disabled = true;
      $('#aipSt').textContent = 'Заполняю… обычно 10–30 секунд';
      try {
        ctx.part._ans = await AiDirect.ask(this.prompt(ctx.item, ctx.part));
        this._draw(dialog, ctx);
      } catch (error) {
        event.target.disabled = false;
        $('#aipSt').textContent = String(error.message || error);
      }
    };
  }

  static _ok(dialog, part) {
    const answer = AiParse.parse(part._ans);
    if (!answer || answer.kind === 'bad') return;
    this._fill(part, answer.j);
    delete part._ans;
    dialog.close();
    KpForm.render();
    KpState.persist();
    Toast.show('Элемент заполнен из ответа ИИ');
  }

  static _draw(dialog, ctx) {
    const { i, j, part } = ctx;
    dialog.innerHTML = this._html(i, j, part);
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    $('#aipSrc').oninput = event => {
      part._src = event.target.value;
    };
    if ($('#aipAuto')) $('#aipAuto').onclick = this._auto(dialog, ctx);
    $('#aipAns').oninput = event => {
      part._ans = event.target.value;
      const answer = AiParse.parse(part._ans);
      $('#aipPrev').innerHTML = AiParse.summary(answer);
      $('#aipOk').disabled = !(answer && answer.kind !== 'bad');
    };
    $('#aipOk').onclick = () => this._ok(dialog, part);
  }

  /**
   * Открыть окно для элемента станции.
   * @param {number} i позиция КП (станция)
   * @param {number} j элемент состава
   */
  static open(i, j) {
    const item = S.items[i];
    const part = Kit.parts(item)[j];
    if (!part) return;
    const dialog = $('#dlg');
    dialog.classList.add('wide');
    this._draw(dialog, { i, j, item, part });
    if (!dialog.open) dialog.showModal();
  }

  /**
   * Скопировать запрос для элемента (и открыть сайт ИИ).
   * @param {number} i
   * @param {number} j
   * @param {string} url
   */
  static copy(i, j, url) {
    const item = S.items[i];
    const part = Kit.parts(item)[j];
    if (!part) return;
    AiChat.send(this.prompt(item, part), url, ok => {
      if (ok) Toast.show(url ? 'Запрос скопирован — вставьте его в окне ИИ (Ctrl+V)' : 'Запрос скопирован');
    });
  }
}
