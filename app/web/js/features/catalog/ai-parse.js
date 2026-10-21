import { FormView } from '../../ui/form-view.js';
import { KpState, S } from '../../core/state.js';
import { Toast } from '../../core/toast.js';
import { $, esc } from '../../core/util.js';
/**
 * Ответ ИИ → объект. Понимает блок ```json, текст вокруг, «умные» кавычки, запятые перед } и ], комментарии //.
 * Не JSON — строки «Параметр: значение» / таблица из двух колонок становятся характеристиками.
 */
export class AiParse {
  static FENCE = /```(?:json|JSON)?\s*([\s\S]*?)```/;
  static BAD_JSON =
    'Ответ похож на JSON, но в нём ошибка — попросите ИИ «Повтори ответ строго одним JSON» или скопируйте ответ ещё раз целиком (кнопкой «Копировать» под ответом).';
  static NOTHING = 'Не нашёл в ответе ни JSON, ни строк «параметр: значение».';

  /**
   * Таблица характеристик из текста: строки «Параметр<Tab>Значение» или «Параметр: значение»; строка с одним столбцом —
   * название группы.
   * @param {string} text
   * @returns {{name: string, rows: {k: string, v: string}[]}[]}
   */
  static specs(text) {
    const groups = [];
    let group = null;
    text.split(/\r?\n/).forEach(line => {
      if (!line.trim()) return;
      const cells = this._cells(line);
      if (cells.filter(Boolean).length === 1) {
        group = { name: cells.find(Boolean), rows: [] };
        groups.push(group);
        return;
      }
      if (!group) {
        group = { name: '', rows: [] };
        groups.push(group);
      }
      group.rows.push({ k: cells[0], v: cells.slice(1).filter(Boolean).join(' ') });
    });
    return groups.filter(one => one.rows.length);
  }

  static _cells(line) {
    let cells = [line];
    if (line.includes('\t')) cells = line.split('\t');
    else if (line.includes(':')) cells = [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1)];
    return cells.map(cell => cell.trim()).filter((cell, k) => k < 2 || cell);
  }

  static _json(body) {
    const fixed = body
      .replace(/[“”„«»]/g, '"')
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\bNaN\b|\bundefined\b/g, '""');
    for (const text of [body, fixed]) {
      try {
        const data = JSON.parse(text);
        if (data && typeof data === 'object' && !Array.isArray(data)) return { kind: 'json', j: data };
      } catch {
        // следующий вариант
      }
    }
    return { kind: 'bad', err: this.BAD_JSON };
  }

  /**
   * Разобрать ответ ИИ.
   * @param {string} raw
   * @returns {{kind: string, j?: object, err?: string}|null} kind: json | text | bad
   */
  static parse(raw) {
    let text = String(raw || '').trim();
    if (!text) return null;
    const fence = this.FENCE.exec(text);
    if (fence && fence[1].includes('{')) text = fence[1];
    const from = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (from >= 0 && end > from) return this._json(text.slice(from, end + 1));
    const groups = this.specs(text);
    if (groups.length) return { kind: 'text', j: { groups } };
    return { kind: 'bad', err: this.NOTHING };
  }

  static _count(count, one, few, many) {
    return `${count} ${KPGen.plural(count, one, few, many)}`;
  }

  static _rows(data) {
    const rows =
      (data.groups || []).reduce((sum, group) => sum + ((group && group.rows) || []).length, 0) +
      (data.rows || []).length;
    if (!rows) return '';
    const groups =
      (data.groups || []).length > 1 ? ` в ${this._count(data.groups.length, 'группе', 'группах', 'группах')}` : '';
    return `Характеристики: ${this._count(rows, 'строка', 'строки', 'строк')}${groups}`;
  }

  static _head(data) {
    return [
      data.name ? `Наименование: <b>${esc(data.name)}</b>` : '',
      data.spec ? `Строка под названием: ${esc(data.spec)}` : '',
      data.desc ? 'Описание элемента' : '',
    ];
  }

  static _station(data) {
    const parts = (data.parts || []).filter(part => part && part.name).length;
    const container = ((data.container && data.container.rows) || []).filter(row => row && row.k).length;
    return [
      parts ? `Элементы станции: ${parts} — новые добавятся в состав` : '',
      container ? `Требования к контейнеру: ${this._count(container, 'строка', 'строки', 'строк')}` : '',
    ];
  }

  static _lines(data) {
    const feats = (data.features || []).filter(feat => feat && (feat.label || feat.text)).length;
    const attrs = Object.entries(data.attrs || {}).filter(
      ([key, value]) => key !== 'cat' && value !== '' && value != null,
    ).length;
    const cover = data.cover && (data.cover.model || data.cover.title);
    return [
      ...this._head(data),
      feats ? `Описание: ${this._count(feats, 'блок', 'блока', 'блоков')}` : '',
      this._rows(data),
      attrs ? `Параметры для фильтров каталога: ${attrs}` : '',
      cover ? 'Титульный лист' : '',
      ...this._station(data),
    ].filter(Boolean);
  }

  /**
   * Что заполнится из ответа — коротким списком.
   * @param {object|null} answer разобранный ответ
   * @returns {string}
   */
  static summary(answer) {
    if (!answer) return '';
    if (answer.kind === 'bad') return `<p class="ai-err">${esc(answer.err)}</p>`;
    const lines = this._lines(answer.j);
    if (!lines.length) return '<p class="ai-err">В ответе нет данных для карточки.</p>';
    return `<p class="ai-ok">${answer.kind === 'text' ? 'Распознана таблица характеристик (без ИИ-формата).' : 'Ответ распознан.'} Будет заполнено:</p><ul class="ai-list">${lines.map(line => `<li>${line}</li>`).join('')}</ul>`;
  }
}

/** Окно «Вставить характеристики» из Excel или строками «Параметр: значение». */
export class SpecPaste {
  /**
   * Открыть окно.
   * @param {number} i позиция КП
   */
  static open(i) {
    const dialog = $('#dlg');
    dialog.innerHTML = `<div class="dlg-h"><h3>Вставить характеристики</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
  <div class="dlg-b"><p class="muted" style="margin-top:0">Скопируйте из Excel два столбца: «Параметр» и «Значение». Строка с одним заполненным столбцом станет названием группы. Также подходят строки вида «Параметр: значение».</p>
  <textarea id="pasteArea" rows="12" placeholder="Двигатель&#10;Марка / модель&#9;Cummins / 4BT3.9G2&#10;Рабочий объём&#9;3,9 л"></textarea>
  <div class="row" style="margin-top:12px;justify-content:flex-end"><label class="row muted"><input type="checkbox" id="pasteRepl" checked style="width:auto"> Заменить текущие</label><button class="btn primary" type="button" id="pasteOk">Добавить</button></div></div>`;
    dialog.showModal();
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    $('#pasteOk').onclick = () => this._add(dialog, i);
  }

  static _add(dialog, i) {
    const groups = AiParse.specs($('#pasteArea').value);
    if (!groups.length) {
      Toast.show('Не нашёл строк с параметрами');
      return;
    }
    const item = S.items[i];
    item.groups = $('#pasteRepl').checked ? groups : item.groups.concat(groups);
    dialog.close();
    FormView.render();
    KpState.persist();
    Toast.show(`Добавлено строк: ${groups.reduce((sum, group) => sum + group.rows.length, 0)}`);
  }
}
