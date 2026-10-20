import { AttrsBlock, DimRow } from './attr-choices.js';
import { CatalogPrice } from './catalog-edit.js';
import { OptsBlock } from './item-blocks.js';

/** Вкладки карточки позиции: «Основное», «Характеристики», «Опции и услуги». */
export class ItemTabs {
  /**
   * «Основное»: наименование, заголовок, строка под названием, цена в каталоге, категория и параметры.
   * @param {object} item
   * @param {number} i позиция КП
   * @returns {string}
   */
  static main(item, i) {
    const path = `items.${i}`;
    const page = CATED
      ? ''
      : `<div class="row" style="margin-top:12px"><button class="sw" type="button" role="switch" aria-checked="${!!item.page}" data-a="togglePage" data-i="${i}"><i></i>Отдельная страница оборудования в КП (фото, описание, характеристики)</button></div>`;
    const save = CATED
      ? ''
      : `<div class="ed-sec row"><button class="btn" type="button" data-a="saveCat" data-i="${i}">Сохранить позицию в каталог</button>${tip('Фото, описание, характеристики, изображения и цена будут доступны в следующих КП.')}</div>`;
    return `<div class="ed-sec"><div class="grid g2">${field('Наименование в КП', `${path}.name`, { req: 1 })}${field('Заголовок страницы оборудования', `${path}.pageTitle`, { ph: item.name || 'Как в наименовании' })}</div>
    <div class="grid" style="margin-top:12px">${field('Краткие характеристики — строка под названием в таблице КП', `${path}.spec`, { ph: 'Двигатель · альтернатор · мощность · габариты' })}</div>
    ${page}</div>
   ${CATED ? CatalogPrice.html(item) : ''}
   <div class="ed-sec">${AttrsBlock.html(item, i)}</div>
   ${save}`;
  }

  static _row(path, ids, row) {
    const { i, j, k } = ids;
    const value = DimRow.matches('', row.k)
      ? DimRow.html(`data-p="${path}.groups.${j}.rows.${k}.v"`, row)
      : `<input type="text" data-p="${path}.groups.${j}.rows.${k}.v" value="${esc(row.v)}" placeholder="Значение">`;
    return `<div class="srow"><input type="text" data-p="${path}.groups.${j}.rows.${k}.k" value="${esc(row.k)}" placeholder="Параметр">${value}<button class="icon star" type="button" aria-pressed="${!!row.hl}" data-a="star" data-i="${i}" data-j="${j}" data-k="${k}" aria-label="Ключевой параметр" title="Выделить синим">★</button><button class="icon" type="button" data-a="delRow" data-i="${i}" data-j="${j}" data-k="${k}" aria-label="Удалить строку">✕</button></div>`;
  }

  static _group(path, i, group, j) {
    const rows = group.rows.map((row, k) => this._row(path, { i, j, k }, row)).join('');
    return `<div class="grp"><div class="grp-h"><input type="text" data-p="${path}.groups.${j}.name" value="${esc(group.name)}" placeholder="Группа (Двигатель, Альтернатор…)"><button class="icon" type="button" data-a="delGrp" data-i="${i}" data-j="${j}" aria-label="Удалить группу">✕</button></div>
      ${rows}
      <button class="btn ghost" type="button" data-a="addRow" data-i="${i}" data-j="${j}">+ строка</button></div>`;
  }

  /**
   * «Характеристики»: группы и строки, ★ — выделить параметр в КП.
   * @param {object} item
   * @param {number} i
   * @returns {string}
   */
  static spec(item, i) {
    const path = `items.${i}`;
    const groups = (item.groups || []).map((group, j) => this._group(path, i, group, j)).join('');
    const name = typeById(attrsOf(item).cat).name;
    return `<div class="ed-sec"><div class="row" style="margin-bottom:10px"><button class="btn" type="button" data-a="specTpl" data-i="${i}" title="Группы и строки характеристик, принятые для категории «${esc(name)}»; заполненное не меняется">Шаблон категории «${esc(name)}»</button><button class="btn" type="button" data-a="paste" data-i="${i}">Вставить таблицу из Excel</button><button class="btn" type="button" data-a="attrsToGroups" data-i="${i}">Сформировать из параметров</button><span class="muted">★ — выделить параметр синим в КП</span></div>
    ${groups || `<p class="muted">Характеристик пока нет. Нажмите «Шаблон категории» — появятся строки, принятые для «${esc(name)}»; или вставьте таблицу из Excel, сформируйте из параметров на вкладке «Основное», используйте автозаполнение.</p>`}
    <button class="btn ghost" type="button" data-a="addGrp" data-i="${i}">+ группа</button></div>`;
  }

  /**
   * «Опции и услуги».
   * @param {object} item
   * @param {number} i
   * @returns {string}
   */
  static opts(item, i) {
    return `<div class="ed-sec">${OptsBlock.html(item, i)}</div>`;
  }
}
