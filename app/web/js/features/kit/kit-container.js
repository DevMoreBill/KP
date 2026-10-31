import { StationPaint } from '../layout/station-paint.js';
import { KitView } from './kit-view.js';
import { DimInput } from '../../core/dim-input.js';
import { PaintView } from './paint-view.js';
import { StationGeo } from '../layout/station-geo.js';
import { esc } from '../../core/util.js';
import { UiKit } from '../../core/ui-kit.js';
import { StationSize } from './station-size.js';
import { Spoiler } from '../../core/spoiler.js';
import { Money } from '../../core/money.js';
import { ContainerKind } from '../layout/container-kind.js';
import { StationPlan } from '../req/station-plan.js';
/**
 * Контейнер станции во вкладке «Состав станции»: тип, размер, утепление, климат, сборщик и закупка — одной строкой;
 * крыша, пол и окраска — под раскрытием; системы контейнера — кнопками. Контейнер не выбран — плитки типов.
 */
export class KitContainer {
  static KOPECKS = 100;

  /**
   * Контейнер ещё не выбран — плитки типов.
   * @param {number} index позиция КП
   * @returns {string}
   */
  static pick(index) {
    const tiles = ContainerKind.TYPES.map(
      type =>
        `<button type="button" class="kit-ctb" data-a="kitCont" data-i="${index}" data-ct="${esc(type.id)}"><b>${esc(type.name)}</b><small>${esc(type.size)}</small></button>`,
    ).join('');
    return `<div class="kit-todo"><b>Контейнер</b><span class="muted">В чём поставляем станцию — дальше уточните утепление, климат и системы.</span>
      <div class="kit-cts">${tiles}</div></div>`;
  }

  /**
   * Закупка элемента текстом поля (как ввёл менеджер или из копеек).
   * @param {object} part
   * @returns {string}
   */
  static costText(part) {
    return part._costText ?? (part.cost ? String(part.cost / this.KOPECKS).replace('.', ',') : '');
  }

  /**
   * Выбор валюты закупки.
   * @param {number} index
   * @param {number} j номер элемента
   * @param {object} part
   * @returns {string}
   */
  static currency(index, j, part) {
    const options = Money.CURS.map(
      code => `<option${(part.costCur || 'RUB') === code ? ' selected' : ''}>${code}</option>`,
    ).join('');
    return `<select data-kitcur="${index}.${j}" aria-label="Валюта закупки">${options}</select>`;
  }

  /**
   * Блок контейнера.
   * @param {object} item позиция КП
   * @param {number} index
   * @param {object} part контейнер
   * @param {number} j номер контейнера в составе
   * @returns {string}
   */
  static html(item, index, part, j) {
    const select = (attr, list, current, label) => {
      const options = list
        .map(
          ([value, text]) =>
            `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(text)}</option>`,
        )
        .join('');
      return `<label class="f"><span>${label}</span><select data-kitct="${index}.${j}" data-fld="${attr}">${options}</select></label>`;
    };
    const auto = StationPlan.enabled(item) && StationGeo.FLEX[part.ctype];
    const size = String(part.size || '').trim();
    return `<div class="kit-cont">
      <div class="kc-g">${select(
        'ctype',
        ContainerKind.TYPES.map(type => [type.id, type.name]),
        part.ctype,
        'Контейнер',
      )}
        ${this._size({ index, part, j, auto, size })}
        ${select(
          'ins',
          ContainerKind.INSULATION.map(value => [value, value]),
          part.ins,
          'Утепление',
        )}
        ${select(
          'climate',
          ContainerKind.CLIMATES.map(row => [row[0], `${row[0]} — до ${row[2]} °C`]),
          part.climate,
          'Климатическое исполнение',
        )}
        <label class="f"><span>Сборщик контейнера${UiKit.tip('Кто изготавливает контейнер и собирает станцию. Элементы «Сборщика контейнера» без своего поставщика в «Экономике сделки» попадут к нему; наше оборудование едет к нему на сборку.')}</span><input type="text" list="kitSupL" data-p="items.${index}.kit.parts.${j}.sup" value="${esc(part.sup || '')}" placeholder="производитель контейнеров"></label>
        <label class="f"><span>Закупка контейнера</span><span class="kit-cost"><input type="text" inputmode="decimal" data-kitcost="${index}.${j}" value="${esc(this.costText(part))}" placeholder="цена из счёта">${this.currency(index, j, part)}</span></label></div>
      <details class="kc-more"${Spoiler.attr(`cont:${item.id}`)}><summary>Крыша, пол, окраска${this.look(part)}</summary><div class="kc-g">
        ${StationGeo.SEA[part.ctype] ? '' : select('roof', this._roofs(), StationGeo.roof(part), 'Крыша')}
        ${select(
          'floor',
          Object.entries(StationGeo.FLOORS).map(([key, floor]) => [key, floor.short]),
          StationGeo.floor(part),
          'Пол',
        )}
</div>${PaintView.html(part, index, j)}</details>
      ${auto && part.lenFix ? StationSize.note(part, StationPlan.plan(item), index) : ''}
      ${auto && !part.sizeAuto && size ? `<p class="muted kit-szn">Размер задан вручную — <button type="button" class="lnk" data-a="stlAuto" data-i="${index}">подобрать по оборудованию</button></p>` : ''}
      <div class="kit-sys"><span class="muted">Системы:</span>${this._systems(item, index, part, j)}</div></div>`;
  }

  static _size({ index, part, j, auto, size }) {
    const mode = part.lenFix ? 'длина задана' : 'по оборудованию';
    const note = auto && part.sizeAuto && size ? ` <small class="muted">${mode}</small>` : '';
    const help = auto
      ? UiKit.tip(
          'Все три окошка пустые — размер по оборудованию. Только длина (например, 10000) — длина заданная, ширина, высота и плотность компоновки (просторно, плотно, максимально плотно) — по оборудованию. Все три — размер целиком вручную.',
        )
      : '';
    const input = DimInput.html(`data-kitct="${index}.${j}" data-fld="size"`, part.size || '', {
      ph: ContainerKind.of(part.ctype).size,
      label: 'Размер контейнера',
      lenOnly: auto,
      unit: '',
    });
    return `<label class="f"><span>Размер Д × Ш × В, мм${note}${help}</span>${input}</label>`;
  }

  static _roofs() {
    return Object.entries(StationGeo.ROOFS).map(([key, roof]) => [
      key,
      roof.deg ? `${roof.name} (${roof.deg}°)` : roof.name,
    ]);
  }

  static _systems(item, index, part, j) {
    return ContainerKind.SYSTEMS.map(([id, label, hint]) => {
      const active = KitView.sysOn(item, part, id);
      return `<button type="button" class="chip sm${active ? ' on' : ''}" data-a="kitSys" data-i="${index}" data-j="${j}" data-sys="${id}" aria-pressed="${!!active}" title="${esc(hint)}">${esc(label)}</button>`;
    }).join('');
  }

  /**
   * Выбранное исполнение коротко — в заголовке свёрнутого блока: «(крыша скатная · пол — сталь чёрная · RAL 7035)».
   * @param {object} part контейнер
   * @returns {string}
   */
  static look(part) {
    const roof = StationGeo.SEA[part.ctype] ? null : StationGeo.ROOFS[StationGeo.roof(part)];
    const floor = StationGeo.FLOORS[StationGeo.floor(part)];
    const arts = StationPaint.arts(part).length;
    const text = [
      roof && `крыша ${roof.name}`,
      floor && `пол — ${floor.short}`,
      StationPaint.short(part),
      arts && `рисунков: ${arts}`,
    ]
      .filter(Boolean)
      .join(' · ');
    return text ? ` <span class="muted">(${esc(text)})</span>` : '';
  }
}
