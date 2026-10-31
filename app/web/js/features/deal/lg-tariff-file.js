import { FreightFields } from './freight-fields.js';
import { LgFmt } from './lg-fmt.js';
import { LgState } from './lg-state.js';
import { Toast } from '../../core/toast.js';
import { Api } from '../../core/net.js';
import { Fmt } from '../../core/str.js';
import { esc } from '../../core/util.js';
import { LgCargo } from '../../core/lg-cargo.js';

/**
 * Тарифы доставки файлом: шаблон (CSV для Excel), чтение первого листа .xlsx (JSZip уже есть в программе), разбор таблиц
 * «Транспорт», «Разгрузка», «Параметр» по заголовкам и предпросмотр изменений перед записью.
 */
export class LgTariffFile {
  static BOM = '﻿';
  static URL_MS = 20000;
  static ALPHABET = 26;
  static CODE_A = 64;
  static ID_LEN = 8;
  static YES = /^(да|yes|1|true|\+)/i;
  static JSON_HEAD = { 'Content-Type': 'application/json; charset=utf-8' };

  /**
   * Скачать шаблон с текущими тарифами.
   * @param {object} tariffs
   */
  static template(tariffs) {
    const quote = value => {
      const text = String(value ?? '');
      return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const num = value => (value == null || value === '' ? '' : String(value).replace('.', ','));
    const classCell = (cls, key) => {
      if (key === 'name') return cls.name;
      if (key === 'open') return cls.open ? 'да' : 'нет';
      return num(cls[key]);
    };
    const lines = [
      FreightFields.FILE_CLASS.map(col => col[1]),
      ...tariffs.classes.map(cls => FreightFields.FILE_CLASS.map(([key]) => classCell(cls, key))),
      [],
      FreightFields.FILE_UNLOAD.map(col => col[1]),
      ...tariffs.unload.map(tech => [tech.name, num(tech.max), num(tech.cost)]),
      [],
      ['Параметр', 'Значение', 'Код'],
      ...FreightFields.COMMON.map(([key, label]) => [label, key === 'hub' ? tariffs[key] : num(tariffs[key]), key]),
    ];
    const text = LgTariffFile.BOM + lines.map(row => row.map(quote).join(';')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    link.download = 'Тарифы_доставки.csv';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(link.href);
      link.remove();
    }, LgTariffFile.URL_MS);
  }

  /**
   * Первый лист .xlsx → строки ячеек.
   * @param {ArrayBuffer} buf
   * @returns {Promise<string[][]>}
   */
  static async readXlsx(buf) {
    const zip = await JSZip.loadAsync(buf);
    const parser = new DOMParser();
    const shared = await LgTariffFile._shared(zip, parser);
    const names = Object.keys(zip.files)
      .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
      .sort((left, right) => parseInt(left.match(/\d+/), 10) - parseInt(right.match(/\d+/), 10));
    if (!names.length) throw new Error('в файле нет листов');
    const sheet = parser.parseFromString(await zip.file(names[0]).async('string'), 'application/xml');
    const rows = [...sheet.getElementsByTagName('row')].map(row => LgTariffFile._row(row, shared));
    return rows.filter(row => row.some(value => String(value).trim() !== ''));
  }

  static async _shared(zip, parser) {
    const file = zip.file('xl/sharedStrings.xml');
    if (!file) return [];
    const xml = parser.parseFromString(await file.async('string'), 'application/xml');
    return [...xml.getElementsByTagName('si')].map(item =>
      [...item.getElementsByTagName('t')].map(text => text.textContent).join(''),
    );
  }

  static _col(ref) {
    const match = String(ref || '').match(/^[A-Z]+/);
    let index = 0;
    for (const letter of match ? match[0] : 'A')
      index = index * LgTariffFile.ALPHABET + letter.charCodeAt(0) - LgTariffFile.CODE_A;
    return index - 1;
  }

  static _cell(cell, shared) {
    const type = cell.getAttribute('t');
    const value = cell.getElementsByTagName('v')[0];
    if (type === 's') return shared[+(value && value.textContent)] || '';
    if (type === 'inlineStr') return [...cell.getElementsByTagName('t')].map(text => text.textContent).join('');
    return value ? value.textContent : '';
  }

  static _row(row, shared) {
    const out = [];
    for (const cell of row.getElementsByTagName('c'))
      out[LgTariffFile._col(cell.getAttribute('r'))] = LgTariffFile._cell(cell, shared);
    return [...out].map(value => value ?? '');
  }

  static _head(row, spec) {
    const map = {};
    row.forEach((cell, i) => {
      const found = spec.find(([key, , pattern]) => map[key] == null && pattern.test(LgFmt.norm(cell)));
      if (found) map[found[0]] = i;
    });
    return map;
  }

  static _mode(row) {
    const first = LgFmt.norm(row[0]);
    const all = row.map(LgFmt.norm).join(' ');
    if (/^(транспорт|машин)/.test(first) && /длина|площадк/.test(all))
      return ['cl', LgTariffFile._head(row, FreightFields.FILE_CLASS)];
    if (/^(разгрузка|техника)/.test(first) && /масса|стоимост/.test(all))
      return ['un', LgTariffFile._head(row, FreightFields.FILE_UNLOAD)];
    if (/^параметр/.test(first) && /значени/.test(LgFmt.norm(row[1]))) return ['pr', null];
    return null;
  }

  /**
   * Строки файла → {classes, unload, params}: таблицы узнаются по заголовкам, столбцы — по названиям.
   * @param {string[][]} rows
   * @returns {{classes: object[], unload: object[], params: object}}
   */
  static parse(rows) {
    const out = { classes: [], unload: [], params: {} };
    let mode = '';
    let map = null;
    for (const row of rows) {
      const head = LgTariffFile._mode(row);
      if (head) {
        [mode, map] = head;
        continue;
      }
      if (!LgFmt.norm(row[0])) continue;
      LgTariffFile._take({ mode, map, row }, out);
    }
    LgTariffFile._check(out);
    return out;
  }

  static _take({ mode, map, row }, out) {
    if (mode === 'cl') out.classes.push(LgTariffFile._class(row, map));
    else if (mode === 'un')
      out.unload.push({
        name: String(row[map.name ?? 0]).trim(),
        max: LgCargo.num(row[map.max ?? 1]),
        cost: LgCargo.num(row[map.cost ?? 2]),
      });
    else if (mode === 'pr') LgTariffFile._param(row, out.params);
  }

  static _class(row, map) {
    const cls = { name: String(row[map.name ?? 0]).trim() };
    for (const [key] of FreightFields.FILE_CLASS)
      if (key !== 'name' && key !== 'open' && map[key] != null) cls[key] = LgCargo.num(row[map[key]]);
    if (map.open != null) cls.open = LgTariffFile.YES.test(String(row[map.open]).trim());
    // файл прежней версии (одна ставка) — та же ставка по всему маршруту
    if (map.kmFar == null && cls.km > 0) cls.kmFar = cls.km;
    return cls;
  }

  static _param(row, params) {
    const key = LgFmt.norm(row[2]);
    const label = LgFmt.norm(row[0]);
    const field = FreightFields.COMMON.find(([code, title]) => LgFmt.norm(code) === key || LgFmt.norm(title) === label);
    if (field) params[field[0]] = field[0] === 'hub' ? String(row[1]).trim() : LgCargo.num(row[1]);
  }

  static _check(out) {
    if (!out.classes.length && !out.unload.length && !Object.keys(out.params).length) {
      throw new Error('не найдены таблицы «Транспорт», «Разгрузка» или «Параметр» — возьмите шаблон');
    }
    const bad = out.classes.filter(cls => !cls.name || FreightFields.REQUIRED.some(key => !(cls[key] > 0)));
    if (bad.length) {
      const names = bad.map(cls => `«${cls.name || 'без названия'}»`).join(', ');
      throw new Error(`у машин ${names} не указаны длина, ширина, высота, грузоподъёмность или ставка`);
    }
  }

  static _byName(list, name) {
    return list.find(row => LgFmt.norm(row.name) === LgFmt.norm(name));
  }

  static _yesNo(flag) {
    return flag ? 'да' : 'нет';
  }

  static _classChanges(imp, tariffs) {
    const out = [];
    for (const cls of imp.classes) {
      const now = LgTariffFile._byName(tariffs.classes, cls.name);
      if (!now) {
        out.push(
          `<li><b>${esc(cls.name)}</b> — новая машина: ${LgFmt.num(cls.L)} × ${LgFmt.num(cls.W)} м, ${LgFmt.num(cls.t)} т, ${LgFmt.num(cls.km)} ₽/км</li>`,
        );
        continue;
      }
      const diff = FreightFields.FILE_CLASS.filter(
        ([key]) => key !== 'name' && cls[key] != null && String(cls[key]) !== String(now[key]),
      ).map(([key, label]) => {
        const was = key === 'open' ? LgTariffFile._yesNo(now.open) : LgFmt.num(now[key]);
        const will = key === 'open' ? LgTariffFile._yesNo(cls.open) : LgFmt.num(cls[key]);
        return `${label.replace(/, .*$/, '')}: ${was} → <b>${will}</b>`;
      });
      if (diff.length) out.push(`<li><b>${esc(cls.name)}</b>: ${diff.join(', ')}</li>`);
    }
    return out;
  }

  static _unloadChanges(imp, tariffs) {
    const out = [];
    for (const tech of imp.unload) {
      const now = LgTariffFile._byName(tariffs.unload, tech.name);
      if (!now)
        out.push(
          `<li><b>${esc(tech.name)}</b> — новая техника разгрузки: до ${LgFmt.num(tech.max)} т, ${Fmt.rub(tech.cost)}</li>`,
        );
      else if (now.max !== tech.max || now.cost !== tech.cost) {
        out.push(
          `<li><b>${esc(tech.name)}</b>: ${LgFmt.num(now.max)} т / ${Fmt.rub(now.cost)} → <b>${LgFmt.num(tech.max)} т / ${Fmt.rub(tech.cost)}</b></li>`,
        );
      }
    }
    return out;
  }

  static _paramChanges(imp, tariffs) {
    const show = value => (typeof value === 'number' ? LgFmt.num(value) : String(value ?? ''));
    return Object.entries(imp.params)
      .filter(([key, value]) => value != null && String(value) !== String(tariffs[key]))
      .map(([key, value]) => {
        const label = (FreightFields.COMMON.find(row => row[0] === key) || [null, key])[1];
        return `<li>${esc(label)}: ${esc(show(tariffs[key]))} → <b>${esc(show(value))}</b></li>`;
      });
  }

  /**
   * Предпросмотр изменений из файла и запись после «Применить».
   * @param {HTMLElement} box раздел настроек
   * @param {{imp: object, fname: string, tariffs: object, onSaved: Function}} spec onSaved — тарифы записаны
   */
  static preview(box, spec) {
    const { imp, fname, tariffs } = spec;
    const out = box.querySelector('#lgImp');
    const changes = [
      ...LgTariffFile._classChanges(imp, tariffs),
      ...LgTariffFile._unloadChanges(imp, tariffs),
      ...LgTariffFile._paramChanges(imp, tariffs),
    ];
    const gone = tariffs.classes.filter(cls => imp.classes.length && !LgTariffFile._byName(imp.classes, cls.name));
    const goneText = gone.length
      ? `<p class="muted">Машин нет в файле — останутся как есть: ${esc(gone.map(cls => cls.name).join(', '))}</p>`
      : '';
    out.innerHTML = `<div class="lg-imp"><p class="sub">Файл «${esc(fname)}»: ${changes.length ? `изменений — ${changes.length}` : 'изменений нет'}</p>
      ${changes.length ? `<ul>${changes.join('')}</ul>` : ''}${goneText}
      <div class="row">${changes.length ? '<button class="btn primary" type="button" data-lgimp>Применить и сохранить</button>' : ''}<button class="btn ghost" type="button" data-lgimpx>Отмена</button></div></div>`;
    out.onclick = async event => {
      if (event.target.closest('[data-lgimpx]')) {
        out.innerHTML = '';
        return;
      }
      if (event.target.closest('[data-lgimp]')) await LgTariffFile._apply(box, spec);
    };
  }

  static _filled(row) {
    return Object.fromEntries(Object.entries(row).filter(([, value]) => value != null));
  }

  static _newId(prefix) {
    return prefix + Math.random().toString(36).slice(2, LgTariffFile.ID_LEN);
  }

  static _standard(cls) {
    const row = { ...cls };
    delete row.srcAt;
    delete row.srcAuto;
    return { ...row, ...(row.src && /вручную/.test(row.src) ? { src: undefined } : {}) };
  }

  // стандартные ставки — с их источником; ставки из файла закрепляются (автообновление выключено)
  static _classes(imp, tariffs, src) {
    const saved = LgState.saved || {};
    const base =
      Array.isArray(saved.classes) && saved.classes.length
        ? saved.classes.map(row => ({ ...row }))
        : tariffs.classes.map(cls => LgTariffFile._standard(cls));
    for (const cls of imp.classes) {
      const now = LgTariffFile._byName(base, cls.name);
      if (now) Object.assign(now, LgTariffFile._filled(cls), { auto: false, src });
      else {
        base.push({
          id: LgTariffFile._newId('c'),
          hMax: cls.h,
          wMax: cls.W,
          base: 0,
          min: 0,
          open: false,
          ...LgTariffFile._filled(cls),
          auto: false,
          src,
        });
      }
    }
    return base.sort((left, right) => left.t - right.t);
  }

  static _unload(imp, tariffs) {
    const saved = LgState.saved || {};
    const list = (Array.isArray(saved.unload) && saved.unload.length ? saved.unload : tariffs.unload).map(row => ({
      ...row,
    }));
    for (const tech of imp.unload) {
      const now = LgTariffFile._byName(list, tech.name);
      if (now) Object.assign(now, tech);
      else list.push({ id: LgTariffFile._newId('u'), ...tech });
    }
    return list.sort((left, right) => left.max - right.max);
  }

  static async _apply(box, { imp, fname, tariffs, onSaved }) {
    const src = `файл «${fname}», ${new Date().toLocaleDateString('ru-RU')}`;
    const saved = LgState.saved || {};
    const keep = Object.fromEntries(
      Object.entries(saved).filter(([key]) => !key.startsWith('_') && !['updatedAt', 'updatedBy'].includes(key)),
    );
    const out = {
      ...keep,
      ...imp.params,
      ver: 3,
      classes: LgTariffFile._classes(imp, tariffs, src),
      unload: LgTariffFile._unload(imp, tariffs),
      fileSrc: src,
    };
    try {
      await Api.request('/api/logistics', {
        method: 'PUT',
        headers: LgTariffFile.JSON_HEAD,
        body: JSON.stringify(out),
      });
      Toast.show('Тарифы из файла сохранены');
      onSaved();
    } catch (err) {
      Toast.show(`Не сохранено: ${err.message || err}`);
    }
  }
}
