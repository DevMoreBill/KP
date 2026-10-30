import { StationDesign } from './station-design.js';
import { Toast } from '../../core/toast.js';
import { ItemEditor } from '../catalog/item-editor.js';
import { KpState, S } from '../../core/state.js';
import { AiChat, AiDirect } from '../catalog/ai-chat.js';
import { Uid } from '../../core/util.js';
import { AiParse } from '../catalog/ai-parse.js';
import { StationReq } from '../req/station-req.js';
import { ItemSpec } from '../../core/item-spec.js';
import { Attrs } from '../../core/item-attrs.js';
import { EquipTypes } from '../../core/equip-types.js';
import { FieldUnit } from '../../core/field-unit.js';
import { Mm } from '../layout/mm.js';
import { ContainerKind } from '../kit/container-kind.js';
import { Kit } from '../kit/kit.js';
import { StationUi } from './station-ui.js';
import { TankSize } from '../layout/tank-size.js';
import { AirChain } from '../layout/air-chain.js';
import { StationEquip } from '../layout/station-equip.js';
import { UiKit } from '../../core/ui-kit.js';

/**
 * Станция в документе КП: какие элементы состава — карточками с описанием (основные агрегаты), какие характеристики —
 * ключевые; строки характеристик станции, которых нет в таблице.
 */
export class StationDoc {
  /** карточкой с описанием — основные агрегаты; фильтры, обвязка, шкафы, контейнер — только в таблице состава */
  static CARD = /^(compressor|dryer|receiver|dgu|pump|tank)$/;
  static SKIP = /^(страна|модель|марка|производитель(?!н)|серия|бренд|артикул|код|тип контроллера|гарантия|цена)/i;
  static MAX_ROWS = 8;
  /** порядок важности строк карточки: производительность и давление — первыми, габариты и масса — в конце */
  static PRIO = [
    /производительн|подач|пропускн|мощность.*(основн|ном)/i,
    /давлен|напор/i,
    /мощност/i,
    /объ[её]м/i,
    /точк\S* росы|класс|ступен|фильтрац/i,
    /габарит/i,
    /масса|вес/i,
    /шум/i,
    /напряжен|питани/i,
  ];
  static LAST = 99;
  static FLOW_UNIT = 'м³/мин';
  static MASS_STEP = 10;

  /**
   * Карточкой с описанием в КП?
   * @param {object} part элемент состава
   * @returns {boolean}
   */
  static card(part) {
    return this.CARD.test(StationEquip.kindOf(part) || '');
  }

  /**
   * Ключевые характеристики элемента для карточки КП (не больше MAX_ROWS, по важности).
   * @param {object} part
   * @returns {Array<{k: string, v: string}>}
   */
  static rows(part) {
    const kind = StationEquip.kindOf(part) || '';
    const list = (part.rows || []).filter(row => row.k && row.v && !this.SKIP.test(String(row.k).trim()));
    const flow = this._flowRow(part, kind, list);
    if (flow) list.unshift(flow);
    const tank = this._tankRow(part, kind);
    if (tank) list.push(tank);
    const seen = new Set();
    return list
      .map((row, i) => [row, i])
      .sort((first, second) => this._rank(first[0]) - this._rank(second[0]) || first[1] - second[1])
      .map(([row]) => row)
      .filter(row => {
        const key = String(row.k).toLowerCase().replace(/\s+/g, ' ');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, this.MAX_ROWS);
  }

  static _rank(row) {
    const place = this.PRIO.findIndex(pattern => pattern.test(String(row.k)));
    return place < 0 ? this.LAST : place;
  }

  /**
   * производительность компрессора, осушителя и генератора газа — из поля каталога, если строки нет: числом паспорта в
   * единице поля категории (без перевода и округления — в документе заказчика не больше паспорта)
   */
  static _flowRow(part, kind, list) {
    if (!/^(compressor|dryer)$/.test(kind) || list.some(row => this.PRIO[0].test(String(row.k)))) return null;
    const attrs = part.attrs || {};
    const value = StationEquip.num(attrs.flow);
    if (!(value > 0)) return null;
    const gas = kind === 'dryer' && AirChain.info(part, kind).type === 'gen';
    return {
      k: kind === 'dryer' && !gas ? 'Пропускная способность' : 'Производительность',
      v: `${Mm.dec(value)} ${FieldUnit.unit(StationEquip.cat(part), 'flow') || this.FLOW_UNIT}`,
    };
  }

  /** бак без своих габаритов — по расчётному объёму */
  static _tankRow(part, kind) {
    if (kind !== 'tank' || StationEquip.dims(part, kind).known) return null;
    const volume = TankSize.vol(part);
    return volume ? { k: 'Габариты Д × Ш × В', v: TankSize.text(TankSize.of(volume)) } : null;
  }

  /**
   * Первые блоки описания позиции: описание станции (ИИ или своё), «Назначение и состав», «Устройство станции», затем
   * остальные блоки менеджера.
   * @param {object} item
   * @param {object|null} purpose
   * @param {object|null} design
   * @returns {object[]}
   */
  static lead(item, purpose, design) {
    const own = (item.features || []).filter(block => block.label || block.text);
    const brief = own.filter(block => block.label === StationBrief.LABEL);
    const rest = own.filter(block => block.label !== StationBrief.LABEL);
    return [...brief, ...(purpose ? [purpose] : []), ...(design ? [design] : []), ...rest];
  }

  /**
   * Строки характеристик станции, которых нет в таблице: габариты и масса станции, контейнер, исполнение.
   * @param {object} item
   * @param {object[]} groups группы характеристик
   * @returns {object[]}
   */
  static extra(item, groups) {
    const plan = this._plan(item);
    if (!plan) return groups;
    const has = key =>
      groups.some(group => (group.rows || []).some(row => new RegExp(key, 'i').test(String(row.k || ''))));
    const add = this._extraRows(item, plan, has);
    if (!add.length) return groups;
    const out = groups.map(group => ({ ...group, rows: [...(group.rows || [])] }));
    if (out.length) out[0].rows.push(...add);
    else out.push({ name: 'Основные', rows: add });
    return out;
  }

  static _plan(item) {
    if (!StationUi.enabled(item)) return null;
    let plan;
    try {
      plan = StationUi.plan(item);
    } catch {
      return null;
    }
    return !plan || plan.level === 'error' || !plan.geo || !plan.geo.ext ? null : plan;
  }

  static _extraRows(item, plan, has) {
    const container = Kit.container(item) || {};
    const mass = plan.mass;
    const climate = ContainerKind.CLIMATES.find(row => row[0] === container.climate);
    const rows = [];
    if (!has('^Габарит'))
      rows.push({
        k: 'Габариты станции (Д × Ш × В)',
        v: `${plan.geo.ext.map(side => Mm.text(side)).join(' × ')} мм`,
        hl: false,
      });
    if (!has('^Масса') && mass && mass.mass > 0 && !(mass.missing || []).length)
      rows.push({
        k: 'Масса станции',
        v: `около ${Mm.text(Math.round(mass.mass / this.MASS_STEP) * this.MASS_STEP)} кг`,
        hl: false,
      });
    if (!has('^Контейнер'))
      rows.push({
        k: 'Контейнер',
        v: [ContainerKind.of(container.ctype).name, container.ins ? `утепление ${container.ins}` : '']
          .filter(Boolean)
          .join(', '),
        hl: false,
      });
    if (!has('^Климатическое') && climate)
      rows.push({ k: 'Климатическое исполнение', v: `${climate[0]} (${climate[1]})`, hl: false });
    return rows;
  }
}

/**
 * Краткое описание станции нейросетью (вкладка «Описание и фото»): встроенная нейросеть программы или запрос в буфер для
 * ИИ-чата; результат — блок «Описание станции» (вместо шаблонного «Назначение и состав»).
 */
export class StationBrief {
  static LABEL = 'Описание станции';
  static DESC_MAX = 300;
  static TEXT_MAX = 2000;
  static KPI = 4;
  static busy = new Set();

  /**
   * Данные станции для запроса: только то, что есть в составе и компоновке.
   * @param {object} item
   * @returns {string}
   */
  static facts(item) {
    const type = EquipTypes.byId(Attrs.of(item).cat);
    const main = Kit.main(item);
    const lines = [`Изделие: ${type.item || type.name} — «${String(item.name || '').trim()}».`];
    const kpi = ItemSpec.mainLine(item, this.KPI);
    if (kpi) lines.push(`Основные параметры: ${kpi}.`);
    if (main) lines.push(`Основное оборудование: ${main.name}${this._qty(main)}.`);
    const rest = Kit.parts(item).filter(
      part => part !== main && part.role !== 'container' && String(part.name || '').trim(),
    );
    if (rest.length) lines.push(`Состав: ${rest.map(part => part.name.trim() + this._qty(part)).join('; ')}.`);
    lines.push(...this._descs(item));
    const req = StationReq.of(item);
    if (req.industry && StationReq.INDUSTRY_WORD && StationReq.INDUSTRY_WORD[req.industry])
      lines.push(`Отрасль заказчика: ${StationReq.INDUSTRY_WORD[req.industry]}.`);
    const design = StationDesign.items(item);
    if (design.length)
      lines.push(`Устройство станции:\n${design.map(([sec, text]) => `- ${sec}: ${text}`).join('\n')}`);
    return lines.join('\n');
  }

  static _qty(part) {
    return (+part.qty || 1) > 1 ? ` — ${part.qty} шт.` : '';
  }

  /** описания основных агрегатов (до DESC_MAX знаков) */
  static _descs(item) {
    return Kit.parts(item)
      .filter(part => StationDoc.card(part))
      .map(part => [
        part,
        String(part.desc || '')
          .replace(/\s+/g, ' ')
          .slice(0, this.DESC_MAX),
      ])
      .filter(([, desc]) => desc)
      .map(([part, desc]) => `О «${part.name.trim()}»: ${desc}`);
  }

  /**
   * Запрос к нейросети.
   * @param {object} item
   * @returns {string}
   */
  static prompt(item) {
    return `Ты — инженер-технолог компании ПНЕВМОТЕХ (поставка и сборка компрессорных, дизель-генераторных и насосных станций в блок-контейнерах).
Напиши краткое описание станции для технико-коммерческого предложения заказчику: 4–6 предложений, деловой стиль, по-русски.
Что сказать: назначение станции; из чего она состоит и как работает (основные агрегаты и цепочка); устройство контейнера и систем
(коротко); 1–2 преимущества решения (готовая к подключению станция заводской сборки, компактность, автономность и т. п.).
Строго: только факты из данных ниже — без выдуманных чисел, марок и гарантий; без маркетинговых штампов и превосходных степеней;
без вопросов и пометок для заказчика; без списков и заголовков — связный текст.
Ответ — одним JSON: {"text":"…"}

Данные станции:
${this.facts(item)}`;
  }

  /**
   * Ответ нейросети → текст или ''.
   * @param {string} raw
   * @returns {string}
   */
  static parse(raw) {
    const parsed = AiParse.parse(raw);
    if (parsed && parsed.kind === 'json' && parsed.j && typeof parsed.j.text === 'string') return parsed.j.text.trim();
    const text = String(raw || '')
      .replace(/```[a-z]*|```/gi, '')
      .trim();
    return /\{/.test(text) ? '' : text;
  }

  /**
   * Текст — в блок «Описание станции» (первым; прежний такой блок заменяется).
   * @param {object} item
   * @param {string} text
   * @returns {boolean} вставлено
   */
  static apply(item, text) {
    const line = String(text || '')
      .trim()
      .slice(0, this.TEXT_MAX);
    if (!line) return false;
    item.features = item.features || [];
    let block = item.features.find(row => row.label === this.LABEL);
    if (!block) {
      block = { id: Uid.next(), label: this.LABEL, text: '' };
      item.features.unshift(block);
    }
    block.text = line;
    block.ai = true;
    return true;
  }

  /**
   * Блок «Краткое описание станции — ИИ» во вкладке «Описание и фото».
   * @param {object} item
   * @param {number} index
   * @returns {string}
   */
  static html(item, index) {
    const direct = AiDirect.state.enabled;
    const writeButton = direct ? this._goButton(item, index) : '';
    return `<div class="ed-sec sb"><div class="sub">Краткое описание станции — ИИ${UiKit.tip('Нейросеть пишет 4–6 предложений для КП только по данным станции: состав, параметры, устройство контейнера. Результат — блок «Описание станции» ниже, его можно поправить. В КП он стоит первым, вместо шаблонного «Назначение и состав». «Устройство станции» программа собирает сама из компоновки.')}</div>
      <div class="row sb-a">${writeButton}
        ${AiChat.sitesHtml('sbCopy', index, direct ? ' data-alt="1"' : '')}</div>
      ${direct ? '' : `<p class="muted sb-h">Встроенная нейросеть не включена («Настройки → Нейросеть») — скопируйте запрос в ИИ-чат и вставьте ответ:</p>`}
      <details class="ai-pr"${direct ? '' : ' open'}><summary>${direct ? 'Через ИИ-чат в браузере' : 'Ответ ИИ-чата'}</summary><textarea rows="3" data-sbans="${index}" placeholder="Вставьте ответ ИИ-чата"></textarea>
        <div class="row"><button class="btn" type="button" data-sb="paste" data-i="${index}">Вставить в описание</button></div></details></div>`;
  }

  static _goButton(item, index) {
    const busy = this.busy.has(item.id);
    return `<button class="btn primary" type="button" data-sb="go" data-i="${index}"${busy ? ' disabled' : ''}>${this._goLabel(item, busy)}</button>`;
  }

  static _goLabel(item, busy) {
    if (busy) return '<span class="ai-spin" aria-hidden="true"></span> Пишу…';
    const has = (item.features || []).some(block => block.label === this.LABEL && String(block.text || '').trim());
    return has ? '✨ Написать заново' : '✨ Написать описание';
  }

  /**
   * «Написать описание» встроенной нейросетью (кнопка data-sb="go").
   * @param {number} index
   */
  static async write(index) {
    const item = S.items[index];
    if (!item || this.busy.has(item.id)) return;
    this.busy.add(item.id);
    ItemEditor.render();
    try {
      const text = this.parse(await AiDirect.ask(this.prompt(item)));
      if (!this.apply(item, text)) throw new Error('пустой ответ');
      KpState.persist();
      Toast.show('Описание станции написано — проверьте и поправьте при необходимости');
    } catch (error) {
      Toast.show(`Нейросеть не ответила: ${(error && error.message) || error}`);
    } finally {
      this.busy.delete(item.id);
      ItemEditor.render();
    }
  }

  /**
   * «Вставить в описание» — ответ ИИ-чата из поля.
   * @param {number} index
   */
  static paste(index) {
    const item = S.items[index];
    const field = document.querySelector(`[data-sbans="${index}"]`);
    if (!item || !field) return;
    if (!this.apply(item, this.parse(field.value))) {
      Toast.show('Вставьте ответ ИИ-чата');
      return;
    }
    KpState.persist();
    ItemEditor.render();
    Toast.show('Описание станции вставлено');
  }

  /** Кнопки блока: написать, вставить ответ, скопировать запрос для ИИ-чата. */
  static listen() {
    document.addEventListener('click', event => {
      const button = event.target.closest && event.target.closest('[data-sb],[data-a="sbCopy"]');
      if (button) this._click(button, +button.dataset.i);
    });
  }

  static _click(button, index) {
    if (button.dataset.sb === 'go') this.write(index);
    else if (button.dataset.sb === 'paste') this.paste(index);
    else if (button.dataset.a === 'sbCopy') this._copy(button, index);
  }

  static _copy(button, index) {
    const item = S.items[index];
    if (!item) return;
    AiChat.send(this.prompt(item), button.dataset.url, copied =>
      Toast.show(
        copied
          ? 'Запрос скопирован — вставьте его в ИИ-чат, ответ — в поле «Ответ ИИ-чата»'
          : 'Скопируйте запрос вручную',
      ),
    );
  }
}
