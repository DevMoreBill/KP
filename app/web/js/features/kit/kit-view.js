import { Kit } from './kit.js';
import { KitCabinet, KitPipe } from './kit-fields.js';
import { KitContainer } from './kit-container.js';
import { KitNeed } from './kit-need.js';
import { KitScope } from './kit-scope.js';

/**
 * Вкладка «Состав станции»: подбор станции, контейнер одной строкой, оборудование двумя группами по стороне поставки
 * («Наше оборудование» и «Сборщик контейнера»); каждый элемент — строка таблицы, подробности — по раскрытию строки.
 */
export class KitView {
  static open = new Set(); // раскрытые строки (id элементов)
  static SYS = /отоплен|вентиляц|освещен|электроснабж|сигнализац|пожаротуш|шумо/i; // системы контейнера — не элементы
  static pos = new Map(); // id элемента → номер позиции на чертеже (при отрисовке вкладки)
  static SUPS_MAX = 400;
  static LABEL_PREFIX = 5;
  static MAIN_LINE = 3;
  static TANK_DEFAULT = 1000;
  static NOT_DRAWN = /^(skip|piping|chassis|container|)$/;
  static LEAD = {
    our: 'привозим на сборку сами',
    asm: 'шкафы, трубопровод, обвязка, системы безопасности — по ТЗ на сборку',
  };
  static EMPTY = {
    our: 'Нет оборудования — выберите ниже.',
    asm: 'Пока ничего — по умолчанию сборщик делает контейнер и его системы.',
  };
  static ACTIONS = { kitOpen: '_toggle', kitBy: '_scope', reqPickX: '_hidePick', reqReset: '_resetExpert' };
  static NEED_ACTIONS = ['kitNeed', 'kitNeedAll', 'kitSwap'];

  /**
   * Вкладка «Состав станции».
   * @param {object} item позиция КП
   * @param {number} index
   * @returns {string}
   */
  static render(item, index) {
    const parts = Kit.parts(item);
    const station = Kit.station(item);
    if (!station && !parts.length) {
      return `<div class="ed-sec"><p class="muted">Состав есть только у станций в контейнере. Чтобы собрать станцию, выберите категорию «Насосные / Компрессорные / Дизель-генераторные станции в контейнере» на вкладке «Основное».</p></div>`;
    }
    StationReq.ensure(item);
    const container = Kit.container(item);
    const rows = parts.map((part, j) => [part, j]).filter(([part]) => part.role !== 'container');
    const our = rows.filter(([part]) => KitScope.of(part) === 'our');
    const asm = rows.filter(([part]) => KitScope.of(part) === 'asm');
    const sups = this._sups();
    this.pos = new Map(
      StationEquip.list(parts)
        .filter(entry => entry.pos)
        .map(entry => [entry.id, entry.pos]),
    );
    const ctx = { item, index, station };
    return `<div class="ed-sec kit2">
      ${station ? StationQuick.html(item, index) : ''}
      ${container ? KitContainer.html(item, index, container, parts.indexOf(container)) : KitContainer.pick(index)}
      ${station && !Kit.main(item) ? this._mainTodo(index, station) : ''}
      ${this._group(ctx, 'our', our)}
      ${this._group(ctx, 'asm', asm)}
      <datalist id="kitSupL">${sups.map(sup => `<option value="${esc(sup)}">`).join('')}</datalist>
      ${this._sum(item, index)}</div>`;
  }

  static _sups() {
    const deal = (typeof DealUi !== 'undefined' && DealUi.sups) || [];
    const names = [...deal.map(sup => sup.name), ...catCache.map(card => attrsOf(card).maker)].filter(Boolean);
    return [...new Set(names)].slice(0, this.SUPS_MAX);
  }

  static _mainTodo(index, station) {
    return `<div class="kit-todo"><b>${esc(station.mainLabel)}</b><span class="muted">Основное оборудование станции — из каталога (с описанием, характеристиками, фото и закупкой) или своё.</span>
        <div class="row"><button class="btn primary" type="button" data-a="kitMain" data-i="${index}">Выбрать в каталоге</button><button class="btn ghost" type="button" data-a="kitAdd" data-i="${index}" data-n="${esc(station.mainLabel)}" data-role="main">+ Своё</button></div></div>`;
  }

  /**
   * Система контейнера включена: своё значение, иначе по умолчанию (рекуперация — у компрессорных и ДГУ).
   * @param {object} item
   * @param {object} part контейнер
   * @param {string} id система
   * @returns {boolean}
   */
  static sysOn(item, part, id) {
    const value = (part.sys || {})[id];
    return value ?? (id === 'rec' ? StationReq.kind(item) !== 'pump' : !!ContainerKind.SYSTEMS_ON[id]);
  }

  // группа элементов: таблица строк, «Нужно: …» и кнопки добавления (чего ещё нет и что не закрывает «Нужно»)
  static _group(ctx, scope, rows) {
    const { item, index } = ctx;
    const need = KitNeed.rows(item, index, scope);
    const table =
      rows.length || need ? this._table(ctx, scope, rows, need) : `<p class="muted kit-empty">${this.EMPTY[scope]}</p>`;
    return `<section class="kit-grp ${scope}"><h4>${KitScope.LABEL[scope]} <small class="muted">— ${this.LEAD[scope]}</small></h4>
      ${table}
      <div class="kit-add">${this._presets(ctx, scope)}
        <button class="chip sm ghost" type="button" data-a="kitCat" data-i="${index}" data-by="${scope}">+ Из каталога</button><button class="chip sm ghost" type="button" data-a="kitAdd" data-i="${index}" data-by="${scope}">+ Своё</button></div></section>`;
  }

  static _table(ctx, scope, rows, need) {
    const { item, index } = ctx;
    const head = rows.length
      ? `<div class="kt-r kt-head" role="row"><span title="Номер позиции на габаритном чертеже">Поз.</span><span>Наименование</span><span>Кол.</span><span>Закупка за ед.</span><span>Поставщик</span><span></span></div>`
      : '';
    return `<div class="kit-t" role="table">
        ${head}
        ${rows.map(([part, j]) => this._row({ ...ctx, scope }, part, j)).join('')}${need}</div>${scope === 'our' ? KitNeed.allBtn(item, index) : ''}`;
  }

  static _presets({ item, index, station }, scope) {
    const recs = KitNeed.recs(item).filter(rec => (rec.by || 'our') === scope);
    const needCats = new Set(recs.map(rec => rec.cat).filter(Boolean));
    const hidden = name => recs.some(rec => rec.match && rec.match.test(name));
    const parts = Kit.parts(item);
    const have = new Set(parts.map(part => norm(part.name)));
    // осушитель и ресивер уже есть — не предлагать
    const kinds = new Set(
      parts.map(part => StationEquip.kindOf(part)).filter(kind => kind === 'dryer' || kind === 'receiver'),
    );
    return (station ? station.parts : Kit.PRESETS)
      .map(preset => (Array.isArray(preset) ? preset : [preset, '']))
      .filter(([name, cat]) => {
        const sample = { name, attrs: { cat } };
        if (have.has(norm(name)) || KitScope.def(sample) !== scope || this.SYS.test(name)) return false;
        return !kinds.has(StationEquip.kindOf(sample)) && !needCats.has(cat) && !hidden(name);
      })
      .map(([name, cat]) => this._presetChip(index, scope, name, cat))
      .join('');
  }

  static _presetChip(index, scope, name, cat) {
    const title = cat
      ? `Подобрать в каталоге: ${esc(typeById(cat).name)}`
      : 'Найти в каталоге или добавить новым элементом';
    return `<button class="chip sm" type="button" data-a="kitPreset" data-i="${index}" data-n="${esc(name)}" data-cat="${esc(cat)}" data-by="${scope}" title="${title}">+ ${esc(name)}</button>`;
  }

  static _row(ctx, part, j) {
    const { item, index, scope } = ctx;
    const path = `items.${index}.kit.parts.${j}`;
    const open = this.open.has(part.id);
    const last = Kit.parts(item).length - 1;
    const role = part.role === 'main' ? '<span class="kit-role main">основное</span>' : '';
    return `<div class="kt-r${open ? ' open' : ''}${part.name ? '' : ' need'}" role="row" data-kitj="${j}">
      <span class="kt-n" title="${this.pos.has(part.id) ? 'Позиция на габаритном чертеже' : 'На чертеже не показывается'}">${this.pos.get(part.id) || '·'}</span>
      <span class="kt-nm">${role}<input type="text" data-p="${path}.name" value="${esc(part.name)}" placeholder="Название элемента" aria-label="Название элемента"${part.name ? '' : ' class="need"'}>${this.sub(part, StationEquip.kindOf(part))}</span>
      <span class="kt-q"><input type="text" inputmode="numeric" data-p="${path}.qty" value="${esc(part.qty)}" aria-label="Количество"></span>
      <span class="kit-cost"><input type="text" inputmode="decimal" data-kitcost="${index}.${j}" value="${esc(KitContainer.costText(part))}" placeholder="${scope === 'asm' ? 'в цене сборки' : 'цена из счёта'}" aria-label="Закупка за единицу">${KitContainer.currency(index, j, part)}</span>
      <span class="kt-s"><input type="text" list="kitSupL" data-p="${path}.sup" value="${esc(part.sup || '')}" placeholder="${esc(this._supHint(item, part, scope))}" aria-label="Поставщик"></span>
      ${this._buttons({ index, part, j, open, last })}
      ${open ? this._details(ctx, part, j) : ''}</div>`;
  }

  static _buttons({ index, part, j, open, last }) {
    const swap = KitNeed.canSwap(part)
      ? `<button class="icon" type="button" data-a="kitSwap" data-i="${index}" data-j="${j}" title="Заменить: окно каталога с фильтрами по требованиям станции" aria-label="Заменить из каталога">⇄</button>`
      : '';
    return `<span class="kt-a"><button class="icon" type="button" data-a="kitOpen" data-i="${index}" data-j="${j}" aria-expanded="${open}" title="${open ? 'Свернуть' : 'Описание, характеристики, фото, рисунок для чертежа'}">${open ? '▾' : '▸'}</button>
        ${swap}
        <button class="icon" type="button" data-a="kitMv" data-i="${index}" data-j="${j}" data-d="-1" ${j ? '' : 'disabled'} aria-label="Выше">↑</button><button class="icon" type="button" data-a="kitMv" data-i="${index}" data-j="${j}" data-d="1" ${j < last ? '' : 'disabled'} aria-label="Ниже">↓</button>
        <button class="icon" type="button" data-a="kitDel" data-i="${index}" data-j="${j}" aria-label="Убрать элемент">✕</button></span>`;
  }

  static _supHint(item, part, scope) {
    if (scope !== 'asm') return 'производитель или поставщик';
    const assembler = KitScope.sup(item, part);
    return assembler ? `сборщик: ${assembler}` : 'сборщик';
  }

  /**
   * Строка под названием: вид (если его нет в названии), главные характеристики из каталога, поставщик.
   * @param {object} part
   * @param {string} kind
   * @returns {string}
   */
  static sub(part, kind) {
    const name = String(part.name || '').toLowerCase();
    const word = kind && StationEquip.LABEL[kind];
    const label = word && !name.includes(word.toLowerCase().slice(0, this.LABEL_PREFIX)) ? word : '';
    const sup = typeof StationSup !== 'undefined' ? StationSup.label(part) : '';
    const text = [
      label,
      part.attrs && part.attrs.cat ? mainLine(part, this.MAIN_LINE) : '',
      sup ? `поставщик: ${sup}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return text ? `<small class="muted kt-sub">${esc(text)}</small>` : '';
  }

  /**
   * Бак без своих габаритов: габариты по расчётному объёму (как в компоновке; компоновки нет — по «Настройкам»).
   * @param {object} item
   * @param {object} part
   * @param {string} kind
   * @returns {string}
   */
  static tankSize(item, part, kind) {
    if (kind !== 'tank' || StationEquip.dims(part, kind).known) return '';
    const volume = TankSize.vol(part);
    const plan = StationUi.enabled(item) && Kit.container(item) ? StationUi.plan(item) : null;
    const placed = plan && (plan.items || []).find(entry => entry.tank && entry.id === part.id);
    const dims = placed
      ? { l: Math.max(placed.lx, placed.ly), w: Math.min(placed.lx, placed.ly), h: placed.h }
      : TankSize.of(volume || this.TANK_DEFAULT);
    return `<small class="muted kd-tank">Габариты по объёму${volume ? ` ${Mm.text(volume)} л` : ''}: ${esc(TankSize.text(dims))} — прямоугольный, стенка ${StationMatrix.tank().wall} мм (требует подтверждения изготовителем). Свои — строкой «Габариты».</small>`;
  }

  // подробности элемента: сторона поставки, описание, характеристики, фото, рисунок для чертежа, поля обвязки и шкафа
  static _details({ item, index, scope }, part, j) {
    const path = `items.${index}.kit.parts.${j}`;
    const rows = part.rows || [];
    const kind = StationEquip.kindOf(part);
    const scopes = ['our', 'asm']
      .map(
        value =>
          `<button type="button" class="${value === scope ? 'on' : ''}" data-a="kitBy" data-i="${index}" data-j="${j}" data-by="${value}" aria-pressed="${value === scope}">${value === 'our' ? 'наше' : 'сборщик'}</button>`,
      )
      .join('');
    return `<div class="kt-d">
      <div class="kd-top"><span class="muted">Поставка:</span><span class="seg" role="group" aria-label="Кто поставляет">${scopes}</span><button class="btn ghost sm" type="button" data-a="aiPart" data-i="${index}" data-j="${j}" title="Описание и характеристики элемента — с помощью любого ИИ">✨ ИИ</button></div>
      ${KitPipe.fields(part, index, j)}${KitCabinet.fields(part, index, j)}
      <div class="kd-g">
        <div class="kd-ph"><span class="muted">Фото</span>${this._photo(part, index, j)}</div>
        <label class="f kit-desc"><span>Техническое описание${part.catId ? ' <small class="muted">из каталога</small>' : ''}</span><textarea rows="3" data-p="${path}.desc" placeholder="Назначение, конструкция, комплектация — попадёт в КП">${esc(part.desc || '')}</textarea></label></div>
      <div class="kd-rows"><span class="muted">Характеристики — таблица в КП${rows.length ? '' : ' (габариты, масса и цвет нужны для компоновки)'}</span>${this.tankSize(item, part, kind)}
        ${rows.map((row, k) => this._specRow({ path, index, j }, row, k)).join('')}
        <button class="btn ghost sm" type="button" data-a="kitRowAdd" data-i="${index}" data-j="${j}">+ строка</button></div>
      ${this.NOT_DRAWN.test(kind) ? '' : DrawPic.fields(part, index, j)}</div>`;
  }

  static _photo(part, index, j) {
    const has = part.photo && part.photo.src;
    const inner = has
      ? `<img src="${esc(part.photo.src)}" alt="${esc(part.name || 'Фото элемента')}"><button class="icon x" type="button" data-a="kitPhotoDel" data-i="${index}" data-j="${j}" aria-label="Убрать фото">✕</button>`
      : `<button type="button" class="kit-phb" data-a="kitPhoto" data-i="${index}" data-j="${j}">+ фото</button>`;
    return `<div class="kit-ph${has ? ' has' : ''}">${inner}</div>`;
  }

  static _specRow({ path, index, j }, row, k) {
    const value = DimRow.is('', row.k)
      ? DimRow.html(`data-p="${path}.rows.${k}.v"`, row)
      : `<input type="text" data-p="${path}.rows.${k}.v" value="${esc(row.v)}" placeholder="Значение">`;
    return `<div class="kit-row"><input type="text" data-p="${path}.rows.${k}.k" value="${esc(row.k)}" placeholder="Параметр">${value}<button class="icon" type="button" data-a="kitRowDel" data-i="${index}" data-j="${j}" data-k="${k}" aria-label="Удалить строку">✕</button></div>`;
  }

  // итог закупки и переход к компоновке
  static _sum(item, index) {
    const parts = Kit.parts(item);
    if (!parts.length) return '';
    const cost = Kit.cost(item);
    const missing = parts.filter(part => !part.cost && (part.role === 'container' || KitScope.of(part) === 'our'));
    const plan = StationUi.enabled(item) && Kit.container(item) ? StationUi.plan(item) : null;
    const layout = this._layoutChip(plan);
    return `<div class="kit-sum"><span>Закупка изделия${parts.some(part => part.costCur && part.costCur !== 'RUB') ? ' (по курсам КП)' : ''}</span><b>${Number.isFinite(cost) ? `${money(cost)} ₽` : 'нет курса валюты — укажите в шаге «Цены»'}</b>
      ${layout ? `<button type="button" class="chip sm ${layout[0]}" data-edtab="layout">${layout[1]} → компоновка</button>` : ''}
      <button class="btn ghost sm" type="button" data-a="tzOut" data-i="${index}">Скачать ТЗ на сборку</button>
      ${missing.length ? `<small class="warn-t">не указана закупка: ${missing.map(part => esc(part.name || 'без названия')).join(', ')}</small>` : ''}</div>`;
  }

  static _layoutChip(plan) {
    if (!plan || plan.level === 'none') return null;
    if (plan.level === 'error') {
      return ['bad', plan.assumed ? '✕ Компоновка: проверьте габариты' : '✕ Не помещается в контейнер'];
    }
    return plan.level === 'warn' ? ['warn', '⚠ Компоновка — есть замечания'] : ['on', '✓ Помещается'];
  }

  /**
   * Действия вкладки (data-a).
   * @param {string} action
   * @param {number} index позиция КП
   * @param {HTMLElement} button
   * @returns {boolean|string} true — перерисовать, 'async' — перерисовано, false — не моё
   */
  static act(action, index, button) {
    const item = S.items[index];
    if (!item) return false;
    if (this.NEED_ACTIONS.includes(action)) return KitNeed.act(action, index, button);
    const method = this.ACTIONS[action];
    if (!method) return false;
    return this[method](item, Kit.parts(item)[+button.dataset.j], button);
  }

  static _toggle(item, part) {
    if (!part) return false;
    if (this.open.has(part.id)) this.open.delete(part.id);
    else this.open.add(part.id);
    renderEditor();
    return 'async';
  }

  static _scope(item, part, button) {
    if (!part) return false;
    part.by = button.dataset.by === 'our' ? 'our' : 'asm';
    if (part.by === KitScope.def(part)) delete part.by;
    Kit.sync(item);
    return true;
  }

  static _hidePick(item) {
    delete StationReq.ensure(item).pick;
    persist();
    renderEditor();
    return 'async';
  }

  static _resetExpert(item, part, button) {
    ExpertLog.reset(item, String(button.dataset.k || '').split(','));
    StationUi.cache.delete(item.id);
    persist();
    renderEditor();
    return 'async';
  }
}
