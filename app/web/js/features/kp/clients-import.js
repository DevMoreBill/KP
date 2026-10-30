import { ClientStore, Inn, OrgName } from './client-store.js';
import { Toast } from '../../core/toast.js';
import { Api } from '../../core/net.js';
import { $, esc, today } from '../../core/util.js';
import { KpForm } from '../../core/kp-form.js';

/** Загрузка клиентов списком ИНН: реквизиты из ЕГРЮЛ ФНС (или Checko / DaData, если указаны ключи) → справочник. */
export class ClientsImport {
  /** list — ИНН из поля; rows — строки загрузки {inn, st, c, err}; run — идёт загрузка; stop — просили остановить */
  static state = { list: [], rows: [], run: false, stop: false };
  /** пауза между запросами: сайт налоговой ограничивает частые обращения */
  static PAUSE = 1300;
  static STATUS = { wait: 'в очереди', work: 'запрашиваю…', new: 'добавлен', upd: 'обновлён', err: 'ошибка' };
  static FIELDS = ['full', 'kpp', 'ogrn', 'address', 'director', 'directorPost', 'status', 'source'];
  static BAD_SHOWN = 5;
  static ERROR_MAX = 160;
  static URL_LIFE_MS = 30000;
  static PERCENT = 100;
  static CSV_HEAD = [
    'ИНН',
    'КПП',
    'ОГРН',
    'Краткое наименование',
    'Полное наименование',
    'Юридический адрес',
    'Руководитель',
    'Должность',
    'Статус',
    'Источник',
    'Итог',
  ];

  /**
   * Все ИНН из текста или таблицы: 10 цифр — организация, 12 — ИП; повторы убираются.
   * @param {string} text
   * @returns {{found: string[], bad: string[]}}
   */
  static innsFrom(text) {
    const found = [];
    const bad = [];
    const seen = new Set();
    for (const match of String(text || '').matchAll(/(^|\D)(\d{10}|\d{12})(?=\D|$)/g)) {
      const inn = match[2];
      if (seen.has(inn)) continue;
      seen.add(inn);
      (Inn.valid(inn) ? found : bad).push(inn);
    }
    return { found, bad };
  }

  // текст из файла: .xlsx — все ячейки всех листов, иначе — как текст
  static async _textOf(file) {
    if (!/\.xlsx$/i.test(file.name)) return file.text();
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    let text = '';
    for (const name of Object.keys(zip.files)) {
      if (!/^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/.test(name)) continue;
      text += ` ${(await zip.file(name).async('string')).replace(/<[^>]+>/g, ' ')}`;
    }
    return text;
  }

  /** Окно загрузки. */
  static open() {
    const dialog = $('#dlg');
    dialog.className = 'wide';
    this.state.rows = [];
    this.state.list = [];
    dialog.innerHTML = `<div class="dlg-h"><h3>Загрузить клиентов по списку ИНН</h3><button class="icon" type="button" data-ci="close" aria-label="Закрыть">✕</button></div>
   <div class="dlg-b" id="ciBody">
    <p class="muted" style="margin-top:0">Вставьте ИНН — столбец из Excel, через запятую или по одному в строке — или выберите файл (.xlsx, .csv, .txt). Программа возьмёт реквизиты в реестре ФНС (ЕГРЮЛ/ЕГРИП) и добавит клиентов в справочник. Уже известные клиенты обновятся: контакты и объекты сохранятся.</p>
    <textarea id="ciText" rows="7" placeholder="7707083893&#10;7729101200&#10;…" spellcheck="false" style="font-family:ui-monospace,Consolas,monospace"></textarea>
    <div class="row" style="margin-top:8px"><label class="btn ghost">Выбрать файл…<input type="file" id="ciFile" accept=".xlsx,.csv,.txt" hidden></label><span class="muted" id="ciCount"></span><span style="flex:1"></span>
      <button class="btn primary" type="button" data-ci="start" disabled>Загрузить реквизиты</button></div>
    <div id="ciRes"></div></div>`;
    dialog.showModal();
  }

  static _count() {
    if (!$('#ciText')) return;
    const { found, bad } = this.innsFrom($('#ciText').value);
    this.state.list = found;
    const wrong = bad.length
      ? ` · <span class="bad-t">с ошибкой: ${bad.length} (${esc(bad.slice(0, this.BAD_SHOWN).join(', '))}${bad.length > this.BAD_SHOWN ? '…' : ''})</span>`
      : '';
    $('#ciCount').innerHTML = found.length || bad.length ? `Найдено ИНН: <b>${found.length}</b>${wrong}` : '';
    const button = document.querySelector('[data-ci="start"]');
    if (button) button.disabled = !found.length || this.state.run;
  }

  static _table() {
    if (!$('#ciRes')) return; // окно закрыто — загрузка идёт до остановки
    const rows = this.state.rows;
    const done = rows.filter(row => row.st !== 'wait' && row.st !== 'work').length;
    const total = rows.length;
    $('#ciRes').innerHTML =
      `<div class="ci-prog"><div style="width:${total ? (done / total) * this.PERCENT : 0}%"></div></div>
    <div class="row" style="margin:6px 0 10px"><span>${this._progress(done, total)}</span><span style="flex:1"></span>
      ${this._buttons()}</div>
    <div class="ci-tbl"><table><thead><tr><th>ИНН</th><th>Клиент</th><th>КПП</th><th>Статус</th><th>Итог</th></tr></thead><tbody>
    ${rows.map(row => this._row(row)).join('')}</tbody></table></div>`;
  }

  static _of(kind) {
    return this.state.rows.filter(row => row.st === kind).length;
  }

  static _progress(done, total) {
    if (this.state.run) return `Обработано ${done} из ${total}`;
    const errors = this._of('err');
    return `Готово: добавлено <b>${this._of('new')}</b>, обновлено <b>${this._of('upd')}</b>${errors ? `, ошибок <b class="bad-t">${errors}</b>` : ''}`;
  }

  static _buttons() {
    if (this.state.run) return '<button class="btn ghost" type="button" data-ci="stop">Остановить</button>';
    const retry = this._of('err')
      ? '<button class="btn ghost" type="button" data-ci="retry">Повторить ошибки</button>'
      : '';
    return `${retry}<button class="btn" type="button" data-ci="csv">Скачать список (Excel)</button>`;
  }

  static _row(row) {
    const client = row.c;
    const status =
      client && client.status
        ? `<span class="st-badge ${/действ/i.test(client.status) ? 'ok' : 'bad'}">${esc(client.status)}</span>`
        : '';
    return `<tr class="${row.st}"><td>${esc(row.inn)}</td><td>${esc(client ? client.name : '')}${client && client.address ? `<small>${esc(client.address)}</small>` : ''}</td><td>${esc(client ? client.kpp : '')}</td>
      <td>${status}</td><td>${esc(row.st === 'err' ? row.err : this.STATUS[row.st])}</td></tr>`;
  }

  static async _run(list) {
    const state = this.state;
    state.run = true;
    state.stop = false;
    this._count();
    this._table();
    for (const [index, row] of list.entries()) {
      if (state.stop) break;
      row.st = 'work';
      this._table();
      await this._one(row);
      this._table();
      if (!state.stop && index < list.length - 1) await new Promise(resolve => setTimeout(resolve, this.PAUSE));
    }
    list.forEach(row => {
      if (row.st === 'work' || row.st === 'wait') {
        row.st = 'err';
        row.err = 'остановлено';
      }
    });
    state.run = false;
    await ClientStore.load();
    this._table();
    this._count();
    KpForm.render();
  }

  static async _one(row) {
    try {
      const party = await Api.request(`/api/party?inn=${row.inn}`);
      if (party.error) throw new Error(party.error.replace(/^Не удалось получить данные\.\s*/, ''));
      const known = await ClientStore.byId(`inn${row.inn}`);
      const client = this._record(party, row.inn, known);
      row.c = await Api.request(`/api/clients/${client.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(client),
      });
      row.st = known ? 'upd' : 'new';
    } catch (error) {
      row.st = 'err';
      row.err = String(error.message || error).slice(0, this.ERROR_MAX);
    }
  }

  // известный клиент — поверх его записи (контакты и объекты сохраняются)
  static _record(party, inn, known) {
    const fields = Object.fromEntries(this.FIELDS.map(field => [field, party[field] || '']));
    return Object.assign({}, known || {}, {
      _rev: undefined,
      id: `inn${party.inn || inn}`,
      name: OrgName.short(party.short || party.full),
      full: fields.full,
      inn: party.inn || inn,
      kpp: fields.kpp,
      ogrn: fields.ogrn,
      address: fields.address,
      director: fields.director,
      directorPost: fields.directorPost,
      status: fields.status,
      source: fields.source,
    });
  }

  // список для Excel: CSV с разделителем «;» в UTF-8 с BOM — открывается двойным щелчком
  static _csv() {
    const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [this.CSV_HEAD.map(quote).join(';')].concat(
      this.state.rows.map(row => {
        const client = row.c || {};
        return [
          row.inn,
          client.kpp,
          client.ogrn,
          client.name,
          client.full,
          client.address,
          client.director,
          client.directorPost,
          client.status,
          client.source,
          row.st === 'err' ? `Ошибка: ${row.err}` : this.STATUS[row.st],
        ]
          .map(quote)
          .join(';');
      }),
    );
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }));
    link.download = `Клиенты_по_ИНН_${today()}.csv`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(link.href);
      link.remove();
    }, this.URL_LIFE_MS);
  }

  static async _file(input) {
    try {
      const { found } = this.innsFrom(await this._textOf(input.files[0]));
      $('#ciText').value = found.join('\n');
      this._count();
      if (!found.length) Toast.show('В файле не найдено ИНН');
    } catch (error) {
      Toast.show(`Не удалось прочитать файл: ${error.message}`);
    }
  }

  static _ACTIONS = {
    close: () => {
      if (ClientsImport.state.run && !confirm('Остановить загрузку? Уже загруженные клиенты сохранятся.')) return;
      ClientsImport.state.stop = true;
      const dialog = $('#dlg');
      dialog.close();
      dialog.className = '';
    },
    start: () => {
      const state = ClientsImport.state;
      state.rows = state.list.map(inn => ({ inn, st: 'wait' }));
      ClientsImport._run(state.rows);
    },
    retry: () => {
      const list = ClientsImport.state.rows.filter(row => row.st === 'err');
      list.forEach(row => {
        row.st = 'wait';
        row.err = '';
      });
      ClientsImport._run(list);
    },
    stop: () => {
      ClientsImport.state.stop = true;
    },
    csv: () => ClientsImport._csv(),
  };

  /** Поле ИНН, файл, кнопки окна. */
  static listen() {
    document.addEventListener('input', event => {
      if (event.target.id === 'ciText') this._count();
    });
    document.addEventListener('change', event => {
      if (event.target.id === 'ciFile' && event.target.files[0]) this._file(event.target);
    });
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-ci]');
      if (button) this._ACTIONS[button.dataset.ci]?.();
    });
  }
}
