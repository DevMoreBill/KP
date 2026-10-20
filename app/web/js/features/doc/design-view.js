import { Design } from './design.js';
import { DesignDemo } from './design-demo.js';
import { DesignInspector } from './design-inspector.js';
import { DesignModel } from './design-model.js';
import { DesignPanels } from './design-panels.js';
import { KpDocx } from './kp-docx.js';
import { PreviewDocx } from './preview-docx.js';

/**
 * Графический редактор шаблона: документ в окне (как в Word), масштаб, выделение, места привязки и координаты на странице.
 */
export class DesignView {
  static DELAY = 400;
  static DRAG_WAIT = 300;
  static TWIPS_PER_CM = 567;
  static PAGE_CM = 21;
  static PX_PER_CM = 37.8;
  static FIT = { min: 0.35, max: 1.4, pad: 40 };
  static ZOOM = { min: 0.3, max: 2.5, steps: 20 };
  static HERE = { view: 0.3, top: 60, bottom: 120, left: 0.3 };
  static SNAP = 7;
  static SECTION_SLACK = 2;
  static MARKS = [
    ['tds', /^docx_kps_(.+)$/, 'styles'],
    ['tdi', /^docx_kpi_(.+)$/, 'images'],
    ['tdsec', /^docx_kpsec_(.+)$/, 'sections'],
    ['tdanc', /^docx_kpanc_(.+)$/, 'anchors'],
  ];

  /** Перестроить документ (с задержкой — после набора). */
  static preview() {
    clearTimeout(Design.state.timer);
    Design.state.timer = setTimeout(() => this._run(), this.DELAY);
  }

  /** Перестроить документ сразу. */
  static previewNow() {
    clearTimeout(Design.state.timer);
    Design.state.timer = setTimeout(() => this._run(), 0);
  }

  // пример КП: черновик пользователя не сохраняется и не меняется
  static async _build() {
    const demo = await DesignDemo.state();
    const previous = S;
    const editing = CATED;
    const settings = Object.assign(JSON.parse(JSON.stringify(Design.state.work)), { design: true });
    if (demo) {
      S = demo;
      CATED = 'designer';
    }
    try {
      const state = KpDocx.state();
      if (!state.number) state.number = S.number || 'ПРИМЕР';
      return await KpDocx.render(state, Design.state.pack, settings);
    } finally {
      if (demo) {
        S = previous;
        CATED = editing;
      }
    }
  }

  static async _run() {
    const state = Design.state;
    if (!state.work || state.err || !$('#tdPages')) return;
    if (state.busy) {
      state.again = true;
      return;
    }
    if (state.drag) {
      state.timer = setTimeout(() => this._run(), this.DRAG_WAIT); // не перестраивать документ под рукой
      return;
    }
    state.busy = true;
    state.again = false;
    $('#tdCanvas').classList.add('busy');
    try {
      await this._show();
    } catch (error) {
      const pages = $('#tdPages');
      if (pages) pages.innerHTML = `<p class="msg err">Документ не построен: ${esc(error.message || error)}</p>`;
    } finally {
      state.busy = false;
      const canvas = $('#tdCanvas');
      if (canvas) canvas.classList.remove('busy');
      if (state.again) this.previewNow();
    }
  }

  static async _show() {
    const canvas = $('#tdCanvas');
    const blob = await this._build();
    const host = document.createElement('div');
    await PreviewDocx.renderInto(blob, host);
    const pages = $('#tdPages');
    if (!pages) return;
    const { scrollTop, scrollLeft } = canvas;
    pages.replaceChildren(...host.childNodes);
    this._tag();
    if (!Design.state.zoom) this.fit();
    else this.zoom(0);
    canvas.scrollTop = scrollTop;
    canvas.scrollLeft = scrollLeft;
    this.markSelection();
  }

  static _maps() {
    const work = Design.state.work;
    const maps = { styles: {}, images: {}, labels: {}, sections: {}, anchors: {} };
    Object.keys(work.styles || {})
      .concat(['headerText'])
      .forEach(key => {
        maps.styles[key.toLowerCase()] = key;
      });
    Object.keys(Design.IMAGES).forEach(key => {
      maps.images[key.toLowerCase()] = key;
    });
    work.images.forEach(image => {
      maps.images[`X_${image.id}`.toLowerCase()] = `X_${image.id}`;
    });
    work.labels.forEach(label => {
      maps.labels[`L_${label.id}`.toLowerCase().slice(2)] = `L_${label.id}`;
    });
    work.sections.forEach(section => {
      maps.sections[section.id.toLowerCase()] = section.id;
      maps.anchors[`${section.id}Top`.toLowerCase()] = `${section.id}Top`;
      maps.anchors[`${section.id}End`.toLowerCase()] = `${section.id}End`;
    });
    return maps;
  }

  static _mark(element, name, maps) {
    for (const [data, pattern, map] of this.MARKS) {
      const found = pattern.exec(name);
      if (found && maps[map][found[1]]) {
        element.dataset[data] = maps[map][found[1]];
        return;
      }
    }
    const label = /^docx_kpl_(.+)$/.exec(name);
    if (label && maps.labels[label[1]] && !element.closest('.kp-float')) {
      element.dataset.tdl = maps.labels[label[1]];
      element.classList.add('kp-lbl');
    }
  }

  // пометки скелета (стили KPS_, картинки KPI_, разделы KPSEC_, места привязки KPANC_) → атрибуты для выбора мышью
  static _tag() {
    const maps = this._maps();
    for (const element of Design.queryAll('[class*="docx_kp"]')) {
      for (const name of element.classList) this._mark(element, name, maps);
    }
  }

  static _pageCm() {
    const found = /<w:pgSz[^>]*w:w="(\d+)"/.exec(Design.state.pack.sect || '');
    return found ? +found[1] / this.TWIPS_PER_CM : this.PAGE_CM;
  }

  /**
   * Пикселей экрана в сантиметре страницы.
   * @returns {number}
   */
  static pxPerCm() {
    const page = Design.query('section.docx');
    return page ? page.getBoundingClientRect().width / this._pageCm() : this.PX_PER_CM * (Design.state.zoom || 1);
  }

  /** Масштаб по ширине окна. */
  static fit() {
    const canvas = $('#tdCanvas');
    const page = Design.query('section.docx');
    if (!canvas || !page) return;
    const { min, max, pad } = this.FIT;
    const steps = this.ZOOM.steps;
    Design.state.zoom = Math.max(
      min,
      Math.min(max, Math.round(((canvas.clientWidth - pad) / page.offsetWidth) * steps) / steps),
    );
    this.zoom(0);
  }

  /**
   * Изменить масштаб (0 — применить текущий).
   * @param {number} step
   */
  static zoom(step) {
    const { min, max, steps } = this.ZOOM;
    Design.state.zoom = Math.max(min, Math.min(max, Math.round(((Design.state.zoom || 1) + step) * steps) / steps));
    const pages = $('#tdPages');
    if (pages) pages.style.zoom = Design.state.zoom;
    DesignPanels.top();
    this.markSelection();
  }

  /** Выделение: рамка с маркерами вокруг картинки или надписи, подсветка всех мест стиля, мини-панель. */
  static markSelection() {
    document.querySelectorAll('#tdPages .td-on').forEach(element => element.classList.remove('td-on'));
    const box = $('#tdSelBox');
    if (box) box.hidden = true;
    const sel = Design.state.sel;
    if (!sel) {
      DesignInspector.mini();
      return;
    }
    DesignModel.elements(sel).forEach(element => element.classList.add('td-on'));
    const element = DesignModel.primary();
    if (element && box && (sel.kind === 'img' || sel.kind === 'label')) this.placeBox(element.getBoundingClientRect());
    DesignInspector.mini();
  }

  /**
   * Рамка выделения по прямоугольнику на экране.
   * @param {{left: number, top: number, width: number, height: number}} rect
   */
  static placeBox(rect) {
    const box = $('#tdSelBox');
    const canvas = $('#tdCanvas');
    if (!box || !canvas) return;
    const frame = canvas.getBoundingClientRect();
    const perCm = this.pxPerCm();
    Object.assign(box.style, {
      left: `${rect.left - frame.left + canvas.scrollLeft}px`,
      top: `${rect.top - frame.top + canvas.scrollTop}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    box.querySelector('.td-dim').textContent =
      `${Design.cmText(rect.width / perCm)} × ${Design.cmText(rect.height / perCm)} см`;
    box.hidden = false;
  }

  /**
   * Выбрать объект (null — снять выбор).
   * @param {object|null} sel
   * @param {{scroll?: boolean}} [options] scroll — показать выбранное в документе
   */
  static select(sel, options = {}) {
    Design.state.sel = sel;
    DesignPanels.panels();
    this.markSelection();
    if (!options.scroll || !sel) return;
    const element = sel.kind === 'sec' ? Design.query(`[data-tdsec="${CSS.escape(sel.key)}"]`) : DesignModel.primary();
    if (element) element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else if (sel.kind === 'style') toast('Этот стиль сейчас не встречается в документе');
  }

  /**
   * Места привязки в документе.
   * @returns {object[]} [{el, place, r, page}]
   */
  static anchors() {
    return Design.queryAll('[data-tdanc]').map(element => ({
      el: element,
      place: element.dataset.tdanc,
      r: element.getBoundingClientRect(),
      page: element.closest('section.docx'),
    }));
  }

  /**
   * Страница под точкой экрана.
   * @param {number} y
   * @returns {HTMLElement|null}
   */
  static pageAt(y) {
    return (
      Design.queryAll('section.docx').find(page => {
        const rect = page.getBoundingClientRect();
        return y >= rect.top && y <= rect.bottom;
      }) || null
    );
  }

  /**
   * Точка на экране → место привязки (ближайшее выше на той же странице) и смещение от него в см.
   * @param {number} x
   * @param {number} y
   * @returns {{place: string, x: number, y: number, far: boolean}|null} far — привязано к разделу на другой странице
   */
  static anchorFor(x, y) {
    const all = this.anchors();
    if (!all.length) return null;
    const page = this.pageAt(y);
    const same = page ? all.filter(anchor => anchor.page === page) : [];
    let anchor = same.filter(row => row.r.top <= y + 1).pop() || same[0];
    let far = false;
    if (!anchor) {
      anchor = all.filter(row => row.r.top <= y).pop() || all[0];
      far = true;
    }
    const perCm = this.pxPerCm();
    return {
      place: anchor.place,
      x: Design.round((x - anchor.r.left) / perCm, Design.CENTS),
      y: Design.round((y - anchor.r.top) / perCm, Design.CENTS),
      far,
    };
  }

  /**
   * Место для нового объекта — видимая часть листа.
   * @returns {{place: string, x: number, y: number}}
   */
  static here() {
    const view = $('#tdCanvas').getBoundingClientRect();
    const near = view.top + view.height * this.HERE.view;
    const page = this.pageAt(near) || Design.query('section.docx');
    if (!page)
      return {
        place: `${(Design.state.work.sections.find(section => section.on) || { id: 'cover' }).id}Top`,
        x: 0,
        y: 0,
      };
    const rect = page.getBoundingClientRect();
    const y = Math.max(rect.top + this.HERE.top, Math.min(rect.bottom - this.HERE.bottom, near));
    return this.anchorFor(rect.left + rect.width * this.HERE.left, y) || { place: 'coverTop', x: 0, y: 0 };
  }

  /**
   * Раздел документа под точкой: последняя метка начала раздела выше неё.
   * @param {number} y
   * @returns {string|null}
   */
  static sectionAt(y) {
    let best = null;
    for (const mark of Design.queryAll('[data-tdsec]')) {
      if (mark.getBoundingClientRect().top <= y + this.SECTION_SLACK) best = mark.dataset.tdsec;
    }
    return best || (Design.state.work.sections.find(section => section.on) || {}).id || null;
  }

  /**
   * Направляющие: левый край, центр и правый край текста страницы и центр листа (притягивают в пределах 6 px).
   * @param {number} left
   * @param {number} width
   * @param {HTMLElement|null} page
   * @returns {{dx: number, x?: number|null}}
   */
  static snapX(left, width, page) {
    const anchor = this.anchors().find(row => row.page === page) || this.anchors()[0];
    if (!anchor) return { dx: 0 };
    const columns = [anchor.r.left, anchor.r.left + anchor.r.width / 2, anchor.r.right];
    if (page) {
      const rect = page.getBoundingClientRect();
      columns.push(rect.left + rect.width / 2);
    }
    const edges = [
      [left, 0],
      [left + width / 2, width / 2],
      [left + width, width],
    ];
    let best = { dx: 0, distance: this.SNAP, x: null };
    for (const column of columns) {
      for (const [edge, offset] of edges) {
        const distance = Math.abs(edge - column);
        if (distance < best.distance) best = { dx: column - edge, distance, x: column, offset };
      }
    }
    return best;
  }

  /**
   * Вертикальная направляющая (null — убрать).
   * @param {number|null} x
   */
  static guide(x) {
    const line = $('#tdGuide');
    const canvas = $('#tdCanvas');
    if (!line) return;
    if (x == null) {
      line.hidden = true;
      return;
    }
    const frame = canvas.getBoundingClientRect();
    line.style.left = `${x - frame.left + canvas.scrollLeft}px`;
    line.style.top = `${canvas.scrollTop}px`;
    line.style.height = `${canvas.clientHeight}px`;
    line.hidden = false;
  }
}
