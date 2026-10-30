import { Freight } from './freight.js';
import { LgCargo } from './lg-cargo.js';
import { LgFmt } from './lg-fmt.js';
import { LgState } from './lg-state.js';
import { Toast } from '../../core/toast.js';
import { Fmt } from '../../core/str.js';
import { esc } from '../../core/util.js';
import { UiKit } from '../../core/ui-kit.js';

/**
 * Сверка тарифов со счетами перевозчиков (администратор): счета хранятся вместе с тарифами (facts); каждый счёт
 * сравнивается с ценой рейса по тарифу его машины, по классу — поправка тарифа, «Применить» переносит её в таблицу машин.
 */
export class FreightFacts {
  static MAX = 300;
  static ROUTE = 120;
  static GOOD = 10;
  static WARN = 25;
  static PCT = 100;
  static TENTHS = 10;
  static K_DIGITS = 1000;
  static SAME = 0.005;
  static TIP =
    '<p>Впишите счета за перевозки отдельной машиной: дату, маршрут, расстояние по дорогам, машину и сумму по счёту с НДС (только перевозка — без агента, страхования и разгрузки).</p><p>Программа сравнит каждый счёт с ценой рейса по тарифу и предложит поправку: при трёх и больше счетах на разных расстояниях — отдельно подачу и ставки за км, иначе — общий множитель. «Применить» переносит поправку в таблицу машин, затем «Сохранить тарифы».</p>';
  static last = null;

  /**
   * Сохранённые счета.
   * @returns {object[]}
   */
  static facts() {
    return LgState.saved && Array.isArray(LgState.saved.facts) ? LgState.saved.facts : [];
  }

  /**
   * Строка счёта.
   * @param {object} fact
   * @param {object} tariffs
   * @returns {string}
   */
  static row(fact, tariffs) {
    const options = tariffs.classes
      .map(cls => `<option value="${esc(cls.id)}"${cls.id === fact.cls ? ' selected' : ''}>${esc(cls.name)}</option>`)
      .join('');
    return `<tr><td><input type="date" data-fa="at" value="${esc(fact.at || '')}" aria-label="Дата счёта"></td>
      <td><input type="text" data-fa="route" value="${esc(fact.route || '')}" placeholder="Москва — Казань" aria-label="Маршрут"></td>
      <td><input type="text" inputmode="numeric" data-fa="km" value="${esc(fact.km || '')}" placeholder="км" aria-label="Расстояние, км"></td>
      <td><select data-fa="cls" aria-label="Машина">${options}</select></td>
      <td><input type="text" inputmode="decimal" data-fa="sum" value="${esc(fact.sum != null ? LgFmt.num(fact.sum) : '')}" placeholder="₽ с НДС" aria-label="Сумма по счёту"></td>
      <td class="num" data-fa-model></td><td class="num" data-fa-dev></td>
      <td><button class="icon" type="button" data-lgfa="del" aria-label="Убрать счёт">✕</button></td></tr>`;
  }

  /**
   * Раздел «Сверка со счетами перевозчиков».
   * @param {object} tariffs
   * @returns {string}
   */
  static html(tariffs) {
    return `<div class="lg-facts"><div class="sub" style="margin-top:14px">Сверка со счетами перевозчиков ${UiKit.tip(FreightFacts.TIP)}</div>
      <div class="lg-tw"><table class="lg-st lg-fa" id="lgFa"><thead><tr><th>Дата</th><th>Маршрут</th><th>Км</th><th>Машина</th><th>По счёту, ₽ с НДС</th><th>По тарифу</th><th>Отклонение</th><th></th></tr></thead>
        <tbody>${FreightFacts.facts()
          .map(fact => FreightFacts.row(fact, tariffs))
          .join('')}</tbody></table></div>
      <button class="btn ghost" type="button" data-lgfa="add">+ Счёт</button>
      <div id="lgFaRes" class="lg-fares"></div></div>`;
  }

  /**
   * Счета из формы.
   * @param {HTMLElement} box
   * @returns {object[]}
   */
  static read(box) {
    return [...box.querySelectorAll('#lgFa tbody tr')]
      .map(row => {
        const value = key => {
          const field = row.querySelector(`[data-fa="${key}"]`);
          return field ? field.value.trim() : '';
        };
        return {
          at: value('at'),
          route: value('route').slice(0, FreightFacts.ROUTE),
          km: LgCargo.num(value('km')),
          cls: value('cls'),
          sum: LgCargo.num(value('sum')),
        };
      })
      .filter(fact => fact.km > 0 && fact.sum > 0 && fact.cls)
      .slice(0, FreightFacts.MAX);
  }

  static _devClass(dev) {
    if (dev == null) return '';
    if (Math.abs(dev) <= FreightFacts.GOOD) return 'ok-t';
    return Math.abs(dev) <= FreightFacts.WARN ? 'warn-t' : 'bad-t';
  }

  static _rowCheck(row, tariffs) {
    const dist = LgCargo.num(row.querySelector('[data-fa=km]').value);
    const sum = LgCargo.num(row.querySelector('[data-fa=sum]').value);
    const cls = tariffs.classes.find(item => item.id === row.querySelector('[data-fa=cls]').value);
    const model = cls && dist > 0 ? Freight.run(cls, dist, tariffs).v : null;
    const dev = model && sum > 0 ? (sum / model - 1) * FreightFacts.PCT : null;
    row.querySelector('[data-fa-model]').textContent = model ? Fmt.rub(model) : '';
    const cell = row.querySelector('[data-fa-dev]');
    cell.textContent =
      dev == null
        ? ''
        : `${dev > 0 ? '+' : ''}${LgFmt.comma(Math.round(dev * FreightFacts.TENTHS) / FreightFacts.TENTHS)} %`;
    cell.className = `num ${FreightFacts._devClass(dev)}`;
  }

  /**
   * Пересчёт: по тарифу и отклонение в строках, поправки по классам.
   * @param {HTMLElement} box
   * @param {object} tariffs
   */
  static update(box, tariffs) {
    const result = Freight.calibrate(FreightFacts.read(box), tariffs);
    for (const row of box.querySelectorAll('#lgFa tbody tr')) FreightFacts._rowCheck(row, tariffs);
    const out = box.querySelector('#lgFaRes');
    if (!out) return;
    const html = result.classes.length
      ? `<table class="lg-p"><tbody>${result.classes.map(cls => FreightFacts._fitRow(cls, tariffs)).join('')}</tbody></table>`
      : '<p class="muted">Счетов пока нет — добавьте хотя бы один, чтобы сверить тариф с фактом.</p>';
    // перерисовка — только если итог изменился: иначе уход фокуса пересоздаст «Применить» под курсором и щелчок потеряется
    if (out._html !== html) {
      out.innerHTML = html;
      out._html = html;
    }
    FreightFacts.last = result;
  }

  static _fitRow(cls, tariffs) {
    const pct = value => `${LgFmt.comma(Math.round(value * FreightFacts.TENTHS) / FreightFacts.TENTHS)} %`;
    const factor = value => `×${LgFmt.comma(Math.round(value * FreightFacts.K_DIGITS) / FreightFacts.K_DIGITS)}`;
    const far = Math.round(tariffs.far).toLocaleString('ru-RU');
    const fit = cls.fitted;
    const same = Math.abs(cls.a - 1) < FreightFacts.SAME && Math.abs(cls.b - 1) < FreightFacts.SAME;
    const action = same
      ? '<span class="muted">совпадает</span>'
      : `<button class="btn ghost sm" type="button" data-lgfa="apply" data-id="${esc(cls.id)}">Применить</button>`;
    return `<tr><td><b>${esc(cls.name)}</b> — ${cls.n} ${KPGen.plural(cls.n, 'счёт', 'счёта', 'счетов')}:
        средняя ошибка тарифа ${pct(cls.before)} → после поправки ${pct(cls.after)}<br><small class="muted">${esc(cls.how)}: подача и минимум ${factor(cls.a)}, ставки за км ${factor(cls.b)} →
        подача ${Fmt.rub(fit.base)}, ${Fmt.rub(fit.km)}/км до ${far} км, ${Fmt.rub(fit.kmFar)}/км дальше, минимум ${Fmt.rub(fit.min)}</small></td>
        <td class="num">${action}</td></tr>`;
  }

  /**
   * Обработчики раздела.
   * @param {HTMLElement} box
   * @param {object} tariffs
   */
  static bind(box, tariffs) {
    const body = box.querySelector('#lgFa tbody');
    if (!body) return;
    FreightFacts.update(box, tariffs);
    const update = () => FreightFacts.update(box, tariffs);
    box.querySelector('#lgFa').addEventListener('input', update);
    box.querySelector('.lg-facts').addEventListener('click', event => {
      const button = event.target.closest('[data-lgfa]');
      if (!button) return;
      const action = button.dataset.lgfa;
      if (action === 'add') FreightFacts._add(body, { tariffs, update });
      else if (action === 'del') {
        button.closest('tr').remove();
        update();
      } else if (action === 'apply') FreightFacts._apply(box, button.dataset.id);
    });
  }

  static _add(body, { tariffs, update }) {
    if (body.children.length >= FreightFacts.MAX) {
      Toast.show(`Не больше ${FreightFacts.MAX} счетов`);
      return;
    }
    body.insertAdjacentHTML(
      'beforeend',
      FreightFacts.row({ at: new Date().toISOString().slice(0, 10), cls: 'tent20' }, tariffs),
    );
    body.lastElementChild.querySelector('[data-fa=route]').focus();
    update();
  }

  // ставка по счетам закрепляется — автообновление её не меняет
  static _apply(box, id) {
    const cls = ((FreightFacts.last && FreightFacts.last.classes) || []).find(row => row.id === id);
    const row = box.querySelector(`#lgCl tbody tr[data-id="${CSS.escape(id)}"]`);
    if (!cls || !row) return;
    const put = (key, value) => {
      const input = row.querySelector(`td[data-k="${key}"] input`);
      if (!input) return;
      input.readOnly = false;
      input.removeAttribute('title');
      input.value = LgFmt.num(value);
    };
    for (const key of ['base', 'min', 'km', 'kmFar']) put(key, cls.fitted[key]);
    const auto = row.querySelector('[data-k=auto]');
    if (auto) auto.checked = false;
    row.dataset.src = `по счетам перевозчиков: ${cls.n} ${KPGen.plural(cls.n, 'счёт', 'счёта', 'счетов')}, ${new Date().toLocaleDateString('ru-RU')}`;
    row.classList.add('lg-upd');
    Toast.show(`«${cls.name}»: тариф поправлен по счетам — нажмите «Сохранить тарифы»`);
  }
}
