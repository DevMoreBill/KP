/** Опции и услуги позиции: быстрые опции категории кнопками и строки своих опций. */
export class OptsBlock {
  static _row(path, i, option, j) {
    const priceText = option._priceText ?? (option.price ? money(option.price) : '');
    return `<div class="opt"><input type="text" data-p="${path}.options.${j}.name" value="${esc(option.name)}" placeholder="Наименование опции или услуги" list="optNames" autocomplete="off" aria-label="Опция">
    <input type="text" inputmode="numeric" data-p="${path}.options.${j}.qty" value="${esc(option.qty)}" class="${+option.qty >= 1 ? '' : 'bad'}" aria-label="Количество" title="Количество, ${esc(option.unit || 'шт.')}">
    <input type="text" inputmode="decimal" class="num${Number.isNaN(parsePrice(priceText)) ? ' bad' : ''}" data-oprice="${i}.${j}" value="${esc(priceText)}" placeholder="включено" aria-label="Цена за единицу">
    <span class="s" data-osum="${i}.${j}">${option.price ? money((+option.qty || 0) * option.price) : '—'}</span>
    <button class="icon" type="button" data-a="delOpt" data-i="${i}" data-j="${j}" aria-label="Удалить опцию">✕</button></div>`;
  }

  /**
   * Блок «Дополнительное оборудование и услуги».
   * @param {object} item
   * @param {number} i позиция КП
   * @returns {string}
   */
  static html(item, i) {
    const path = `items.${i}`;
    const opts = item.options || [];
    const rows = opts.map((option, j) => this._row(path, i, option, j)).join('');
    const have = new Set(opts.map(option => norm(option.name)));
    const chips = presetsFor(item)
      .map(
        (preset, k) =>
          `<button class="chip${have.has(norm(preset.name)) ? ' on' : ''}" type="button" data-a="optPreset" data-i="${i}" data-k="${k}" aria-pressed="${have.has(norm(preset.name))}">${esc(preset.short)}</button>`,
      )
      .join('');
    return `<div class="opts"><p class="sub">Дополнительное оборудование и услуги ${opts.length ? `<span class="muted">${opts.length} ${plural(opts.length, 'опция', 'опции', 'опций')}</span>` : ''}</p>
   <div class="chips">${chips}</div>${rows}
   <div class="row"><button class="btn ghost" type="button" data-a="addOpt" data-i="${i}">+ своя опция</button>
   ${opts.length ? '<span class="muted">Пустая цена — «включено в стоимость».</span>' : ''}</div></div>`;
  }
}

/** Место для картинки: нажать — файл; перетащить файл или картинку с сайта; Ctrl+V или «Вставить из буфера». */
export class ImageDrop {
  /**
   * Место для главного фото или логотипа.
   * @param {{img: object, kind: string, i: number, text: string, small: boolean}} slot small — низкое (логотип)
   * @returns {string}
   */
  static html({ img, kind, i, text, small }) {
    const pic = img
      ? `<img src="${esc(img.src)}" alt=""><button class="icon x" type="button" data-a="rmImg" data-k="${kind}" data-i="${i}" aria-label="Убрать">✕</button>`
      : `<span>${text}</span>`;
    const auto =
      kind === 'logo' && img && img.auto ? `<span class="muted">по производителю «${esc(img.auto)}»</span>` : '';
    return `<div class="drop" data-drop="${kind}" data-i="${i}" tabindex="0" role="button" aria-label="${kind === 'logo' ? 'Загрузить логотип' : 'Загрузить фото'}" style="${small ? 'min-height:80px' : ''}">
    ${pic}</div>
    <div class="imgbar"><button type="button" class="lnk" data-a="pickImg" data-k="${kind}" data-i="${i}">Выбрать файл</button><button type="button" class="lnk" data-imgpaste>Вставить из буфера</button>${auto}</div>`;
  }

  /**
   * Окошко фото блока описания.
   * @param {string} src
   * @param {string} attrs
   * @param {string} text
   * @returns {string}
   */
  static box(src, attrs, text) {
    return `<div class="ibox" ${attrs} tabindex="0" role="button">${src ? `<img src="${esc(src)}" alt="">` : `<span>${text}</span>`}</div>`;
  }
}
