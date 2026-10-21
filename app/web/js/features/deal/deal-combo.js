import { DealFmt } from './deal-fmt.js';
import { DealState } from './deal-state.js';
import { DealSuppliers } from './deal-suppliers.js';
import { DealTerms } from './deal-terms.js';
import { DealUi } from './deal-ui.js';
import { DealWin } from './deal-win.js';
import { SidePanel } from '../../ui/side-panel.js';
import { KpState, S } from '../../core/state.js';
import { esc } from '../../core/util.js';
import { ObjPath } from '../../core/str.js';

/** Поле с выпадающим списком (поставщик, страна): подсказки по первым буквам или выбор из списка (кнопка «▾», стрелки, Enter). */
export class DealCombo {
  static NAME = /\.name$/;

  /**
   * Варианты списка: поставщики справочника и производители позиций — для названия, страны — для страны.
   * @param {string} path
   * @returns {{v: string, tag?: string, sub: string}[]}
   */
  static items(path) {
    if (DealCombo.NAME.test(path)) return DealCombo._suppliers();
    return DealTerms.COUNTRIES.filter(([name]) => !/^росс/i.test(name)).map(([name, cur]) => ({
      v: name,
      sub: DealCombo._countrySub(name, cur),
    }));
  }

  static _countrySub(name, cur) {
    const preset = DealTerms.countryPreset(name) || {};
    if (preset.cusMode === 'none') return 'без таможни · цены с НДС';
    return preset.cusMode === 'eaeu' ? `ЕАЭС · без пошлины · ${cur}` : `импорт · таможня по ТН ВЭД · ${cur}`;
  }

  static _suppliers() {
    const sups = (DealUi.sups || []).map(dir => ({ v: dir.name, tag: 'из справочника', sub: DealCombo._dirSub(dir) }));
    const have = new Set(sups.map(row => DealSuppliers.norm(row.v)));
    const makers = [
      ...new Set(
        DealState.inputs()
          .items.map(item => item.maker)
          .filter(Boolean),
      ),
    ].filter(maker => !have.has(DealSuppliers.norm(maker)));
    return [
      ...sups,
      ...makers.map(maker => ({ v: maker, tag: 'производитель', sub: 'из номенклатуры — будет новым поставщиком' })),
    ];
  }

  static _dirSub(dir) {
    const days = (+dir.prod || 0) + (+dir.ship || 0);
    return [dir.country, dir.adv != null && dir.adv !== '' ? `аванс ${dir.adv} %` : '', days ? `срок ${days} дн.` : '']
      .filter(Boolean)
      .join(' · ');
  }

  /**
   * Поле со списком.
   * @param {string} label
   * @param {string} path
   * @param {{ph?: string, q?: string, cls?: string}} [opts]
   * @returns {string}
   */
  static html(label, path, opts = {}) {
    const value = ObjPath.get(DealState.deal(), path) ?? '';
    const open = DealUi.combo === path;
    const items = open ? DealCombo._open(path, value) : [];
    const id = `cb-${path.replace(/\./g, '-')}`;
    return `<div class="f dl-f dl-combo${open ? ' open' : ''}${opts.cls ? ` ${opts.cls}` : ''}"><span><label for="${id}">${esc(label)}</label>${opts.q ? DealFmt.help(opts.q) : ''}</span>
      <span class="dl-cb"><input id="${id}" type="text" class="tx" data-dl="${path}" data-combo="${path}" value="${esc(value)}" placeholder="${esc(opts.ph || '')}" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="${open}">
        <button type="button" class="dl-cbb" data-dlx="combo" data-path="${path}" tabindex="-1" aria-label="Показать список">▾</button></span>
      ${open ? DealCombo._list(path, value, items) : ''}
    </div>`;
  }

  static _open(path, value) {
    const query = DealSuppliers.norm(value);
    let items = DealCombo.items(path);
    if (query && !DealUi.comboAll) {
      items = items.filter(
        row => DealSuppliers.norm(row.v).includes(query) || DealSuppliers.norm(row.sub).includes(query),
      );
    }
    DealUi.comboList = items.map(row => row.v);
    if (DealUi.comboIx >= items.length) DealUi.comboIx = items.length - 1;
    return items;
  }

  static _list(path, value, items) {
    if (!items.length) {
      const what = DealCombo.NAME.test(path) ? 'новый поставщик' : 'страна';
      return `<ul class="dl-cbl" role="listbox"><li class="none">Нет в списке${value ? ` — «${esc(value)}» сохранится как ${what}` : ''}</li></ul>`;
    }
    const rows = items
      .map((row, i) => {
        const selected = i === DealUi.comboIx ? ' aria-selected="true"' : '';
        const tag = row.tag ? `<em>${esc(row.tag)}</em>` : '';
        const sub = row.sub ? `<small>${esc(row.sub)}</small>` : '';
        return `<li role="option"${selected}><button type="button" data-dlx="pick" data-path="${path}" data-v="${esc(row.v)}" tabindex="-1"><b>${esc(row.v)}</b>${tag}${sub}</button></li>`;
      })
      .join('');
    return `<ul class="dl-cbl" role="listbox">${rows}</ul>`;
  }

  /**
   * Выбрано значение из списка.
   * @param {string} path
   * @param {string} value
   */
  static pick(path, value) {
    const deal = DealState.deal();
    ObjPath.set(deal, path, value);
    DealSuppliers.changed(path);
    DealUi.combo = null;
    DealUi.comboIx = -1;
    const match = /^sup\.(\d+)\./.exec(path);
    if (match) DealSuppliers.save(deal.sup[+match[1]]);
    S.deal.touched = true;
    KpState.persist();
    SidePanel.render();
    DealWin.render();
  }

  /** Закрыть список. */
  static close() {
    if (!DealUi.combo) return;
    DealUi.combo = null;
    DealUi.comboIx = -1;
    DealWin.render();
  }
}
