import { AiOptions } from './ai-options.js';
import { Attrs } from '../../core/item-attrs.js';
import { EquipTypes } from '../../core/equip-types.js';
import { DefRegistry } from '../../core/defaults.js';
import { Kit } from '../../core/kit.js';
/**
 * Запросы к ИИ для карточки оборудования: основной (объём — как у карточек категории в каталоге) и «дополнить» (только
 * недостающее, только с источником). Чего не хватает — по сравнению с образцом категории (/api/ai/profile).
 */
export class AiPrompt {
  static PERCENT = 100;
  static MIN_FEATS = 2;
  static FEATS_SHARE = 0.7;
  static CHARS_SHARE = 0.5;
  static ROWS_SHARE = 0.6;
  static KEYS_SHOWN = 8;

  /**
   * Доля карточек категории, у которых есть характеристика, чтобы она считалась «ключевой» (ai.keyShare, 50 %).
   * @returns {number}
   */
  static get KEY_SHARE() {
    return DefRegistry.num('ai.keyShare', 50) / this.PERCENT;
  }

  /**
   * Название характеристики для сравнения.
   * @param {string} key
   * @returns {string}
   */
  static norm(key) {
    return String(key || '')
      .replace(/\s*[,(].*$/, '')
      .replace(/ё/g, 'е')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Заполненные характеристики ответа.
   * @param {object} data
   * @returns {Set<string>}
   */
  static keysOf(data) {
    const rows = [...(data.groups || []).flatMap(group => (group && group.rows) || []), ...(data.rows || [])];
    return new Set(rows.filter(row => row && row.k && String(row.v ?? '').trim()).map(row => this.norm(row.k)));
  }

  /**
   * Объём — словами для запроса.
   * @param {object|null} profile образец категории
   * @returns {string}
   */
  static volume(profile) {
    if (!profile) {
      return 'features — 3–6 блоков по 2–4 предложения; groups — все характеристики из исходных данных, сгруппированные по смыслу.';
    }
    const keys = profile.keys.filter(key => key.share >= this.KEY_SHARE).map(key => key.k);
    const labels = profile.labels.length ? `, типичные темы блоков: ${profile.labels.join('; ')}` : '';
    const groups = profile.groups > 1 ? ` в ${profile.groups} группах (${profile.groupNames.join('; ')})` : '';
    return `Объём — как у карточек этой категории в каталоге программы (по ${profile.cards} карточкам): описание — около ${profile.features} ${KPGen.plural(profile.features, 'блока', 'блоков', 'блоков')} по ~${profile.blockChars} знаков (всего ~${profile.descChars})${labels}; характеристики — около ${profile.rows} строк${groups}.
Характеристики, которые есть у большинства карточек категории, — заполни каждую, для которой есть достоверное значение: ${keys.join('; ') || '—'}.
Если достоверных данных меньше, дай меньше — объём не повод придумывать.`;
  }

  /**
   * Данные этой же позиции из каталога — текстом.
   * @param {object[]} facts
   * @returns {string}
   */
  static factsText(facts) {
    return (facts || [])
      .map(
        fact =>
          `«${fact.name}»:\n${fact.rows.map(row => `${row[0]}: ${row[1]}`).join('\n')}${fact.text ? `\n${fact.text}` : ''}`,
      )
      .join('\n\n');
  }

  static _field(field) {
    const values = field.values && field.values.length ? ` — одно из: ${field.values.join(' | ')}` : '';
    return `"${field.key}":"${field.label}${field.unit ? `, ${field.unit}` : ''}${values}${field.num ? ' (только число)' : ''}"`;
  }

  static _station(type, parts) {
    if (!type.station || !parts.length) return '';
    return `\nЭто ${type.item.toLowerCase()} в контейнере, в составе: ${parts.map(part => part.name + (+part.qty > 1 ? ` × ${part.qty}` : '')).join('; ')}.`;
  }

  static _json(type) {
    const station = type.station
      ? `,
"container":{"rows":[{"k":"Раздел — параметр (например «Стены — наружная обшивка»)","v":"требование"}]},
"parts":[{"name":"элемент станции (кроме контейнера), например «Шкаф АВР»","qty":1,"desc":"что требуется","rows":[{"k":"Параметр","v":"значение"}]}]`
      : '';
    return `{"name":"полное наименование, например «${type.item} …»",
"spec":"ключевые характеристики одной строкой через « · », до ${Math.round(DefRegistry.num('ai.specLen', 90))} символов",
"pageTitle":"заголовок страницы оборудования",
"features":[{"label":"Узел или особенность","text":"2–4 предложения по существу"}],
"groups":[{"name":"Основные","rows":[{"k":"Параметр, ед.","v":"значение","hl":true}]}],
"cover":{"title":"${type.coverTitle || type.name}","model":"марка и модель","desc":"1–2 предложения для титульного листа","kpis":[{"num":"число","unit":"ед.","cap":"что это"}]},
"attrs":{"cat":"${type.id}","maker":"производитель","series":"серия","model":"модель",${type.fields.map(field => this._field(field)).join(',')}}${station}${AiOptions.json(type)}}`;
  }

  static _rules(type) {
    const types = EquipTypes.list
      .filter(known => !known.station)
      .map(known => `${known.id} — ${known.name}`)
      .join('; ');
    const station = type.station
      ? ' features — о контейнере, основном оборудовании и системах станции; если исходные данные — техническое задание заказчика: в container — все требования к контейнеру (корпус, обшивка, утепление, окраска, вентиляция, освещение, ОПС, пожаротушение, шум, климат), в parts — все требуемые элементы и опции станции, кроме контейнера и основного оборудования (АВР, подогреватели, глушитель, топливная система, мониторинг и т. п.);'
      : '';
    const other = type.station ? '' : ` Если оборудование другого типа, укажи attrs.cat из списка: ${types}.`;
    return `Правила:${station} groups — характеристики, сгруппированные по смыслу; hl=true — только у 2–4 главных параметров; kpis — ровно 4 главных числовых параметра; в attrs числовые поля — только число без единиц.${other}${AiOptions.rule(type)}`;
  }

  /**
   * Основной запрос.
   * @param {object} item
   * @param {{profile?: object, facts?: object[]}} [context] образец категории и данные позиции из каталога
   * @returns {string}
   */
  static main(item, context = {}) {
    const type = EquipTypes.byId(Attrs.of(item).cat);
    const parts = Kit.parts(item).filter(part => part.name);
    const facts = this.factsText(context.facts);
    const known = facts
      ? `

ДАННЫЕ ЭТОЙ ЖЕ ПОЗИЦИИ ИЗ КАТАЛОГА ПРОГРАММЫ (проверены, можно брать как есть):
${facts}`
      : '';
    return `Ты — инженер, готовишь технико-коммерческое предложение на русском языке.
Оборудование: ${type.item || type.name}${item.name ? ` — «${item.name}»` : ''}.${this._station(type, parts)}
Задача: разнести данные по полям карточки. Источники — исходные данные ниже (и приложенные файлы или скриншоты, если есть) и опубликованные данные производителя ИМЕННО этой модели и исполнения (паспорт, каталог, официальный сайт), в которых ты уверен. Не бери значения у соседних моделей и исполнений, не рассчитывай и не округляй; нет достоверных данных — пустая строка "" или пустой массив []. Значения — с единицами измерения, десятичный разделитель — запятая.

Ответ — строго один JSON-объект в блоке кода, без пояснений до и после:
\`\`\`json
${this._json(type)}
\`\`\`
${this.volume(context.profile)}
${this._rules(type)}

ИСХОДНЫЕ ДАННЫЕ:
${String(item._src || '').trim() || '(только наименование выше — данные производителя по этой модели; не уверен в значении — оставь пустым)'}${known}`;
  }

  /**
   * Чего не хватает по сравнению с образцом (или null).
   * @param {object} data ответ ИИ
   * @param {object|null} profile
   * @returns {object|null}
   */
  static gaps(data, profile) {
    if (!data || !profile) return null;
    const feats = (data.features || []).filter(feat => feat && String(feat.text || '').trim());
    const chars = feats.reduce((sum, feat) => sum + String(feat.text).length, 0);
    const have = this.keysOf(data);
    const keys = profile.keys
      .filter(key => key.share >= this.KEY_SHARE && !have.has(this.norm(key.k)))
      .map(key => key.k);
    const desc =
      feats.length < Math.max(this.MIN_FEATS, Math.round(profile.features * this.FEATS_SHARE)) ||
      chars < profile.descChars * this.CHARS_SHARE;
    const rows = have.size < profile.rows * this.ROWS_SHARE;
    if (!desc && !rows && !keys.length) return null;
    const labels = profile.labels.filter(label => !feats.some(feat => this.norm(feat.label) === this.norm(label)));
    return { desc, rows, keys, labels, feats: feats.length, chars, have: have.size };
  }

  static _rowsGap(gap) {
    if (gap.keys.length) {
      const more = gap.keys.length - this.KEYS_SHOWN;
      const keys = more > 0 ? `${gap.keys.slice(0, this.KEYS_SHOWN).join(', ')} и ещё ${more}` : gap.keys.join(', ');
      return `характеристики: ${keys}`;
    }
    return gap.rows ? `характеристики (сейчас ${gap.have} строк)` : '';
  }

  /**
   * Чего не хватает — словами.
   * @param {object} gap
   * @returns {string}
   */
  static gapsText(gap) {
    const desc = gap.desc
      ? `описание (сейчас ${gap.feats} ${KPGen.plural(gap.feats, 'блок', 'блока', 'блоков')}, ~${gap.chars} знаков)`
      : '';
    return [desc, this._rowsGap(gap)].filter(Boolean).join('; ');
  }

  static _need(gap, profile) {
    const desc = gap.desc
      ? `— описания: нужно около ${profile.features} ${KPGen.plural(profile.features, 'блока', 'блоков', 'блоков')} по ~${profile.blockChars} знаков (всего ~${profile.descChars}); добавь недостающие блоки${gap.labels.length ? ` (типичные темы: ${gap.labels.join('; ')})` : ''};\n`
      : '';
    const keys = gap.keys.length ? `— характеристик: ${gap.keys.join('; ')};\n` : '';
    const rows =
      gap.rows && !gap.keys.length
        ? `— характеристик: у карточек категории их около ${profile.rows}, сейчас ${gap.have};\n`
        : '';
    return desc + keys + rows;
  }

  static _who(data, item) {
    const attrs = data.attrs;
    return `«${data.name || item.name || ''}»${attrs && attrs.maker ? `, производитель ${attrs.maker}` : ''}${attrs && attrs.model ? `, модель ${attrs.model}` : ''}`;
  }

  /**
   * Запрос «дополнить».
   * @param {object} item
   * @param {object} data основной ответ
   * @param {object} gap чего не хватает
   * @param {{profile: object, facts?: object[]}} context
   * @returns {string}
   */
  static supplement(item, data, gap, context) {
    const filled = [...this.keysOf(data)].join('; ');
    const labels = (data.features || [])
      .map(feat => feat && feat.label)
      .filter(Boolean)
      .join('; ');
    const facts =
      context.facts && context.facts.length
        ? `\n\nДАННЫЕ ЭТОЙ ЖЕ ПОЗИЦИИ ИЗ КАТАЛОГА ПРОГРАММЫ:\n${this.factsText(context.facts)}`
        : '';
    return `Ты дополняешь карточку оборудования для технико-коммерческого предложения на русском языке: ${this._who(data, item)}.
Уже заполнено — НЕ повторяй и НЕ меняй: характеристики: ${filled || '—'}; блоки описания: ${labels || '—'}.
Не хватает (по образцу карточек этой категории в каталоге):
${this._need(gap, context.profile)}
Источники — только исходные данные ниже и опубликованные данные производителя ИМЕННО этой модели и исполнения (паспорт, каталог, официальный сайт).
Строгие правила:
— добавляй значение, только если уверен, что оно верно для этой модели и исполнения; не бери у соседних моделей, серий и исполнений, не рассчитывай, не округляй;
— не уверен — не добавляй строку или блок вовсе (никаких «нет данных», «около», «уточняйте»);
— описание — только факты об этой модели (конструкция, узлы, комплектация, назначение), без рекламы;
— у каждой строки и каждого блока укажи "src": "исходные данные" или "производитель".
Ответ — строго один JSON-объект в блоке кода:
\`\`\`json
{"add":true,"features":[{"label":"тема","text":"2–4 предложения","src":"производитель"}],"rows":[{"group":"название группы","k":"Параметр, ед.","v":"значение","src":"исходные данные"}]}
\`\`\`
ИСХОДНЫЕ ДАННЫЕ:
${String(item._src || '').trim() || '(только наименование выше)'}${facts}`;
  }
}
