import { AsmFacts } from './asm-facts.js';
import { AsmItem } from './asm-item.js';
import { AiDirect, AiFileImages, AiFileText } from '../catalog/ai-chat.js';
import { EquipTypes } from '../../core/equip-types.js';
import { FEAT } from '../../core/features.js';
import { Str } from '../../core/str.js';

/**
 * ИИ сборного изделия (нейросеть программы через сервер, `/api/ai/fill`): единое описание и сводные характеристики из
 * данных частей; части изделия из техничек, КП и паспортов. Ответ проверяется по исходным данным (`AsmFacts`): чужие числа,
 * производитель и модель, которых нет в данных, не попадают в изделие.
 */
export class AsmAi {
  static LABELS = ['Назначение', 'Устройство', 'Состав', 'Преимущества'];
  static ROLES = ['container', 'main', 'power', 'equipment'];
  static ROWS = 16;
  static ROW_KEY = 80;
  static ROW_VALUE = 160;
  static BLOCK = 1500;
  static DESC = 1500;
  static PART_ROWS = 40;
  static PARTS = 12;
  static QTY_MAX = 20;
  static NAME = 200;
  static FILE_CHARS = 50000;
  static FIELDS = 12;
  static KOPECKS = 100;
  static CURRENCIES = ['RUB', 'USD', 'EUR', 'CNY'];

  /** @returns {boolean} «Описание и сводные — ИИ» доступно */
  static enabled() {
    return FEAT.on('asmAi') && FEAT.on('ai') && !!AiDirect.state.enabled;
  }

  /** @returns {boolean} «Из техничек — ИИ» доступно */
  static filesEnabled() {
    return FEAT.on('asmFiles') && FEAT.on('ai') && !!AiDirect.state.enabled;
  }

  /**
   * Данные частей для запроса: название, роль, количество, параметры, характеристики, описание.
   * @param {object[]} parts
   * @returns {string}
   */
  static source(parts) {
    return parts
      .map((part, k) => {
        const attrs = Object.entries(part.attrs || {})
          .filter(([key, value]) => key !== 'cat' && value !== '' && value != null)
          .map(([key, value]) => `${key}: ${value}`)
          .join('; ');
        const rows = (part.rows || []).map(row => `${row.k}: ${row.v}`).join('; ');
        const role = part.role === 'container' ? 'контейнер' : 'оборудование';
        return [`${k + 1}. ${part.name} × ${+part.qty || 1} (${role})`, attrs, rows, part.desc]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n\n');
  }

  /**
   * Запрос «Единое описание и сводные характеристики».
   * @param {string} cat
   * @param {object[]} parts
   * @returns {string}
   */
  static describePrompt(cat, parts) {
    const type = EquipTypes.byId(cat);
    const calc = AsmItem.calc(cat, parts);
    return `ЗАДАЧА: asm-describe
Готовое изделие «${type.item || type.name}» собрано из контейнера и оборудования (данные частей — ниже). Подготовь для технико-коммерческого предложения:
1) blocks — единое описание изделия связным текстом по блокам ${this.LABELS.map(label => `«${label}»`).join(', ')}: назначение изделия, как оно устроено, что входит в состав, чем оно удобно заказчику. Без рекламы, без повторов описаний частей, только факты из данных.
2) rows — сводные характеристики готового изделия (производительность, давление или напор, мощность, габариты, масса, электропитание и т. п.): только параметры, которые есть в данных; значение — с единицей, как в данных.
Числа бери только из данных частей и расчёта программы, не рассчитывай сам, не округляй. Нет данных — не пиши.
Ответ: {"blocks":[{"label":"Назначение","text":"…"}],"rows":[{"k":"…","v":"…"}]}
Расчёт программы: ${calc.length ? calc.map(row => `${row.k} — ${row.v}`).join('; ') : 'нет'}
ДАННЫЕ ЧАСТЕЙ:
${this.source(parts)}`;
  }

  /**
   * Описание и сводные характеристики изделия (проверенные по данным частей).
   * @param {string} cat
   * @param {object[]} parts
   * @returns {Promise<{blocks: object[], rows: object[], sig: string}>}
   */
  static async describe(cat, parts) {
    const answer = this.json(await AiDirect.ask(this.describePrompt(cat, parts)));
    const known = AsmFacts.known([this.source(parts), ...AsmItem.calc(cat, parts).map(row => row.v)]);
    return { ...this.clean(answer, known), sig: AsmItem.sig(parts) };
  }

  /**
   * JSON из ответа (без обрамления ```json).
   * @param {string} text
   * @returns {object}
   */
  static json(text) {
    const raw = String(text || '');
    const body = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    try {
      const value = JSON.parse(body);
      return value && typeof value === 'object' ? value : {};
    } catch {
      throw new Error('Нейросеть ответила не данными — повторите');
    }
  }

  /**
   * Блоки описания и строки характеристик: только известные подписи, тексты без чужих чисел.
   * @param {object} answer
   * @param {Set<string>} known
   * @returns {{blocks: object[], rows: object[]}}
   */
  static clean(answer, known) {
    const blocks = (Array.isArray(answer.blocks) ? answer.blocks : [])
      .map(block => ({
        label: this.LABELS.find(label => label === String((block || {}).label || '').trim()) || '',
        text: AsmFacts.keep(String((block || {}).text || '').slice(0, this.BLOCK), known),
      }))
      .filter(block => block.label && block.text);
    const rows = (Array.isArray(answer.rows) ? answer.rows : [])
      .map(row => ({
        k: String((row || {}).k || '')
          .trim()
          .slice(0, this.ROW_KEY),
        v: String((row || {}).v || '')
          .trim()
          .slice(0, this.ROW_VALUE),
      }))
      .filter(row => row.k && row.v && AsmFacts.ok(row.v, known))
      .slice(0, this.ROWS);
    return { blocks, rows };
  }

  /**
   * Тексты и картинки файлов.
   * @param {File[]} files
   * @returns {Promise<Array<{name: string, text: string, imgs: string[], error: string}>>}
   */
  static async read(files) {
    const out = [];
    for (const file of files) {
      const imgs = await AiFileImages.read(file);
      try {
        out.push({ name: file.name, text: await AiFileText.read(file), imgs, error: '' });
      } catch (error) {
        out.push({ name: file.name, text: '', imgs, error: String(error.message || error) });
      }
    }
    return out;
  }

  static _cats() {
    return EquipTypes.list
      .filter(type => !type.station && type.role !== 'accessory')
      .map(
        type =>
          `${type.id} — ${type.name}: ${(type.fields || [])
            .slice(0, this.FIELDS)
            .map(field => `${field.key}${field.unit ? ` (${field.unit})` : ''}`)
            .join(', ')}`,
      )
      .join('\n');
  }

  /**
   * Запрос «Заполнение из техничек».
   * @param {string} cat вид изделия
   * @param {object[]} read файлы (read)
   * @returns {string}
   */
  static filesPrompt(cat, read) {
    const type = EquipTypes.byId(cat);
    const each = Math.floor(this.FILE_CHARS / Math.max(1, read.length));
    const label = ((type.station || {}).mainLabel || 'основное оборудование').toLowerCase();
    const power = cat === 'st_dgu' ? '' : '; power — дизель-генераторная установка для автономности';
    return `ЗАДАЧА: asm-files
Изделие «${type.item || type.name}» собирается из контейнера и оборудования. Из текстов файлов (техничка, КП поставщика, паспорт) выдели части изделия: контейнер и каждую единицу оборудования.
role: container — контейнер или блок-контейнер; main — ${label}; equipment — прочее оборудование${power}.
file — номер файла, из которого взята часть. cat — код категории из списка ниже; attrs — только ключи этой категории, значения — как в файле (число без единицы). rows — характеристики из файла строками «параметр — значение с единицей». desc — краткое описание из файла, без рекламы. cost — цена за единицу из КП поставщика (закупка), числом, и costCur — её валюта (RUB, USD, EUR, CNY); нет цены — 0.
Бери только то, что написано в файлах; нет данных — пустая строка или пустой массив. Не придумывай производителя, модель, числа.
Ответ: {"parts":[{"role":"container","file":1,"name":"…","maker":"…","model":"…","cat":"other","qty":1,"attrs":{},"rows":[{"k":"…","v":"…"}],"desc":"…","cost":0,"costCur":"RUB"}]}
КАТЕГОРИИ:
${this._cats()}
${read.map((file, k) => `ФАЙЛ ${k + 1}: ${file.name}\n${file.text.slice(0, each)}`).join('\n\n')}`;
  }

  /**
   * Части изделия из файлов: проверенные данные для карточек каталога.
   * @param {string} cat
   * @param {object[]} read файлы (read)
   * @returns {Promise<object[]>} [{role, qty, file, doc}]
   */
  static async fromFiles(cat, read) {
    const answer = this.json(await AiDirect.ask(this.filesPrompt(cat, read)));
    return this.parts(answer, read, cat);
  }

  /**
   * Проверка частей ответа по файлам.
   * @param {object} answer
   * @param {object[]} read
   * @param {string} cat
   * @returns {object[]}
   */
  static parts(answer, read, cat) {
    const list = (Array.isArray(answer.parts) ? answer.parts : []).slice(0, this.PARTS);
    const used = new Map();
    return list.map(part => this._part(part || {}, read, cat, used)).filter(Boolean);
  }

  static _part(part, read, cat, used) {
    const index = Math.min(Math.max(1, Math.round(+part.file) || 1), read.length) - 1;
    const file = read[index] || { text: '', imgs: [] };
    const known = AsmFacts.known([file.text]);
    const name = String(part.name || '')
      .trim()
      .slice(0, this.NAME);
    if (!name) return null;
    const role = this._role(part.role, cat);
    const attrs = this._ident(part, role, file.text, known);
    const rows = this._rows(part.rows, known);
    const desc = AsmFacts.keep(String(part.desc || '').slice(0, this.DESC), known);
    const place = used.get(index) || 0;
    used.set(index, place + 1);
    const src = file.imgs[place] || '';
    return {
      role: role === 'power' || role === 'equipment' ? '' : role,
      qty: Math.min(Math.max(1, Math.round(+part.qty) || 1), this.QTY_MAX),
      file: index,
      doc: { ...this._doc({ name, attrs, rows, desc, src }), ...this._cost(part, known) },
    };
  }

  /** категория, параметры категории, производитель и модель — только встречающиеся в файле */
  static _ident(part, role, text, known) {
    const kind = this._cat(part.cat, role);
    const attrs = { cat: kind, ...this._attrs(part.attrs, kind, known) };
    const named = { maker: AsmFacts.word(part.maker, text), model: AsmFacts.word(part.model, text) };
    return { ...attrs, ...Object.fromEntries(Object.entries(named).filter(([, value]) => value)) };
  }

  static _role(role, cat) {
    const found = this.ROLES.includes(role) ? role : 'equipment';
    return found === 'power' && cat === 'st_dgu' ? 'equipment' : found;
  }

  static _cat(cat, role) {
    const type = EquipTypes.list.find(line => line.id === cat && !line.station);
    if (type) return type.id;
    return { power: 'dgu', container: 'container' }[role] || 'other';
  }

  static _attrs(attrs, cat, known) {
    const fields = EquipTypes.byId(cat).fields || [];
    const out = {};
    for (const field of fields) {
      const value = (attrs || {})[field.key];
      if (value == null || value === '' || typeof value === 'object') continue;
      const text = String(value).trim().slice(0, this.ROW_VALUE);
      if (!AsmFacts.ok(text, known)) continue;
      out[field.key] = field.num && Str.num(text) != null && /^[\d\s.,]+$/.test(text) ? Str.num(text) : text;
    }
    return out;
  }

  static _rows(rows, known) {
    return (Array.isArray(rows) ? rows : [])
      .map(row => ({
        k: String((row || {}).k || '')
          .trim()
          .slice(0, this.ROW_KEY),
        v: String((row || {}).v || '')
          .trim()
          .slice(0, this.ROW_VALUE),
      }))
      .filter(row => row.k && row.v && AsmFacts.ok(row.v, known))
      .slice(0, this.PART_ROWS);
  }

  /** закупка из КП поставщика — только число из файла, в копейках */
  static _cost(part, known) {
    const value = Str.num(part.cost);
    const currency = this.CURRENCIES.includes(part.costCur) ? part.costCur : 'RUB';
    if (!(value > 0) || !AsmFacts.ok(String(part.cost), known)) return {};
    return { cost: Math.round(value * this.KOPECKS), costCur: currency };
  }

  static _doc({ name, attrs, rows, desc, src }) {
    return {
      name,
      attrs,
      price: 0,
      priceCur: 'RUB',
      cost: 0,
      costCur: 'RUB',
      features: desc ? [{ label: 'Описание', text: desc }] : [],
      groups: rows.length ? [{ name: 'Основные', rows }] : [],
      photo: src ? { src } : null,
      gallery: [],
      prices: [],
    };
  }
}
