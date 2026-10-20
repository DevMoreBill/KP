import { Design } from './design.js';
import { DesignForm } from './design-form.js';
import { DesignModel } from './design-model.js';
import { DesignView } from './design-view.js';

/** Графический редактор шаблона: правая панель (свойства выбранного) и мини-панель над выбранным в документе. */
export class DesignInspector {
  static KINDS = { label: '_label', sec: '_section', style: '_style' };
  static MINI = { label: '_miniOwn', img: '_miniOwn', style: '_miniStyle' };
  static MINI_GAP = 4;
  static MINI_ABOVE_TEXT = 42;
  static MINI_ABOVE_IMAGE = 66; // над подписью размера
  static PREVIEW_MAX = 40;
  static PREVIEW_TEXT = 60;
  static PX_NUM = 4; // 1 пт = 4/3 px
  static PX_DEN = 3;
  static LABEL_ROWS = 8;
  static TEXT_ROWS = 5;
  static TEXT_LINE = 34;

  /**
   * Правая панель.
   * @returns {string}
   */
  static html() {
    const sel = Design.state.sel;
    if (!sel) return this._empty();
    if (sel.kind === 'img') return /^X_/.test(sel.key) ? this._ownImage(sel) : this._layoutImage(sel);
    const method = this.KINDS[sel.kind];
    return method ? this[method](sel) : '';
  }

  static _empty() {
    return `<div class="td-empty"><b>Как работать</b>
    <ul class="td-tips"><li><b>Щёлкните</b> текст или картинку — справа свойства, над элементом — быстрые кнопки.</li>
      <li><b>Перетащите</b> мышью — элемент переедет. Свои надписи и картинки ставятся в любое место страницы.</li>
      <li><b>Маркеры</b> по краям — размер; ширина и высота меняются независимо, с <kbd>Shift</kbd> — пропорционально.</li>
      <li><kbd>←↑→↓</kbd> — точный сдвиг, <kbd>Delete</kbd> — удалить, <kbd>Ctrl+D</kbd> — копия, <kbd>Ctrl+Z</kbd> — отменить.</li>
      <li><b>＋ Надпись</b> и <b>＋ Картинка</b> вверху — добавить свои элементы.</li></ul>
    <p class="muted">${Design.state.demo ? 'Документ показан на примере: в текущем КП нет позиций.' : 'Документ построен по текущему КП.'}</p></div>`;
  }

  static _para(paraKey) {
    const para = Design.state.work.para[paraKey] || {};
    const align = DesignForm.segment(
      `para.${paraKey}.align`,
      para.align || '',
      [['', 'авто', 'Как в макете']].concat(Design.ALIGN),
    );
    return `<h4 class="td-ih2">Положение на странице</h4>
    <div class="td-row2"><span>Выравнивание</span>${align}</div>
    <div class="td-wh"><label class="td-n"><span>Сдвиг ⇆, см</span>${DesignForm.number(`para.${paraKey}.indent`, +para.indent || 0, { min: -2, max: 15 })}</label>
      <label class="td-n"><span>Сверху, пт</span>${DesignForm.number(`para.${paraKey}.before`, +para.before || 0, { step: 1, min: -60, max: 300 })}</label>
      <label class="td-n"><span>Снизу, пт</span>${DesignForm.number(`para.${paraKey}.after`, +para.after || 0, { step: 1, min: -60, max: 300 })}</label></div>
    <small class="muted">Или перетащите элемент мышью в документе (стрелки — точный сдвиг). Сдвиг одинаков для всех таких элементов.</small>
    ${Object.keys(para).length ? `<button class="btn ghost" type="button" data-tdparareset="${esc(paraKey)}">Вернуть на место</button>` : ''}`;
  }

  static _position(path, item, kind) {
    const float = DesignForm.segment(`${path}.float`, item.float ? '1' : '', [
      ['1', 'свободно', 'В любом месте страницы, текст не сдвигает'],
      ['', 'в тексте', 'Строкой в начале или конце раздела, сдвигает текст'],
    ]);
    const image = kind === 'img';
    const where = item.float
      ? `<div class="td-wh"><label class="td-n"><span>X, см</span>${DesignForm.number(`${path}.x`, Design.round(+item.x || 0, Design.CENTS), { step: 0.1 })}</label><label class="td-n"><span>Y, см</span>${DesignForm.number(`${path}.y`, Design.round(+item.y || 0, Design.CENTS), { step: 0.1 })}</label></div>`
      : `<div class="td-row2"><span>Выравнивание</span>${DesignForm.segment(`${path}.align`, item.align || (image ? 'center' : 'left'), Design.ALIGN.slice(0, image ? 3 : 4))}</div>`;
    const places = DesignModel.places()
      .map(
        ([value, text]) =>
          `<option value="${esc(value)}"${value === item.place ? ' selected' : ''}>${esc(text)}</option>`,
      )
      .join('');
    return `<div class="td-row2"><span>Положение</span>${float}</div>
    ${where}
    <label class="td-l"><span>${item.float ? 'Привязка (страница, где объект)' : 'Место'}</span><select data-tdpath="${esc(path)}.place">${places}</select></label>`;
  }

  static _toggles(path, item) {
    const toggle = (prop, text, title) =>
      `<button type="button" class="td-t${item[prop] ? ' on' : ''}" data-tdtog="${path}.${prop}" aria-pressed="${!!item[prop]}" title="${title}">${text}</button>`;
    return `${toggle('bold', 'Ж', 'Жирный')}${toggle('italic', '<i>К</i>', 'Курсив')}${toggle('caps', 'АА', 'Прописные')}`;
  }

  static _label(sel) {
    const work = Design.state.work;
    const i = work.labels.findIndex(row => `L_${row.id}` === sel.key);
    const label = work.labels[i];
    if (!label) return '';
    const path = `labels.${i}`;
    const rows = Math.min(this.LABEL_ROWS, String(label.text || '').split('\n').length + 1);
    const size = `<button class="icon" type="button" data-tdstep="${path}.size" data-d="-1">−</button>${DesignForm.number(`${path}.size`, label.size || 10, { min: 5, max: 96, step: 0.5 })}<button class="icon" type="button" data-tdstep="${path}.size" data-d="1">+</button>`;
    const box = label.float
      ? `<div class="td-wh"><label class="td-n"><span>Ширина, см</span>${DesignForm.number(`${path}.widthCm`, Design.round(+label.widthCm || 6, Design.CENTS), { min: 0.5, max: 25 })}</label><label class="td-n"><span>Высота, см</span>${DesignForm.number(`${path}.heightCm`, Design.round(+label.heightCm || 1.2, Design.CENTS), { min: 0.3, max: 30 })}</label></div>`
      : '';
    return `<h4 class="td-ih">Надпись</h4>
      <textarea rows="${rows}" data-tdpath="${path}.text" id="tdLblText">${esc(label.text || '')}</textarea>
      <div class="td-vars">${Design.VARS.map(name => `<button type="button" data-tdvar="{${name}}" title="Подставить из КП">{${name}}</button>`).join('')}</div>
      <div class="td-row"><span>Размер</span><span class="td-step">${size}</span><em>пт</em></div>
      <div class="td-row"><span>Начертание</span><span class="td-tgs">${this._toggles(path, label)}</span></div>
      <div class="td-row2"><span>Выравнивание</span>${DesignForm.segment(`${path}.align`, label.align || 'left', Design.ALIGN)}</div>
      <div class="td-col"><span>Цвет текста</span>${DesignForm.chips(`${path}.color`, label.color || 'DARK')}</div>
      <div class="td-col"><span>Фон</span>${DesignForm.chips(`${path}.bg`, label.bg || '', 'Без фона')}</div>
      <div class="td-col"><span>Рамка</span>${DesignForm.chips(`${path}.border`, label.border || '', 'Без рамки')}</div>
      <h4 class="td-ih2">Расположение</h4>
      ${this._position(path, label, 'label')}
      ${box}
      <div class="row"><button class="btn ghost" type="button" data-td="dup">⧉ Копия</button><button class="btn ghost danger" type="button" data-td="del">Удалить</button></div>`;
  }

  static _ownImage(sel) {
    const work = Design.state.work;
    const i = work.images.findIndex(row => `X_${row.id}` === sel.key);
    const image = work.images[i];
    if (!image) return '';
    const path = `images.${i}`;
    const height = +image.heightCm ? Design.round(+image.heightCm, Design.CENTS) : '';
    return `<h4 class="td-ih">Картинка шаблона</h4>
      <div class="td-img1"><img src="${Design.imageUrl(image.file)}" alt=""></div>
      <label class="td-l"><span>Название</span><input type="text" data-tdpath="${path}.name" value="${esc(image.name || '')}"></label>
      <h4 class="td-ih2">Размер</h4>
      <div class="td-wh"><label class="td-n"><span>Ширина, см</span>${DesignForm.number(`${path}.widthCm`, Design.round(+image.widthCm || 6, Design.CENTS), { min: 0.3, max: 30 })}</label><label class="td-n"><span>Высота, см</span>${DesignForm.number(`${path}.heightCm`, height, { min: 0, max: 30, ph: 'авто' })}</label></div>
      <label class="td-chk"><input type="checkbox" data-tdpath="${path}.lock" ${image.lock ? 'checked' : ''}> Сохранять пропорции</label>
      ${+image.heightCm ? `<button class="btn ghost" type="button" data-tdset="${path}.heightCm" data-v="0">Вернуть пропорции</button>` : ''}
      <h4 class="td-ih2">Расположение</h4>
      ${this._position(path, image, 'img')}
      ${image.float ? `<label class="td-chk"><input type="checkbox" data-tdpath="${path}.behind" ${image.behind ? 'checked' : ''}> За текстом (фон, водяной знак)</label>` : ''}
      <div class="row"><label class="btn ghost">Заменить…<input type="file" accept="image/png,image/jpeg" hidden data-tdup="replace"></label><button class="btn ghost" type="button" data-td="dup">⧉ Копия</button><button class="btn ghost danger" type="button" data-td="del">Удалить</button></div>`;
  }

  static _layoutSize(key) {
    const work = Design.state.work;
    if (key === 'headerLogo') {
      return `<div class="td-wh"><label class="td-n"><span>Ширина, см</span>${DesignForm.number('header.logoWidthCm', work.header.logoWidthCm ?? 4, { min: 0.5, max: 12 })}</label><label class="td-n"><span>Высота, см</span>${DesignForm.number('header.logoHeightCm', +work.header.logoHeightCm || '', { min: 0, max: 8, ph: 'авто' })}</label></div>`;
    }
    const fixed = work.imgSize[key] || {};
    const element = DesignModel.primary();
    const perCm = DesignView.pxPerCm();
    const rect = element ? element.getBoundingClientRect() : null;
    const widthNow = rect ? Design.round(rect.width / perCm, Design.CENTS) : '';
    const heightNow = rect ? Design.round(rect.height / perCm, Design.CENTS) : '';
    return `<div class="td-wh"><label class="td-n"><span>Ширина, см</span>${DesignForm.number(`imgSize.${key}.w`, fixed.w ?? '', { min: 0.3, max: 30, ph: widthNow })}</label><label class="td-n"><span>Высота, см</span>${DesignForm.number(`imgSize.${key}.h`, fixed.h ?? '', { min: 0.3, max: 30, ph: heightNow })}</label></div>
      <small class="muted">Пусто — по правилам макета (с сохранением пропорций). Тяните маркеры в документе.</small>
      ${fixed.w || fixed.h ? `<button class="btn ghost" type="button" data-tdimgreset="${esc(key)}">Вернуть размер по макету</button>` : ''}`;
  }

  static _layoutImage(sel) {
    const key = sel.key;
    return `<h4 class="td-ih">${esc(Design.IMAGES[key] || 'Картинка')}</h4>
      <h4 class="td-ih2">Размер</h4>
      ${this._layoutSize(key)}
      ${key === 'headerLogo' ? '<small class="muted">Заменить логотип — вкладка «Шапка».</small>' : ''}
      ${key === 'clientsWidthCm' ? '<small class="muted">Заменить картинку — вкладка «Объекты».</small>' : ''}
      ${/^(cover|equip|component|logo)/.test(key) ? '<p class="muted td-note">Сама картинка берётся из КП или каталога; шаблон задаёт её размер и место.</p>' : ''}
      ${this._para(`IMG_${key}`)}`;
  }

  static _px(points) {
    return (points * this.PX_NUM) / this.PX_DEN;
  }

  static _styleTexts(sel) {
    const work = Design.state.work;
    const texts = DesignModel.textsFor(sel.text || '');
    if (!texts.length) {
      return '<p class="muted td-note">Этот текст берётся из КП или каталога — здесь меняется оформление и положение.</p>';
    }
    const areas = texts
      .map(key => {
        const rows = Math.min(this.TEXT_ROWS, Math.ceil(String(work.texts[key] || '').length / this.TEXT_LINE) + 1);
        return `<label class="td-l"><span>${esc(DesignModel.textLabel(key))}</span><textarea rows="${rows}" data-tdpath="texts.${esc(key)}">${esc(work.texts[key] || '')}</textarea></label>`;
      })
      .join('');
    return `<h4 class="td-ih2">Надпись</h4>${areas}
        <small class="muted">{…} — подставляется из КП, оставьте как есть.</small>`;
  }

  static _style(sel) {
    const key = sel.key;
    if (key === 'headerText') {
      return '<h4 class="td-ih">Шапка: реквизиты</h4><p class="muted">Текст, размер и цвета шапки — на вкладке «Шапка».</p><button class="btn" type="button" data-tdtab="head">Открыть «Шапка»</button>';
    }
    const field = DesignModel.fields('style').find(row => row.key === `styles.${key}`) || {};
    const style = Design.state.work.styles[key] || {};
    const path = `styles.${esc(key)}`;
    const color = field.noColor
      ? '<p class="muted">Цвет — по частям фирменного знака (вкладка «Оформление»).</p>'
      : `<div class="td-col"><span>Цвет</span>${DesignForm.chips(`styles.${key}.color`, style.color || 'DARK')}</div>`;
    const preview = `${DesignForm.sample(style, field)};font-size:${Math.min(this.PREVIEW_MAX, this._px(+style.size || 10))}px;text-transform:${style.caps ? 'uppercase' : 'none'};letter-spacing:${this._px(+style.spacing || 0)}px`;
    return `<h4 class="td-ih">${esc(DesignModel.styleLabel(key))}</h4><small class="muted">Стиль «${esc(key)}» — меняется везде, где он встречается</small>
      <div class="td-row"><span>Размер</span><span class="td-step"><button class="icon" type="button" data-tdstep="${path}.size" data-d="-0.5">−</button>${DesignForm.number(`styles.${key}.size`, style.size ?? '', { min: 5, max: 72, step: 0.5 })}<button class="icon" type="button" data-tdstep="${path}.size" data-d="0.5">+</button></span><em>пт</em></div>
      <div class="td-row"><span>Начертание</span><span class="td-tgs">${this._toggles(path, style)}</span></div>
      <div class="td-row"><span>Разрядка</span>${DesignForm.number(`styles.${key}.spacing`, style.spacing ?? 0, { min: 0, max: 10, step: 0.25 })}<em>пт</em></div>
      ${color}
      <div class="td-prev" style="${preview}">${esc((sel.text || 'Образец').slice(0, this.PREVIEW_TEXT))}</div>
      ${this._styleTexts(sel)}
      ${this._para(key)}`;
  }

  static _section(sel) {
    const work = Design.state.work;
    const i = work.sections.findIndex(row => row.id === sel.key);
    const section = work.sections[i];
    if (!section) return '';
    const blocks = DesignModel.fields('toggle').filter(
      field => /^blocks\./.test(field.key) && Design.blockSection(field.key.slice(7)) === section.id,
    );
    const newPage =
      'newPage' in section && section.id !== 'equipment'
        ? `<label class="td-chk"><input type="checkbox" data-tdpath="sections.${i}.newPage" ${section.newPage ? 'checked' : ''}> С новой страницы</label>`
        : '';
    const checks = blocks.length
      ? `<h4 class="td-ih2">Блоки</h4>${blocks.map(field => `<label class="td-chk"><input type="checkbox" data-tdpath="${esc(field.key)}" ${getPath(work, field.key) ? 'checked' : ''}> ${esc(field.label)}</label>`).join('')}`
      : '';
    return `<h4 class="td-ih">Раздел «${esc(DesignModel.sectionName(section.id))}»</h4>
      <button class="sw" type="button" role="switch" aria-checked="${!!section.on}" data-tdsecon="${i}"><i></i>${section.on ? 'включён' : 'выключен'}</button>
      ${newPage}
      <div class="row"><button class="btn ghost" type="button" data-tdsecmv="-1" ${i ? '' : 'disabled'}>↑ Выше</button><button class="btn ghost" type="button" data-tdsecmv="1" ${i < work.sections.length - 1 ? '' : 'disabled'}>↓ Ниже</button></div>
      ${checks}
      <div class="row"><button class="btn ghost" type="button" data-td="addlabel">＋ Надпись сюда</button></div>`;
  }

  static _miniOwn(sel) {
    const work = Design.state.work;
    const item = DesignModel.item(sel);
    if (!item) return '';
    const index = work.labels.indexOf(item);
    const label =
      sel.kind === 'label'
        ? `<button type="button" data-tdstep="labels.${index}.size" data-d="-1" title="Мельче">A−</button><button type="button" data-tdstep="labels.${index}.size" data-d="1" title="Крупнее">A+</button><button type="button" data-tdtog="labels.${index}.bold" class="${item.bold ? 'on' : ''}" title="Жирный"><b>Ж</b></button><i></i>`
        : '';
    const behind =
      sel.kind === 'img' && item.float
        ? `<button type="button" data-tdtog="images.${work.images.indexOf(item)}.behind" class="${item.behind ? 'on' : ''}" title="За текстом">▤</button>`
        : '';
    return `${label}${behind}<button type="button" data-td="dup" title="Копия (Ctrl+D)">⧉</button><button type="button" data-td="del" title="Удалить (Delete)">🗑</button>`;
  }

  static _miniStyle(sel) {
    if (sel.key === 'headerText') return '';
    const work = Design.state.work;
    const path = esc(`styles.${sel.key}`);
    const style = work.styles[sel.key] || {};
    const reset = work.para[sel.key]
      ? `<button type="button" data-tdparareset="${esc(sel.key)}" title="Вернуть на место">⟲</button>`
      : '';
    return `<button type="button" data-tdstep="${path}.size" data-d="-0.5" title="Мельче">A−</button><button type="button" data-tdstep="${path}.size" data-d="0.5" title="Крупнее">A+</button>
      <button type="button" data-tdtog="${path}.bold" class="${style.bold ? 'on' : ''}" title="Жирный"><b>Ж</b></button><button type="button" data-tdtog="${path}.italic" class="${style.italic ? 'on' : ''}" title="Курсив"><i>К</i></button>${reset}`;
  }

  static _miniLayout(sel) {
    const work = Design.state.work;
    const size = work.imgSize[sel.key]
      ? `<button type="button" data-tdimgreset="${esc(sel.key)}" title="Размер по макету">⤢</button>`
      : '';
    const place = work.para[`IMG_${sel.key}`]
      ? `<button type="button" data-tdparareset="IMG_${esc(sel.key)}" title="Вернуть на место">⟲</button>`
      : '';
    return size + place;
  }

  static _miniHtml(sel) {
    if (DesignModel.isOwn(sel)) return this._miniOwn(sel);
    if (sel.kind === 'style') return this._miniStyle(sel);
    return sel.kind === 'img' ? this._miniLayout(sel) : '';
  }

  /** Мини-панель над выбранным элементом. */
  static mini() {
    const box = $('#tdMini');
    if (!box) return;
    const sel = Design.state.sel;
    const element = sel && sel.kind !== 'sec' ? DesignModel.primary() : null;
    const html = element ? this._miniHtml(sel) : '';
    if (!html) {
      box.hidden = true;
      return;
    }
    box.innerHTML = html;
    box.hidden = false;
    const canvas = $('#tdCanvas');
    const rect = element.getBoundingClientRect();
    const frame = canvas.getBoundingClientRect();
    const above = sel.kind === 'style' ? this.MINI_ABOVE_TEXT : this.MINI_ABOVE_IMAGE;
    box.style.left = `${Math.max(this.MINI_GAP, rect.left - frame.left + canvas.scrollLeft)}px`;
    box.style.top = `${Math.max(this.MINI_GAP, rect.top - frame.top + canvas.scrollTop - above)}px`;
  }
}
