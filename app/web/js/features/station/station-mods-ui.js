import { Toast } from '../../core/toast.js';
import { ItemEditor } from '../catalog/item-editor.js';
import { StationAuto } from '../kit/station-auto.js';
import { ContainerPart } from '../kit/container-part.js';
import { DefRegistry } from '../../core/defaults.js';
import { Modal } from '../../core/modal.js';
import { KpState, S } from '../../core/state.js';
import { Mm } from '../layout/mm.js';
import { StationLayout } from '../layout/station-layout.js';
import { esc } from '../../core/util.js';
import { StationMods } from '../layout/station-mods.js';
import { StationGeo } from '../layout/station-geo.js';
import { KpForm } from '../../core/kp-form.js';
import { StationSize } from '../kit/station-size.js';
import { StationPlan } from '../kit/station-plan.js';
import { Kit } from '../../core/kit.js';
/**
 * Станция из нескольких модулей: окно раскладки. Всегда кнопкой «Модули…» в «Компоновке» и всегда с вопросом «сделать
 * так?»; раскладка — на сетке (модули перетаскиваются; на телефоне — нажать модуль, затем клетку), варианты a × b — с
 * расчётом; в составе — контейнер × N и строка «Стыковка модулей на объекте» по числу стыков.
 */
export class StationModsUi {
  static JOIN = 'Стыковка модулей на объекте';
  static JOIN_DESC =
    'Стыковка модулей станции на объекте: станция собрана, обвязана, запущена и проверена на производстве, модули везут с оборудованием внутри; на объекте — установка модулей по разметке, соединение каркасов, уплотнение стыков, нащельники на стенах и кровле, пол без порога, подключение трубопровода, кабелей и коммуникаций через стык (разъёмные соединения).';
  static WORST = 1e15;
  static WARN_PENALTY = 1e9;
  static CALC_DELAY = 30;
  static DRAG_MIN = 6;
  static TOAST_MS = 6000;
  static MIN_MODULES = 2;
  static moved = false;

  /**
   * Только у блок-контейнеров «по проекту».
   * @param {object} container
   * @returns {boolean}
   */
  static can(container) {
    return !!container && !!StationGeo.FLEX[container.ctype];
  }

  /**
   * Кнопка в строке состояния «Компоновки»: раскладка есть — её название; не помещается — подсказка; иначе «Модули…».
   * @param {object} item
   * @param {number} index
   * @param {object} plan
   * @returns {string}
   */
  static btn(item, index, plan) {
    const container = Kit.container(item);
    if (!this.can(container)) return '';
    const mods = StationMods.of(container);
    const bad = plan.level === 'error' && !mods;
    return `<button class="btn ${bad ? 'primary' : 'ghost'} sm stl-mods" type="button" data-a="stlMods" data-i="${index}" title="Станция из нескольких модулей: раскладка, расчёт и подтверждение">${this._btnText(mods, bad)}</button>`;
  }

  static _btnText(mods, bad) {
    if (mods) return `Модули: ${esc(StationMods.shape(mods))} — изменить`;
    return bad ? 'Не помещается — собрать из модулей?' : 'Модули…';
  }

  /**
   * Расстановка этой станции с раскладкой cells (null — один модуль), размер — по оборудованию.
   * @param {object} item
   * @param {number[][]|null} cells
   * @returns {object}
   */
  static solve(item, cells) {
    const input = StationPlan.input(item);
    return StationLayout.solve({
      ...input,
      cont: { ...input.cont, mods: cells ? { cells } : null, size: '', sizeAuto: true },
    });
  }

  /**
   * Итог расчёта кратко: «✓ 12 000 × 5 100 мм · модуль …» и ключ сравнения (площадь, предупреждения — хуже).
   * @param {object} plan
   * @returns {{cls: string, t: string, k: number}}
   */
  static sum(plan) {
    const geo = plan.geo;
    if (plan.level === 'error' || !geo || !geo.ext) return { cls: 'bad', t: '✕ не помещается', k: this.WORST };
    const mods = geo.mods;
    const ok = plan.level === 'ok';
    const module = mods && mods.Lm ? ` · модуль ${Mm.text(mods.Lm)} × ${Mm.text(mods.Wm)}` : '';
    return {
      cls: ok ? 'ok' : 'warn',
      t: `${ok ? '✓' : '⚠'} ${Mm.text(geo.ext[0])} × ${Mm.text(geo.ext[1])} мм${module}`,
      k: geo.ext[0] * geo.ext[1] + (ok ? 0 : this.WARN_PENALTY),
    };
  }

  /**
   * Окно раскладки станции.
   * @param {number} index
   */
  static open(index) {
    const item = S.items[index];
    const container = item && Kit.container(item);
    if (!this.can(container)) return;
    const current = StationMods.of(container);
    const state = {
      x: item,
      i: index,
      c: container,
      n: current ? current.n : this.MIN_MODULES,
      cells: current ? current.cells : StationMods.cells(1, this.MIN_MODULES),
      pick: null,
      res: new Map(),
      t: null,
    };
    const modal = new Modal(
      `<div class="dlg-h"><h3>Станция из модулей<small>оборудование — целиком в модулях; на объекте — быстрая стыковка в одно помещение</small></h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <div class="md-body"></div>`,
      'md-dlg',
    );
    state.m = modal;
    this.draw(state);
    modal.d.addEventListener('click', event => this.click(state, event));
    modal.d.addEventListener('pointerdown', event => this.drag(state, event));
  }

  /**
   * Перерисовать окно: число модулей, варианты с расчётом, сетка, итог и кнопки.
   * @param {object} state
   */
  static draw(state) {
    const view = this._view(state);
    state.m.$('.md-body').innerHTML = `
      ${this._count(state)}
      <div class="md-vars">${this._variants(state, view)}</div>
      <p class="muted md-hint">Перетащите модули на сетке (на телефоне — нажмите модуль, затем клетку): по длине — торец к торцу, по ширине — бок о бок. Раскладка — прямоугольник, внутри — одно помещение; оборудование на стыки не ставится.</p>
      <div class="md-grid" style="grid-template-columns:repeat(${view.cols}, minmax(44px, 1fr))">${this._grid(state, view)}</div>
      <small class="muted md-ax">← торец у входа · внизу — стена с дверью оператора, как на плане чертежа</small>${this._legend(view)}
      <div class="smd-st ${this._statusClass(view)}">${this._status(state, view)}</div>
      ${this._actions(state, view)}
      <p class="muted md-cost">В составе станции: контейнер × N (цена — за модуль) и строка «${esc(this.JOIN)}» по числу стыков${this._joinCost()}.</p>`;
    this.calc(state);
  }

  /** раскладка, её расчёт и что в каком модуле; сетка — по раскладке и ещё клетка вокруг (куда перетащить) */
  static _view(state) {
    const max = StationMods.MAX;
    const rect = StationMods.rect(state.cells);
    const res = rect && rect.ok ? state.res.get(JSON.stringify(StationMods.rect(state.cells).cells)) : null;
    return {
      rect,
      res,
      cols: Math.min(max, (rect ? rect.a : 1) + 1),
      rows: Math.min(max, (rect ? rect.b : 1) + 1),
      filled: new Set((rect ? rect.cells : []).map(cell => cell.join(','))),
      content: res && res.p && res.cls !== 'bad' ? StationMods.content(res.p) : new Map(),
    };
  }

  static _count(state) {
    const max = StationMods.MAX;
    return `<div class="smd-n"><span>Модулей</span><button class="btn ghost sm" type="button" data-mn="-1"${state.n <= this.MIN_MODULES ? ' disabled' : ''} aria-label="Меньше">−</button><b>${state.n}</b><button class="btn ghost sm" type="button" data-mn="1"${state.n >= max ? ' disabled' : ''} aria-label="Больше">+</button>
        <small class="muted">до ${max}${state.n >= max ? ' — больше по запросу' : ''}</small></div>`;
  }

  /** варианты a × b с расчётом; «лучше» — наименьшая площадь без ошибок */
  static _variants(state, { rect }) {
    const max = StationMods.MAX;
    const variants = StationMods.shapes(state.n)
      .filter(([along, across]) => along <= max && across <= max)
      .map(([along, across]) => ({
        a: along,
        b: across,
        r: state.res.get(JSON.stringify(StationMods.cells(along, across))),
        on: rect && rect.ok && rect.a === along && rect.b === across,
      }));
    const best = variants
      .filter(variant => variant.r && variant.r.cls !== 'bad')
      .sort((first, second) => first.r.k - second.r.k)[0];
    return variants
      .map(
        variant => `<button type="button" class="md-var${variant.on ? ' on' : ''}" data-va="${variant.a}" data-vb="${variant.b}"><b>${this._shapeName(variant)}${best === variant ? ' <span class="md-best">лучше</span>' : ''}</b>
        <small class="${variant.r ? `md-${variant.r.cls}` : 'muted'}">${variant.r ? esc(variant.r.t) : 'считаю…'}</small></button>`,
      )
      .join('');
  }

  static _shapeName(variant) {
    if (variant.b === 1) return 'Торец к торцу';
    return variant.a === 1 ? 'Бок о бок' : `${variant.a} × ${variant.b}`;
  }

  /** сетка как план на чертеже: внизу — стена с дверью оператора (y = 0), вверху — задняя */
  static _grid(state, view) {
    let grid = '';
    for (let rowY = view.rows - 1; rowY >= 0; rowY--)
      for (let colX = 0; colX < view.cols; colX++) grid += this._cell(state, view, colX, rowY);
    return grid;
  }

  static _cell(state, view, colX, rowY) {
    const key = `${colX},${rowY}`;
    const filled = view.filled.has(key);
    return `<div class="md-cell${filled ? ' on' : ''}${state.pick === key ? ' pick' : ''}" data-cell="${key}" role="button" tabindex="0" aria-label="${filled ? `Модуль ${this._name(view, key).slice(1)}` : 'Пустая клетка'}">${filled ? this._module(view, key) : ''}</div>`;
  }

  /** «М2» — номер модуля в раскладке */
  static _name(view, key) {
    return `М${view.rect.cells.findIndex(cell => cell.join(',') === key) + 1}`;
  }

  static _module(view, key) {
    const units = view.content.get(key) || [];
    return `<span class="md-mod" data-mod="${key}"><b>${this._name(view, key)}</b>${this._moduleNote(view, units)}</span>`;
  }

  static _moduleNote(view, units) {
    if (units.length) return `<small>поз. ${esc(units.map(unit => unit.pos).join(', '))}</small>`;
    return view.res && view.res.cls !== 'bad' ? '<small>пусто</small>' : '';
  }

  /** что в каком модуле — названиями под сеткой */
  static _legend(view) {
    const { rect, content } = view;
    if (!(rect && rect.ok && content.size)) return '';
    const items = rect.cells
      .map(cell => cell.join(','))
      .map(key => {
        const units = content.get(key) || [];
        const text = units.length
          ? esc(units.map(unit => `${unit.pos} ${unit.name}`).join(' · '))
          : '<span class="muted">без оборудования (проход)</span>';
        return `<li><b>${this._name(view, key)}</b> ${text}</li>`;
      })
      .join('');
    return `<ul class="md-in">${items}</ul>`;
  }

  static _statusClass({ rect, res }) {
    if (!rect || !rect.ok) return 'md-bad';
    return res ? `md-${res.cls}` : '';
  }

  static _status(state, { rect, res }) {
    if (!rect || !rect.ok)
      return `Раскладка не прямоугольник — модули должны складываться в ${StationMods.shapes(state.n)
        .map(([along, across]) => `${along} × ${across}`)
        .join(' или ')}.`;
    const error = res && res.p && res.p.issues.find(issue => issue.level === 'error');
    return `<b>${esc(StationMods.shape(rect))}</b> ${res ? esc(res.t) : 'считаю…'}${error ? `<br><small>${esc(error.text)}</small>` : ''}`;
  }

  static _actions(state, { rect, res }) {
    const ready = rect && rect.ok && res && res.cls !== 'bad';
    const one = StationMods.of(state.c)
      ? '<button class="btn ghost" type="button" data-md="one">Один модуль…</button>'
      : '';
    return `<div class="row md-act"><button class="btn primary" type="button" data-md="apply"${ready ? '' : ' disabled'}>Сделать из ${state.n} модулей…</button>
        ${one}<button class="btn ghost" type="button" data-x>Отмена</button></div>`;
  }

  static _joinCost() {
    return DefRegistry.value('st.joinCost')
      ? ` (${Mm.text(+DefRegistry.value('st.joinCost'))} ₽ за стык)`
      : ' — цену укажите в составе';
  }

  /**
   * Расчёт вариантов и текущей раскладки — по одному, без зависания окна.
   * @param {object} state
   */
  static calc(state) {
    clearTimeout(state.t);
    const max = StationMods.MAX;
    const todo = [
      ...StationMods.shapes(state.n)
        .filter(([along, across]) => along <= max && across <= max)
        .map(([along, across]) => StationMods.cells(along, across)),
      state.cells,
    ]
      .map(cells => [JSON.stringify(StationMods.rect(cells) && StationMods.rect(cells).cells), cells])
      .filter(([key, cells]) => key && StationMods.rect(cells).ok && !state.res.has(key));
    if (!todo.length) return;
    state.t = setTimeout(() => {
      if (!state.m.d.open) return;
      const [key, cells] = todo[0];
      const plan = this.solve(state.x, cells);
      state.res.set(key, { ...this.sum(plan), p: plan });
      this.draw(state);
    }, this.CALC_DELAY);
  }

  /**
   * Щелчки окна: закрыть, число модулей, вариант, применить, перенос модуля нажатием.
   * @param {object} state
   * @param {MouseEvent} event
   */
  static click(state, event) {
    const target = event.target;
    if (target.closest('[data-x]')) {
      state.m.close();
      return;
    }
    const count = target.closest('[data-mn]');
    if (count) {
      this._resize(state, +count.dataset.mn);
      return;
    }
    const variant = target.closest('[data-va]');
    if (variant) {
      state.cells = StationMods.cells(+variant.dataset.va, +variant.dataset.vb);
      state.pick = null;
      this.draw(state);
      return;
    }
    const action = target.closest('[data-md]');
    if (action) {
      if (action.dataset.md === 'apply') this.apply(state);
      else this.one(state);
      return;
    }
    this._tap(state, target);
  }

  /** больше / меньше модулей; прежняя раскладка бок о бок — так и дальше, иначе — торец к торцу */
  static _resize(state, step) {
    const count = Math.max(this.MIN_MODULES, Math.min(StationMods.MAX, state.n + step));
    if (count === state.n) return;
    const rect = StationMods.rect(state.cells);
    const side = rect && rect.b > rect.a;
    state.n = count;
    state.cells = side ? StationMods.cells(1, count) : StationMods.cells(count, 1);
    state.pick = null;
    this.draw(state);
  }

  /** нажать модуль, затем пустую клетку — перенос (телефон и клавиатура) */
  static _tap(state, target) {
    if (this.moved) {
      this.moved = false;
      return;
    }
    const cell = target.closest('[data-cell]');
    if (!cell) return;
    const key = cell.dataset.cell;
    if (cell.classList.contains('on')) {
      state.pick = state.pick === key ? null : key;
      this.draw(state);
      return;
    }
    if (state.pick) {
      this.move(state, state.pick, key);
      state.pick = null;
      this.draw(state);
    }
  }

  /**
   * Модуль из клетки from — в пустую клетку to (сетка сдвигается к началу).
   * @param {object} state
   * @param {string} from «x,y»
   * @param {string} target «x,y»
   */
  static move(state, from, target) {
    const [fromX, fromY] = from.split(',').map(Number);
    const [toX, toY] = target.split(',').map(Number);
    const cells = state.cells.map(cell => (cell[0] === fromX && cell[1] === fromY ? [toX, toY] : cell));
    const rect = StationMods.rect(cells);
    state.cells = rect ? rect.cells : cells;
  }

  /**
   * Перетаскивание модуля мышью или пальцем: копия модуля под указателем, отпустили над пустой клеткой — перенос.
   * @param {object} state
   * @param {PointerEvent} event
   */
  static drag(state, event) {
    const mod = event.target.closest('[data-mod]');
    if (!mod || event.button > 0) return;
    const from = mod.dataset.mod;
    const box = mod.getBoundingClientRect();
    const ghost = mod.cloneNode(true);
    ghost.classList.add('md-ghost');
    ghost.style.width = `${box.width}px`;
    ghost.style.height = `${box.height}px`;
    const drag = { state, from, box, ghost, x0: event.clientX, y0: event.clientY, moved: false };
    const onMove = moveEvent => this._dragMove(drag, moveEvent);
    const onUp = upEvent => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      this._drop(drag, upEvent);
    };
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
  }

  static _dragMove(drag, event) {
    if (!drag.moved && Math.hypot(event.clientX - drag.x0, event.clientY - drag.y0) < this.DRAG_MIN) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.state.m.d.appendChild(drag.ghost);
    }
    drag.ghost.style.left = `${event.clientX - drag.box.width / 2}px`;
    drag.ghost.style.top = `${event.clientY - drag.box.height / 2}px`;
    event.preventDefault();
  }

  static _drop(drag, event) {
    drag.ghost.remove();
    if (!drag.moved) return;
    this.moved = true;
    const under = document.elementFromPoint(event.clientX, event.clientY);
    const cell = under && under.closest && under.closest('[data-cell]');
    if (cell && !cell.classList.contains('on')) {
      this.move(drag.state, drag.from, cell.dataset.cell);
      drag.state.pick = null;
      this.draw(drag.state);
    }
  }

  /**
   * «Сделать из модулей» — всегда с вопросом; в составе — контейнер × N и стыковка.
   * @param {object} state
   */
  static async apply(state) {
    const rect = StationMods.rect(state.cells);
    if (!rect || !rect.ok) return;
    const joints = StationMods.joints(rect);
    const res = state.res.get(JSON.stringify(rect.cells));
    const yes =
      await Modal.ask(`<div class="dlg-h"><h3>Сделать станцию из ${rect.n} модулей?</h3></div><p>${esc(StationMods.shape(rect))}${res ? ` — ${esc(res.t)}` : ''}.</p>
      <p class="muted">В составе: контейнер × ${rect.n} (цена — за модуль), «${esc(this.JOIN)}» × ${joints}. Каждый агрегат — целиком в своём модуле (на стыках оборудования нет): станцию собирают и проверяют на производстве, на перевозку расстыковывают трубопровод, кабели и коммуникации, модули везут с оборудованием внутри; на объекте — быстрая стыковка в одно помещение. Размер модуля — по оборудованию.</p>
      <div class="row"><button class="btn primary" type="button" data-v="1">Да, из модулей</button><button class="btn ghost" type="button" data-v="0">Нет</button></div>`);
    if (!yes) return;
    const container = state.c;
    container.mods = { cells: rect.cells };
    container.qty = rect.n;
    container.sizeAuto = true;
    this.joint(state.x, joints);
    state.m.close();
    this.done(
      state.x,
      `Станция из модулей: ${StationMods.shape(rect)}. Проверьте цену модуля и стыковки в составе станции.`,
    );
  }

  /**
   * «Один модуль» — тоже с вопросом.
   * @param {object} state
   */
  static async one(state) {
    const yes =
      await Modal.ask(`<div class="dlg-h"><h3>Вернуть один модуль?</h3></div><p class="muted">Контейнер — 1 шт., строка «${esc(this.JOIN)}» убирается; размер — по оборудованию.</p>
      <div class="row"><button class="btn primary" type="button" data-v="1">Да, один модуль</button><button class="btn ghost" type="button" data-v="0">Нет</button></div>`);
    if (!yes) return;
    const container = state.c;
    delete container.mods;
    container.qty = 1;
    container.sizeAuto = true;
    this.joint(state.x, 0);
    state.m.close();
    this.done(state.x, 'Станция — в одном модуле.');
  }

  /**
   * Строка «Стыковка модулей на объекте»: joints стыков (0 — убрать); цена за стык — по умолчанию из «Настроек».
   * @param {object} item
   * @param {number} joints
   */
  static joint(item, joints) {
    const parts = item.kit.parts;
    const place = parts.findIndex(part => part.modJoin);
    if (!joints) {
      if (place >= 0) parts.splice(place, 1);
      return;
    }
    const part =
      place >= 0
        ? parts[place]
        : Kit.newPart({
            name: this.JOIN,
            desc: this.JOIN_DESC,
            modJoin: true,
            cost: Math.round((+DefRegistry.value('st.joinCost') || 0) * 100),
            costCur: 'RUB',
          });
    part.qty = joints;
    if (place < 0) parts.push(part);
  }

  /**
   * После применения: контейнер, размер, характеристики, сохранение и уведомление.
   * @param {object} item
   * @param {string} message
   */
  static done(item, message) {
    const container = Kit.container(item);
    if (container) ContainerPart.apply(container);
    StationSize.refresh(item);
    StationAuto.fill(item);
    KpState.persist();
    ItemEditor.render();
    KpForm.render();
    Toast.show(message, this.TOAST_MS);
  }
}
