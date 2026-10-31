import { Design } from './design.js';
import { DesignForm } from './design-form.js';
import { DesignInspector } from './design-inspector.js';
import { DesignModel } from './design-model.js';
import { TemplateFields } from './template-fields.js';
import { Templates } from './templates.js';
import { ObjPath } from '../../core/str.js';
import { $, esc } from '../../core/util.js';
import { DocxPage } from './docx-parts.js';

/** Графический редактор шаблона: окно, верхняя панель и левая панель (структура, оформление, шапка, объекты). */
export class DesignPanels {
  static TABS = [
    ['struct', 'Структура'],
    ['look', 'Оформление'],
    ['head', 'Шапка'],
    ['objs', 'Объекты'],
  ];
  static HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  static MARGINS = { top: 'Верхнее', bottom: 'Нижнее', left: 'Левое', right: 'Правое' };
  static BLOCK_GROUPS = ['cover', 'equipment', 'offer', 'all'];
  static PANELS = { struct: '_struct', look: '_look', head: '_head' };
  static LABEL_SHOWN = 40;

  /**
   * Окно редактора целиком.
   * @param {HTMLDialogElement} dialog окно дизайнера (TemplateDesigner.dialog — окно подключает панели)
   */
  static render(dialog) {
    const state = Design.state;
    const tabs = this.TABS.map(
      ([key, title]) =>
        `<button type="button" role="tab" data-tdtab="${key}" aria-selected="${state.tab === key}">${title}</button>`,
    ).join('');
    const handles = this.HANDLES.map(handle => `<i class="td-h td-h-${handle}" data-h="${handle}"></i>`).join('');
    dialog.innerHTML = `<div class="td-top" id="tdTop"></div>
    ${state.err ? `<p class="msg err td-err">Шаблон не открывается в графическом редакторе: ${esc(state.err)}</p>` : ''}
    <div class="td-main">
      <aside class="td-left"><nav class="td-tabs" role="tablist">${tabs}</nav><div class="td-panel" id="tdPanel"></div></aside>
      <div class="td-canvas" id="tdCanvas"><div class="td-pages" id="tdPages"></div>
        <div class="td-sel" id="tdSelBox" hidden>${handles}<span class="td-dim"></span></div>
        <div class="td-mini" id="tdMini" hidden></div><div class="td-guide" id="tdGuide" hidden></div></div>
      <aside class="td-right" id="tdInsp"></aside>
    </div>
    <div class="td-foot"><span id="tdState" class="muted"></span><span class="muted">Перетаскивайте мышью · маркеры — размер (Shift — пропорционально) · стрелки — точный сдвиг · Delete · Ctrl+D — копия · Ctrl+Z</span></div>`;
    this.panels();
  }

  static _topHtml() {
    const state = Design.state;
    const off = state.err ? 'disabled' : '';
    const options = Templates.list
      .filter(template => !template.error)
      .map(
        template =>
          `<option value="${esc(template.id)}"${template.id === state.id ? ' selected' : ''}>${esc(template.name)}</option>`,
      )
      .join('');
    return `<h3>Графический редактор</h3>
    <select class="td-pick" aria-label="Шаблон">${options}</select>
    <span class="td-grp"><button class="icon" type="button" data-td="undo" title="Отменить (Ctrl+Z)">↶</button><button class="icon" type="button" data-td="redo" title="Повторить (Ctrl+Y)">↷</button></span>
    <span class="td-grp"><button class="icon" type="button" data-td="zout" title="Мельче (Ctrl + колесо мыши)">−</button><button class="btn ghost td-zv" type="button" data-td="zfit" title="По ширине окна">—</button><button class="icon" type="button" data-td="zin" title="Крупнее">+</button></span>
    <span class="td-grp td-add"><button class="btn ghost" type="button" data-td="addlabel" ${off} title="Надпись в любом месте страницы">＋ Надпись</button><label class="btn ghost" title="Картинка в любом месте страницы: печать, подпись, баннер…">＋ Картинка<input type="file" accept="image/png,image/jpeg" hidden data-tdup="extra"></label></span>
    <span class="sp"></span>
    <button class="btn ghost" type="button" data-td="form" title="Все настройки шаблона формой: надписи, правила, файлы, история версий">Форма</button>
    <button class="btn" type="button" data-td="docx" ${off} title="Скачать .docx с этими настройками (без записи в журнал)">Пробный DOCX</button>
    <button class="btn" type="button" data-td="saveas" ${off} title="Сохранить как отдельный шаблон — например, для другой компании группы">Сохранить как новый…</button>
    <button class="btn primary" type="button" data-td="save">Сохранить</button>
    <button class="icon" type="button" data-td="close" aria-label="Закрыть">✕</button>`;
  }

  /**
   * Верхняя панель: строится один раз, дальше меняются только состояния кнопок — иначе щелчок, во время которого поле
   * теряет фокус (и окно обновляется), попадал бы в уже удалённую кнопку.
   */
  static top() {
    const state = Design.state;
    const panel = $('#tdTop');
    if (!panel) return;
    if (!panel.firstChild || panel.dataset.id !== state.id) {
      panel.dataset.id = state.id;
      panel.innerHTML = this._topHtml();
    }
    const button = action => panel.querySelector(`[data-td="${action}"]`);
    const dirty = Design.dirty();
    button('undo').disabled = !state.undo.length;
    button('redo').disabled = !state.redo.length;
    button('save').disabled = !!state.err || !dirty;
    button('zfit').textContent = state.zoom ? `${Math.round(state.zoom * 100)}%` : '—';
    const line = $('#tdState');
    if (!line) return;
    line.textContent = dirty ? 'Есть несохранённые изменения' : state.note || 'Изменений нет';
    line.className = this._stateClass(dirty);
  }

  static _stateClass(dirty) {
    if (dirty) return 'warn';
    return Design.state.note ? 'okn' : 'muted';
  }

  /** Верхняя, левая и правая панели и мини-панель — по состоянию. */
  static panels() {
    const state = Design.state;
    this.top();
    const panel = $('#tdPanel');
    if (panel && state.work) {
      const scroll = panel.scrollTop;
      panel.innerHTML = this.html();
      panel.scrollTop = scroll;
    }
    document
      .querySelectorAll('#tddlg [data-tdtab]')
      .forEach(button => button.setAttribute('aria-selected', String(button.dataset.tdtab === state.tab)));
    const inspector = $('#tdInsp');
    if (inspector && state.work) {
      const scroll = inspector.scrollTop;
      inspector.innerHTML = DesignInspector.html();
      inspector.scrollTop = scroll;
    }
    DesignInspector.mini();
  }

  /**
   * Левая панель выбранной вкладки.
   * @returns {string}
   */
  static html() {
    const method = this.PANELS[Design.state.tab] || '_objects';
    return this[method](Design.state.work);
  }

  static _blockBox(work, blocks, group) {
    const list = blocks.filter(field => Design.blockSection(field.key.slice(7)) === group);
    if (!list.length) return '';
    const checks = list
      .map(
        field =>
          `<label class="td-chk"><input type="checkbox" data-tdpath="${esc(field.key)}" ${ObjPath.get(work, field.key) ? 'checked' : ''}> ${esc(field.label)}</label>`,
      )
      .join('');
    return `<div class="td-blk"><b>${esc(group === 'all' ? 'Все страницы' : DesignModel.sectionName(group))}</b>${checks}</div>`;
  }

  static _struct(work) {
    const sel = Design.state.sel;
    const blocks = DesignModel.fields('toggle').filter(field => /^blocks\./.test(field.key));
    const sections = work.sections
      .map(
        (
          section,
          i,
        ) => `<li data-tdsec="${i}" class="${section.on ? '' : 'off'}${sel && sel.kind === 'sec' && sel.key === section.id ? ' on' : ''}">
        <span class="td-drag" aria-hidden="true">⋮⋮</span><button type="button" class="td-secname" data-tdgo="${esc(section.id)}">${esc(DesignModel.sectionName(section.id))}</button>
        <button class="sw" type="button" role="switch" aria-checked="${!!section.on}" data-tdsecon="${i}" title="${section.on ? 'Раздел включён' : 'Раздел выключен'}"><i></i></button></li>`,
      )
      .join('');
    return `<p class="muted td-hint">Перетащите раздел, чтобы поменять порядок. Щелчок по названию — показать раздел.</p>
      <ol class="td-secs" id="tdSecs">${sections}</ol>
      <h4 class="td-h">Блоки внутри разделов</h4>
      ${this.BLOCK_GROUPS.map(group => this._blockBox(work, blocks, group)).join('')}`;
  }

  static _styleGroups() {
    const groups = [];
    const fields = (Design.state.form.tabs || []).filter(tab => tab.id === 'styles').flatMap(tab => tab.fields || []);
    for (const field of fields) {
      if (field.type === 'group') groups.push({ title: field.title, list: [] });
      else if (field.type === 'style') {
        if (!groups.length) groups.push({ title: 'Стили', list: [] });
        groups[groups.length - 1].list.push(field);
      }
    }
    return groups;
  }

  static _margin(work, side) {
    const found = new RegExp(`<w:pgMar[^>]*w:${side}="(\\d+)"`).exec(Design.state.pack.sect || '');
    const base = found ? Design.cmText(+found[1] / DocxPage.TWIPS_PER_CM) : '';
    const value = (work.page || {})[side];
    return `<label class="td-n"><span>${this.MARGINS[side]}</span><input type="number" min="0.5" max="6" step="0.1" data-tdpage="${side}" value="${esc(value ?? '')}" placeholder="${esc(base)}"></label>`;
  }

  static _styleList(work) {
    const sel = Design.state.sel;
    return this._styleGroups()
      .map(group => {
        const buttons = group.list
          .map(field => {
            const key = field.key.slice(7);
            const style = ObjPath.get(work, field.key) || {};
            const active = sel && sel.kind === 'style' && sel.key === key ? ' on' : '';
            return `<button type="button" class="td-sty${active}" data-tdstyle="${esc(key)}"><span style="${DesignForm.sample(style, field)}">Аа</span>${esc(field.label)}</button>`;
          })
          .join('');
        return `<details class="td-sg"><summary>${esc(group.title)}</summary>${buttons}</details>`;
      })
      .join('');
  }

  static _brand(work) {
    const parts = (work.brandParts || [])
      .map(
        (part, i) =>
          `<span class="td-bp"><input type="text" data-tdbrand="${i}" value="${esc(part[0] || '')}"><select data-tdbrandc="${i}">${DesignForm.colorOptions(part[1])}</select><button class="icon" type="button" data-tdbranddel="${i}" title="Убрать">✕</button></span>`,
      )
      .join('');
    return `<div class="td-brand">${parts}
        <button class="btn ghost" type="button" data-td="brandadd">+ Часть</button></div>`;
  }

  static _look(work) {
    const info = Templates.pageInfo(Design.state.pack.sect);
    const moved = Object.keys(work.para || {}).length + Object.keys(work.imgSize || {}).length;
    const names = DesignModel.colorNames();
    const palette = Object.keys(work.colors || {})
      .map(
        color =>
          `<label class="td-sw" title="${esc(names[color] || color)}"><input type="color" data-tdcolor="${esc(color)}" value="#${esc(DesignModel.colorHex(color))}"><span>${esc(names[color] || color)}</span></label>`,
      )
      .join('');
    const fonts = TemplateFields.FONTS.map(font => `<option value="${esc(font)}">`).join('');
    const movedHtml = moved
      ? `<h4 class="td-h">Сдвиги и размеры мышью</h4><p class="muted td-hint">Изменено элементов макета: ${moved}.</p><button class="btn ghost" type="button" data-td="resetmoves">Вернуть все на места</button>`
      : '';
    return `<h4 class="td-h">Шрифт документа</h4>
      <input type="text" list="tdFonts" data-tdpath="font" value="${esc(work.font || '')}" class="td-font"><datalist id="tdFonts">${fonts}</datalist>
      <small class="muted">Шрифт должен быть установлен на компьютерах, где открывают КП.</small>
      <h4 class="td-h">Фирменные цвета</h4>
      <div class="td-pal">${palette}</div>
      <h4 class="td-h">Фирменный знак</h4>
      ${this._brand(work)}
      <label class="td-f"><span>Сайт</span><input type="text" data-tdpath="site" value="${esc(work.site || '')}"></label>
      <h4 class="td-h">Поля страницы, см</h4>
      <div class="td-marg">${['top', 'bottom', 'left', 'right'].map(side => this._margin(work, side)).join('')}</div>
      <small class="muted">Пусто — как в основе Word (${esc(info || 'base.docx')}).</small>
      ${movedHtml}
      <h4 class="td-h">Стили текста</h4><p class="muted td-hint">Или щёлкните текст в документе.</p>
      ${this._styleList(work)}`;
  }

  static _head(work) {
    const header = work.header || {};
    return `<p class="muted td-hint">Своя шапка на каждой странице — логотип и реквизиты компании. Включите её для новой компании, чтобы не править base.docx в Word.</p>
      <button class="sw" type="button" role="switch" aria-checked="${!!header.on}" data-tdtog="header.on"><i></i>Шапка из настроек</button>
      <div class="td-hdr${header.on ? '' : ' dis'}">${this._headLogo(header)}${this._headText(header)}
      </div>`;
  }

  static _headLogo(header) {
    const logo = header.logo;
    return `
        <h4 class="td-h">Логотип</h4>
        <div class="td-img1">${logo ? `<img src="${Design.imageUrl(logo)}" alt="">` : '<span class="muted">Нет логотипа</span>'}</div>
        <div class="row"><label class="btn ghost">${logo ? 'Заменить…' : 'Загрузить…'}<input type="file" accept="image/png,image/jpeg" hidden data-tdup="header"></label>${logo ? '<button class="btn ghost" type="button" data-td="hdrlogodel">Убрать</button>' : ''}</div>
        <div class="td-wh"><label class="td-n"><span>Ширина, см</span>${DesignForm.number('header.logoWidthCm', header.logoWidthCm ?? 4, { min: 0.5, max: 12 })}</label><label class="td-n"><span>Высота, см</span>${DesignForm.number('header.logoHeightCm', +header.logoHeightCm || '', { min: 0, max: 8, ph: 'авто' })}</label></div>
        <div class="td-row2"><span>Логотип</span>${DesignForm.segment('header.logoSide', header.logoSide || 'left', [
          ['left', 'слева'],
          ['right', 'справа'],
        ])}</div>`;
  }

  static _headText(header) {
    return `
        <h4 class="td-h">Реквизиты</h4>
        <textarea rows="5" data-tdpath="header.lines" placeholder="ООО «Компания»&#10;ИНН 0000000000, г. Москва, ул. …&#10;+7 (000) 000-00-00 · info@site.ru">${esc(header.lines || '')}</textarea>
        <small class="muted">Каждая строка — отдельная строка шапки. Первая может быть крупнее и другим цветом.</small>
        <label class="td-f"><span>Размер текста, пт</span>${DesignForm.number('header.textSize', header.textSize ?? 8, { min: 5, max: 16, step: 0.5 })}</label>
        <label class="td-f"><span>Цвет текста</span><select data-tdpath="header.textColor">${DesignForm.colorOptions(header.textColor || 'GRAY')}</select></label>
        <label class="td-chk"><input type="checkbox" data-tdpath="header.firstBold" ${header.firstBold ? 'checked' : ''}> Первая строка жирнее и крупнее</label>
        <label class="td-f"><span>Цвет первой строки</span><select data-tdpath="header.firstColor">${DesignForm.colorOptions(header.firstColor || 'BLUE')}</select></label>
        <label class="td-chk"><input type="checkbox" data-tdpath="header.rule" ${header.rule !== false ? 'checked' : ''}> Линия под шапкой</label>
        <label class="td-f"><span>Цвет линии</span><select data-tdpath="header.ruleColor">${DesignForm.colorOptions(header.ruleColor || 'LINE')}</select></label>`;
  }

  static _on(key) {
    const sel = Design.state.sel;
    return sel && sel.key === key ? ' on' : '';
  }

  static _labelRow(label) {
    const title = esc(
      String(label.text || '')
        .split('\n')[0]
        .slice(0, this.LABEL_SHOWN) || 'Надпись',
    );
    return `<button type="button" class="td-ix${this._on(`L_${label.id}`)}" data-tdpick="label" data-key="L_${esc(label.id)}">
        <span class="td-ixi td-ixt" style="color:#${DesignModel.colorHex(label.color || 'DARK')}">Аа</span><span><b>${title}</b><small class="muted">Надпись · ${label.float ? 'свободно' : 'в тексте'}</small></span></button>`;
  }

  static _imageRow(image) {
    const height = +image.heightCm ? ` × ${Design.cmText(image.heightCm)}` : '';
    return `<button type="button" class="td-ix${this._on(`X_${image.id}`)}" data-tdpick="img" data-key="X_${esc(image.id)}">
        <img class="td-ixi" src="${Design.imageUrl(image.file)}" alt=""><span><b>${esc(image.name || image.file)}</b><small class="muted">Картинка · ${image.float ? 'свободно' : 'в тексте'} · ${Design.cmText(image.widthCm)}${height} см</small></span></button>`;
  }

  // свои картинки и надписи, картинка «Наши клиенты»
  static _objects(work) {
    const clients = work.clientsImage;
    const empty =
      !work.labels.length && !work.images.length ? '<p class="muted">Пока нет своих надписей и картинок.</p>' : '';
    return `<div class="row td-addrow"><button class="btn" type="button" data-td="addlabel">＋ Надпись</button><label class="btn">＋ Картинка<input type="file" accept="image/png,image/jpeg" hidden data-tdup="extra"></label></div>
    <p class="muted td-hint">Появляются в видимой части листа. Перетащите мышью в любое место, тяните за маркеры — размер.</p>
    <div class="td-imgs">${work.labels.map(label => this._labelRow(label)).join('')}
      ${work.images.map(image => this._imageRow(image)).join('')}
      ${empty}</div>
    <h4 class="td-h">Картинка «Наши клиенты»</h4>
    <div class="td-img1">${clients ? `<img src="${Design.imageUrl(clients)}" alt="">` : '<span class="muted">Нет картинки — страница не выводится</span>'}</div>
    <div class="row"><label class="btn ghost">${clients ? 'Заменить…' : 'Загрузить…'}<input type="file" accept="image/png,image/jpeg" hidden data-tdup="clients"></label>${clients ? '<button class="btn ghost" type="button" data-td="clientsdel">Убрать</button>' : ''}</div>`;
  }
}
