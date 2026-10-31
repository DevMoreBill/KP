import { AiChat, AiDirect, AiSource } from './ai-chat.js';
import { AiParse } from './ai-parse.js';
import { AiPrompt } from './ai-prompt.js';
import { AiOptions } from './ai-options.js';
import { Str } from '../../core/str.js';
import { Toast } from '../../core/toast.js';
import { EquipTypes } from '../../core/equip-types.js';
import { Uid, esc } from '../../core/util.js';
import { KpState, S } from '../../core/state.js';
import { DefRegistry } from '../../core/defaults.js';
import { Api } from '../../core/net.js';
import { Attrs } from '../../core/item-attrs.js';
import { KpForm } from '../../core/kp-form.js';
import { Kit } from '../../core/kit.js';
import { CoverSync } from './cover-sync.js';
import { StationLink } from '../../core/station-link.js';
import { CatalogSession } from './catalog-session.js';

/**
 * Заполнение карточки с ИИ: объём — как у карточек этой категории в каталоге (образец — /api/ai/profile), недостающее
 * описание и ключевые характеристики — вторым запросом «дополнить». Дополнение принимается только с указанием источника;
 * приблизительное, повторы и правки уже заполненного отбрасываются; всё дополненное показывается списком «проверьте».
 */
export class AiFill {
  static ctx = {}; // образец категории и данные этой же позиции из каталога: ключ — категория|производитель|наименование
  static SRC = /^(исходные данные|производитель|каталог)/i;
  static VAGUE =
    /≈|~|около|примерно|ориентировочн|уточн|нет данных|н\/д|не указ|неизвестн|зависит от|по запросу|может (быть|отличаться)/i;
  static MIN_TEXT = 40;
  static URL_RE = /^https?:\/\//;

  static _key(item, cat) {
    const attrs = Attrs.of(item);
    return [cat || attrs.cat || '', attrs.maker || '', item.name || '', item.catId || ''].join('|');
  }

  /**
   * Образец категории и данные этой же позиции (с запоминанием).
   * @param {object} item
   * @param {string} [cat]
   * @returns {Promise<{profile: object|null, facts: object[]}>}
   */
  static async context(item, cat) {
    const attrs = Attrs.of(item);
    const key = this._key(item, cat);
    if (this.ctx[key]) return this.ctx[key];
    const query = new URLSearchParams({
      cat: cat || attrs.cat || '',
      maker: attrs.maker || '',
      model: attrs.model || '',
      name: item.name || '',
      id: item.catId || '',
    });
    let answer;
    try {
      answer = await Api.request(`/api/ai/profile?${query}`);
    } catch {
      answer = {};
    }
    this.ctx[key] = { profile: answer.profile || null, facts: answer.facts || [] };
    return this.ctx[key];
  }

  /**
   * Запрос для показа без ожидания: образец уже загружен — с ним, иначе загрузить и перерисовать.
   * @param {object} item
   * @returns {string}
   */
  static promptNow(item) {
    const context = this.ctx[this._key(item)];
    if (!context) this.context(item).then(() => KpForm.render());
    return AiPrompt.main(item, context || {});
  }

  static _str(value) {
    return String(value || '').trim();
  }

  // строка «дополнить» годится: есть название и значение, указан источник, без приблизительного и без повтора
  static _rowOk(row, have) {
    const key = this._str(row && row.k);
    const value = this._str(row && row.v);
    if (!key || !value) return false;
    return this.SRC.test(String(row.src || '')) && !this.VAGUE.test(value) && !have.has(AiPrompt.norm(key));
  }

  static _group(out, name) {
    let group = out.groups.find(one => one && AiPrompt.norm(one.name) === AiPrompt.norm(name));
    if (!group) {
      group = { name, rows: [] };
      out.groups.push(group);
    }
    return group;
  }

  static _addRows(out, rows, added) {
    const have = AiPrompt.keysOf(out);
    for (const row of rows || []) {
      const key = this._str(row && row.k);
      if (!this._rowOk(row, have)) {
        if (key) added.skipped++;
        continue;
      }
      this._group(out, this._str(row.group) || 'Основные').rows.push({ k: key, v: this._str(row.v), hl: false });
      have.add(AiPrompt.norm(key));
      added.rows.push(key);
    }
  }

  static _featOk(feat, labels) {
    const label = this._str(feat && feat.label);
    const text = this._str(feat && feat.text);
    if (text.length < this.MIN_TEXT || !this.SRC.test(String(feat.src || '')) || this.VAGUE.test(text)) return false;
    return !(label && labels.has(AiPrompt.norm(label)));
  }

  static _addFeats(out, feats, added) {
    const labels = new Set((out.features || []).map(feat => AiPrompt.norm(feat && feat.label)));
    out.features = Array.isArray(out.features) ? out.features : [];
    for (const feat of feats || []) {
      const label = this._str(feat && feat.label);
      const text = this._str(feat && feat.text);
      if (!this._featOk(feat, labels)) {
        if (text) added.skipped++;
        continue;
      }
      out.features.push({ label, text });
      labels.add(AiPrompt.norm(label));
      added.features.push(label || 'без названия');
    }
  }

  /**
   * Ответ «дополнить» → в основной ответ: только с источником, без приблизительного и без повторов.
   * @param {object} data основной ответ
   * @param {object} add ответ «дополнить»
   * @returns {object}
   */
  static merge(data, add) {
    const out = JSON.parse(JSON.stringify(data));
    const added = { rows: [], features: [], skipped: 0 };
    out.groups = Array.isArray(out.groups) ? out.groups : [];
    this._addRows(out, add.rows, added);
    this._addFeats(out, add.features, added);
    out.added = added;
    return out;
  }

  /**
   * Ответ в поле шага 3: основной или «дополнить» (сливается с сохранённым основным).
   * @param {object} item
   * @param {string} [text]
   * @returns {object|null}
   */
  static parse(item, text = item._ans) {
    const answer = AiParse.parse(text);
    if (!answer || answer.kind === 'bad' || !answer.j.add) return answer;
    const base = AiParse.parse(item._ansBase || '');
    if (!base || base.kind === 'bad')
      return { kind: 'bad', err: 'Это ответ «дополнить» — сначала нужен основной ответ ИИ.' };
    return { kind: 'json', j: this.merge(base.j, answer.j) };
  }

  static _context(item, data) {
    return this.ctx[this._key(item, data.attrs && data.attrs.cat)] || this.ctx[this._key(item)];
  }

  static _added(added) {
    if (!added || !(added.rows.length || added.features.length)) return '';
    const what = [
      added.features.length ? `описание: ${added.features.join(', ')}` : '',
      added.rows.length ? `характеристики: ${added.rows.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ');
    return `<p class="ai-add">Дополнено — проверьте по паспорту: ${esc(what)}${added.skipped ? ` · отброшено неуверенных: ${esc(added.skipped)}` : ''}.</p>`;
  }

  static _gap(item, data) {
    const context = this._context(item, data);
    const gap = context && AiPrompt.gaps(data, context.profile);
    if (!gap || AiDirect.state.busy[item.id]) return '';
    const button =
      AiDirect.state.enabled && DefRegistry.value('ai.supplement') !== false
        ? ''
        : ` <button class="lnk" type="button" data-a="aiMore" data-i="${S.items.indexOf(item)}">Скопировать запрос «дополнить»</button>`;
    return `<p class="ai-gap">По сравнению с каталогом не хватает: ${esc(AiPrompt.gapsText(gap))}.${button}</p>`;
  }

  /**
   * Что заполнится, что дополнено и чего не хватает.
   * @param {object} item
   * @param {object|null} answer
   * @returns {string}
   */
  static summary(item, answer) {
    const html = AiParse.summary(answer);
    if (!answer || answer.kind === 'bad') return html;
    return html + this._added(answer.j.added) + this._gap(item, answer.j);
  }

  static _empty(item) {
    return !String(item._src || '').trim() && !String(item.name || '').trim();
  }

  static async _page(item) {
    if (String(item._src || '').trim() || !this.URL_RE.test(item._srcUrl || item.pageUrl || '')) return;
    item._srcUrl = item._srcUrl || item.pageUrl;
    item._aiMsg = 'Загружаю страницу товара — это достоверный источник…';
    KpForm.render();
    await AiSource.fetchInto(item);
  }

  static async _supplement(item, data, { gap, context, who }) {
    item._aiMsg = `Не хватает: ${AiPrompt.gapsText(gap)} — ${who} ищет достоверные данные…`;
    KpForm.render();
    try {
      const add = AiParse.parse(await AiDirect.ask(AiPrompt.supplement(item, data, gap, context)));
      if (add && add.kind !== 'bad') return this.merge(data, add.j);
    } catch (error) {
      item._aiMsg = String(error.message || error);
    }
    return data;
  }

  static _done(data, profile) {
    const added = data.added;
    const left = AiPrompt.gaps(data, profile);
    const more =
      added && (added.rows.length || added.features.length)
        ? `, дополнено: ${added.features.length} ${KPGen.plural(added.features.length, 'блок', 'блока', 'блоков')} описания и ${added.rows.length} ${KPGen.plural(added.rows.length, 'характеристика', 'характеристики', 'характеристик')}`
        : '';
    const none = left ? `. Достоверных данных не нашлось: ${AiPrompt.gapsText(left)} — оставлено пустым` : '';
    return `Ответ получен${more}${none}. Проверьте, что заполнится, и нажмите «Заполнить карточку».`;
  }

  static async _run(item, who) {
    await this._page(item);
    item._aiMsg = `${who} заполняет карточку… обычно 20–60 секунд`;
    KpForm.render();
    const context = await this.context(item);
    const raw = await AiDirect.ask(AiPrompt.main(item, context));
    const answer = AiParse.parse(raw);
    if (!answer || answer.kind === 'bad') {
      item._ans = raw;
      item._aiStep = 3;
      item._aiMsg = answer ? answer.err : 'Пустой ответ — повторите';
      return;
    }
    const cat = (answer.j.attrs && answer.j.attrs.cat) || Attrs.of(item).cat;
    const full = await this.context(item, cat);
    const gap = AiPrompt.gaps(answer.j, full.profile);
    let data = answer.j;
    if (gap && DefRegistry.value('ai.supplement') !== false)
      data = await this._supplement(item, data, { gap, context: full, who });
    item._ans = JSON.stringify(data, null, 1);
    item._aiStep = 3;
    item._aiMsg = this._done(data, full.profile);
  }

  /**
   * Нейросеть в программе: основной запрос, затем «дополнить», если не хватает.
   * @param {number} i позиция КП
   */
  static async auto(i) {
    const item = S.items[i];
    if (!item || AiDirect.state.busy[item.id]) return;
    if (this._empty(item)) {
      item._aiMsg = 'Сначала шаг 1: ссылка, текст или хотя бы модель в наименовании.';
      KpForm.render();
      return;
    }
    AiDirect.state.busy[item.id] = true;
    try {
      await this._run(item, AiDirect.state.provider || 'Нейросеть');
    } catch (error) {
      item._aiMsg = String(error.message || error);
    } finally {
      delete AiDirect.state.busy[item.id];
      KpForm.render();
      KpState.persist();
    }
  }

  /**
   * ИИ-чат в браузере: скопировать запрос (и открыть сайт).
   * @param {number} i
   * @param {string} url
   */
  static copy(i, url) {
    const item = S.items[i];
    if (this._empty(item)) {
      item._aiMsg = 'Сначала шаг 1: ссылка, текст или хотя бы модель.';
      KpForm.render();
      return;
    }
    const context = this.ctx[this._key(item)] || {}; // образец уже загружен при показе вкладки; копирование — сразу
    AiChat.send(AiPrompt.main(item, context), url, ok => {
      const where = url ? ' — вставьте его (Ctrl+V) в открывшемся окне ИИ и отправьте' : ' — вставьте его в любой ИИ';
      item._aiMsg = ok
        ? `Запрос скопирован${where}. Ответ скопируйте целиком и вставьте в шаг 3.`
        : 'Скопируйте запрос из окна.';
      item._aiStep = 3;
      item._ansBase = '';
      KpForm.render();
      KpState.persist();
    });
  }

  /**
   * Скопировать запрос «дополнить».
   * @param {number} i
   */
  static more(i) {
    const item = S.items[i];
    const answer = AiParse.parse(item._ans);
    if (!answer || answer.kind === 'bad') return;
    const context = this._context(item, answer.j);
    const gap = context && AiPrompt.gaps(answer.j, context.profile);
    if (!gap) return;
    AiChat.send(AiPrompt.supplement(item, answer.j, gap, context), '', ok => {
      item._ansBase = item._ans;
      item._ans = '';
      item._aiMsg = ok
        ? 'Запрос «дополнить» скопирован — отправьте его в том же чате, ответ вставьте в шаг 3: он добавится к основному.'
        : 'Скопируйте запрос из окна.';
      KpForm.render();
      KpState.persist();
    });
  }

  /**
   * «Заполнить карточку».
   * @param {number} i
   */
  static apply(i) {
    AiApply.run(S.items[i], this.parse(S.items[i]));
  }

  /** Ответ шага 3 разбирается при вставке, без перерисовки окна. */
  static listen() {
    document.addEventListener('input', event => {
      const field = event.target;
      if (field.dataset.aians == null) return;
      const i = +field.dataset.aians;
      const item = S.items[i];
      const answer = item ? this.parse(item, field.value) : AiParse.parse(field.value);
      const preview = document.querySelector(`[data-aiprev="${i}"]`);
      const button = document.querySelector(`[data-aiok="${i}"]`);
      if (preview) preview.innerHTML = item ? this.summary(item, answer) : AiParse.summary(answer);
      if (button) button.disabled = !(answer && answer.kind !== 'bad');
    });
  }
}

/** Ответ ИИ → в карточку: «не менять уже заполненное», параметры, станция по ТЗ. */
class AiApply {
  static _texts(item, data, keep) {
    const empty = value => !String(value || '').trim();
    for (const key of ['name', 'spec', 'pageTitle', 'photoCaption']) {
      if (data[key] && (!keep || empty(item[key]))) item[key] = String(data[key]);
    }
  }

  static _feats(item, data, keep) {
    const feats = (data.features || [])
      .filter(feat => feat && (feat.label || feat.text))
      .map(feat => ({ id: Uid.next(), label: String(feat.label || ''), text: String(feat.text || '') }));
    if (feats.length && (!keep || !(item.features || []).some(feat => feat.text))) item.features = feats;
    return feats.length;
  }

  static _groups(item, data, keep) {
    const groups = (data.groups || [])
      .filter(group => group && Array.isArray(group.rows))
      .map(group => ({
        name: String(group.name || ''),
        rows: group.rows
          .filter(row => row && (row.k || row.v))
          .map(row => ({ k: String(row.k || ''), v: String(row.v ?? ''), hl: !!row.hl })),
      }))
      .filter(group => group.rows.length);
    const filled = (item.groups || []).some(group => (group.rows || []).some(row => row.v));
    if (groups.length && (!keep || !filled)) item.groups = groups;
    return groups.length;
  }

  static _note(added) {
    const more =
      added && (added.rows.length || added.features.length)
        ? ` Дополненное ИИ сверьте с паспортом: ${[...added.features, ...added.rows].join(', ')}.`
        : '';
    return `Карточка заполнена — проверьте вкладки «Основное», «Описание и фото», «Характеристики».${more}`;
  }

  // титул, параметры, станция по ТЗ
  static _rest(item, data, keep) {
    if (data.cover && typeof data.cover === 'object' && !CatalogSession.current) {
      item.hint = data.cover;
      CoverSync.run();
    }
    if (data.attrs && typeof data.attrs === 'object') AiAttrs.apply(item, data.attrs, { keep });
    if (EquipTypes.byId(Attrs.of(item).cat).station) AiAttrs.station(item, data);
  }

  /**
   * Заполнить карточку из разобранного ответа.
   * @param {object} item
   * @param {object|null} answer
   */
  static run(item, answer) {
    if (!answer || answer.kind === 'bad') {
      item._aiMsg = answer ? answer.err : 'Вставьте ответ ИИ в поле шага 3.';
      KpForm.render();
      return;
    }
    const data = answer.j;
    const keep = !!(item._aiKeep ?? DefRegistry.value('ai.keep'));
    this._texts(item, data, keep);
    const feats = this._feats(item, data, keep);
    const groups = this._groups(item, data, keep);
    this._rest(item, data, keep);
    const extra = EquipTypes.byId(Attrs.of(item).cat).station ? null : AiOptions.apply(item, data);
    if (feats || groups || (extra && extra.complect)) item.page = true;
    item._ans = '';
    item._ansBase = '';
    item._aiStep = 0;
    item._aiMsg = this._note(data.added) + (extra ? AiOptions.note(extra) : '');
    KpForm.render();
    KpState.persist();
    Toast.show('Карточка заполнена из ответа ИИ');
  }
}

/** Параметры из ответа ИИ и станция по ТЗ (требования к контейнеру, недостающие элементы). */
class AiAttrs {
  static _filled(attrs) {
    return Object.fromEntries(Object.entries(attrs || {}).filter(([, value]) => value !== '' && value != null));
  }

  static _cat(item, keepCat) {
    const known = EquipTypes.list.some(type => type.id === item.attrs.cat);
    if (keepCat && (EquipTypes.byId(keepCat).station || !known))
      item.attrs.cat = keepCat; // станцию ИИ не переклассифицирует
    else if (!known) delete item.attrs.cat;
  }

  /**
   * Параметры: «не менять уже заполненное» — заполненное остаётся.
   * @param {object} item
   * @param {object} attrs
   * @param {{keep: boolean}} mode
   */
  static apply(item, attrs, { keep }) {
    const keepCat = (item.attrs || {}).cat;
    const add = Object.fromEntries(
      Object.entries(attrs)
        .filter(([, value]) => value !== '' && value != null && !String(value).includes(' | '))
        .map(([key, value]) => [key, String(value)]),
    );
    item.attrs = keep ? { ...add, ...this._filled(item.attrs) } : { ...(item.attrs || {}), ...add };
    this._cat(item, keepCat);
    const type = EquipTypes.byId(item.attrs.cat || keepCat);
    for (const field of type.fields) {
      if (!field.num || item.attrs[field.key] == null) continue;
      const num = Str.num(item.attrs[field.key]);
      item.attrs[field.key] = num != null ? num : item.attrs[field.key];
    }
  }

  static _rows(rows) {
    return (rows || []).filter(row => row && row.k && row.v).map(row => ({ k: String(row.k), v: String(row.v) }));
  }

  static _container(parts, rows) {
    if (!rows.length) return;
    let container = parts.find(part => part.role === 'container');
    if (!container) {
      container = StationLink.container('welded');
      parts.push(container);
    }
    for (const row of rows) {
      const old = container.rows.find(one => Str.norm(one.k) === Str.norm(row.k));
      if (old) old.v = row.v;
      else container.rows.push(row);
    }
  }

  /**
   * Станция по ТЗ: требования к контейнеру — в его характеристики, недостающие элементы — в состав.
   * @param {object} item
   * @param {object} data
   */
  static station(item, data) {
    item.kit = item.kit || { parts: [] };
    const parts = item.kit.parts;
    const have = new Set(parts.map(part => Str.norm(part.name)));
    this._container(parts, this._rows(data.container && data.container.rows));
    for (const part of data.parts || []) {
      if (!part || !String(part.name || '').trim() || have.has(Str.norm(part.name))) continue;
      have.add(Str.norm(part.name));
      parts.push(
        Kit.newPart({
          name: String(part.name).trim(),
          qty: +part.qty > 0 ? +part.qty : 1,
          desc: String(part.desc || ''),
          rows: this._rows(part.rows),
        }),
      );
    }
    StationLink.autoFill(item);
  }
}
