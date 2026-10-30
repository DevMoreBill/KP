import { StationRules } from '../rules/station-rules.js';
import { LayoutDigest } from '../layout/layout-digest.js';
import { StationGeo } from '../layout/station-geo.js';
import { AirChain } from '../layout/air-chain.js';
import { StationHeat } from '../layout/station-heat.js';
import { StationLight } from '../layout/station-light.js';
import { StationFire } from '../layout/station-fire.js';
import { StationPower } from '../layout/station-power.js';
import { StationDrawing } from '../draw/station-drawing.js';
import { StationLayout } from '../layout/station-layout.js';
import { StationMatrix } from '../layout/station-matrix.js';
import { StationView3D } from '../draw/station-view3d.js';
import { StationRender } from '../view/station-render.js';
import { PhotoTint } from '../view/photo-tint.js';
import { DrawPic } from '../kit/draw-pic.js';
import { EskdFont } from '../eskd/eskd-font.js';
import { EskdSheet } from '../eskd/eskd-sheet.js';
import { ItemEditor } from '../catalog/item-editor.js';
import { IssueSpot } from './issue-spot.js';
import { ExpertFix } from './expert-fix.js';
import { Mm } from '../layout/mm.js';
import { StationCalc } from '../calc/station-calc.js';
import { StationModsUi } from './station-mods-ui.js';
import { StationTidy } from '../layout/station-tidy.js';
import { StationImages } from './station-images.js';
import { ContainerKind } from '../kit/container-kind.js';
import { Kit } from '../kit/kit.js';
import { esc } from '../../core/util.js';
import { StationUi } from './station-ui.js';
import { KpState } from '../../core/state.js';
import { UiKit } from '../../core/ui-kit.js';
import { Spoiler } from '../../core/spoiler.js';
import { StationSize } from '../kit/station-size.js';
import { StationPlan } from '../kit/station-plan.js';
/**
 * Вкладка «Компоновка» карточки станции: помещается ли оборудование, замечания с решениями, разрез и виды снаружи,
 * габаритный чертёж и схема, доступ к оборудованию, подготовка воздуха, системы контейнера, расчёт и как расставляется.
 */
export class LayoutTab {
  /** пока вид рисуется */
  static BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  static RANK = { error: 0, warn: 1, info: 2 };
  static SIDES = ['F', 'B', 'L', 'R'];
  static FEW_SHEETS = 5;

  /**
   * HTML вкладки.
   * @param {object} item станция
   * @param {number} index номер позиции КП
   * @returns {string}
   */
  static html(item, index) {
    if (StationSize.apply(item)) KpState.persist();
    const plan = StationPlan.plan(item);
    if (plan.level === 'none')
      return `<div class="ed-sec stl"><p class="stl-none">${esc(plan.text)}</p>${this.how()}</div>`;
    const container = Kit.container(item);
    const opts = StationPlan.opts(item);
    const [cls, title] = this._head(plan);
    const dims = this._dims(plan, ContainerKind.of(container.ctype));
    const issues = this._issues(item, plan);
    const pics = plan.level !== 'error' && plan.geo.ext;
    const meta = StationUi.meta(item, plan);
    if (pics) this._loadAssets(item);
    StationImages.soon(item);
    const views = pics ? this._views({ item, index, plan, meta, opts }) : '';
    return `<div class="ed-sec stl">
      <div class="stl-st ${cls}"><b>${title}</b><span>${dims}${this.sizeNote(container, index)}${StationTidy.line(plan)}${this._tidyTip(plan)}</span>${plan.suggest ? StationUi.fix(plan.suggest, index) : ''}${StationModsUi.btn(item, index, plan)}</div>
      ${this._issueBlock(item, index, plan, issues)}
      ${views}
      ${this.access(plan, item)}
      ${this.air(plan, item, index)}
      ${this.systems(plan, item)}
      ${StationCalc.html(item, index)}
      ${this.how()}</div>`;
  }

  /** строка состояния: не помещается, с запасом, исключение, без продольного прохода, замечания, всё хорошо */
  static _head(plan) {
    if (plan.level === 'error')
      return [
        'err',
        plan.assumed
          ? '✕ Не помещается по условным габаритам — укажите размеры оборудования'
          : '✕ Оборудование не помещается в контейнер',
      ];
    return this._fitHead(plan);
  }

  static _fitHead(plan) {
    if (this._spare(plan)) return ['warn', '⚠ Помещается с запасом — достаточно контейнера меньше'];
    const mode = plan.mode;
    if (mode && (mode.cross || mode.tight)) return ['warn', this._exception(plan)];
    if (mode && mode.ends && plan.ends) return this._endsHead(plan);
    const warns = plan.issues.filter(issue => issue.level === 'warn');
    if (warns.length && warns.every(issue => issue.air))
      return ['warn', '⚠ Помещается — есть замечания по подготовке воздуха'];
    if (plan.level === 'warn') return ['warn', '⚠ Помещается, но часть отступов меньше рекомендуемых'];
    return ['ok', '✓ Оборудование помещается с рекомендуемыми отступами'];
  }

  /** предупреждение — только о запасе: подойдёт контейнер меньше */
  static _spare(plan) {
    return plan.suggest && plan.suggest.smaller && !plan.issues.some(issue => issue.level === 'warn' && !issue.big);
  }

  static _exception(plan) {
    const what = [
      plan.mode.tight ? 'проход оператора сужен' : '',
      plan.mode.cross && plan.cross ? 'без сквозного прохода, две двери оператора' : '',
    ].filter(Boolean);
    return `⚠ Помещается в габарит перевозки — исключение: ${what.join(', ')} (согласуйте с заказчиком)`;
  }

  static _endsHead(plan) {
    const ok = plan.level === 'ok';
    const comps = plan.ends.n > 1 ? 'компрессоры в ряд от торца' : 'компрессор у торца';
    return [
      ok ? 'ok' : 'warn',
      `${ok ? '✓' : '⚠'} Без продольного прохода: ${comps}, сервисные ворота с обеих сторон, ворота в торцах${ok ? '' : ' — см. замечания'}`,
    ];
  }

  /** «Блок-контейнер · 7 000 × 2 550 × 2 800 мм · внутри …» */
  static _dims(plan, type) {
    const geo = plan.geo;
    if (!geo.ext) return esc(type.name);
    const size = list => list.map(side => Mm.text(side)).join(' × ');
    return `${esc(type.name)} · ${size(geo.ext)} мм${plan.int ? ` · внутри ${size(plan.int)} мм` : ''}`;
  }

  static _tidyTip(plan) {
    const tidy = plan.tidy;
    if (!tidy || !(tidy.good.length || tidy.bad.length)) return '';
    const lines = [...tidy.good.map(text => `✓ ${esc(text)}`), ...tidy.bad.map(text => `• ${esc(text)}`)];
    return ` ${UiKit.tip(`<b>Аккуратность компоновки</b><br>${lines.join('<br>')}<br><span class="muted">Из вариантов равной площади программа берёт аккуратнейший («Настройки → Правила компоновки → Аккуратность»).</span>`)}`;
  }

  /** замечания (ошибки и предупреждения) и сведения, с пояснениями «изображения не готовы» и «КП не сохранится» */
  static _issues(item, plan) {
    const sorted = [...plan.issues].sort((first, second) => this.rank(first) - this.rank(second));
    const top = sorted.filter(issue => issue.level !== 'info');
    const info = sorted.filter(issue => issue.level === 'info');
    if (StationImages.issues.has(item.id))
      top.unshift({ level: 'warn', text: `Изображения не готовы: ${StationImages.issues.get(item.id)}.` });
    if (plan.level === 'error' && plan.assumed)
      info.unshift({
        level: 'info',
        text: 'Пока габариты части оборудования условные, КП сохранится, но контейнер может не подойти: впишите «Габариты» элементов на вкладке «Состав станции».',
      });
    else if (plan.level === 'error')
      info.unshift({
        level: 'info',
        text: 'КП не сохранится, пока оборудование не поместится: замените контейнер (кнопка выше) или измените состав.',
      });
    return { top, info };
  }

  /** замечания — цветным блоком (раскрыт сам, если есть замечания); сведения — там же, приглушённо */
  static _issueBlock(item, index, plan, { top, info }) {
    if (!top.length && !info.length) return '';
    const line = this._issueLine(item, index, plan);
    const count = top.length ? `<span class="stl-cnt">⚠ ${top.length}</span>` : '<span class="ok-t">✓ нет</span>';
    const infoBlock = info.length
      ? `<details class="stl-inf"${Spoiler.attr(`inf:${item.id}`, !top.length && plan.level === 'error')}><summary>Сведения о компоновке: ${info.length} — ворота, двери, ресиверы, отопление, вентиляция</summary><ul class="stl-iss">${info.map(line).join('')}</ul></details>`
      : '';
    return `<details class="stl-air stl-sp stl-isb ${this._issueClass(top)}"${Spoiler.attr(`iss:${item.id}`, top.length > 0)}><summary class="stl-air-h"><b>Замечания по компоновке</b>${count}</summary>
        ${top.length ? `<ul class="stl-iss">${top.map(line).join('')}</ul>` : ''}
        ${infoBlock}</details>`;
  }

  static _issueClass(top) {
    if (top.some(issue => issue.level === 'error')) return 'err';
    return top.length ? 'warn' : 'ok';
  }

  /** строка замечания: «на чертеже» и «решить» (режим «эксперт»; список замечаний — один раз на вкладку) */
  static _issueLine(item, index, plan) {
    let fixes = null;
    const fix = issue => {
      if (issue.level === 'info') return '';
      fixes = fixes || ExpertFix.list(item);
      return ExpertFix.btn(item, index, issue.text, fixes);
    };
    return issue => {
      const place = plan.issues.indexOf(issue);
      const spot =
        place >= 0 && IssueSpot.has(issue.text, plan)
          ? ` <button class="lnk is-spot" type="button" data-a="stSpot" data-i="${index}" data-j="${place}" title="Открыть чертёж с подсветкой">на чертеже</button>`
          : '';
      return `<li class="${issue.level}">${esc(issue.text)}${spot}${fix(issue)}</li>`;
    };
  }

  /** чертёж — встроенным шрифтом, как в КП; свои рисунки моделей; цвет оборудования — по его фото */
  static _loadAssets(item) {
    const redraw = changed => {
      if (changed) ItemEditor.render();
    };
    if (!EskdSheet.FONT_DATA) EskdFont.load().then(redraw);
    if (DrawPic.pending(item)) DrawPic.load(item).then(redraw);
    if (PhotoTint.pending(item)) PhotoTint.load(item).then(redraw);
  }

  /** разрез (3D-вид), виды снаружи с четырёх сторон (WebGL), чертёж и схема; пока рисуется — прежний вид, затем подмена */
  static _views({ item, index, plan, meta, opts }) {
    const photoOn = item.photo ? item.photo.gen === 'st3d' : opts.photo;
    const ready = StationRender.cached(plan);
    const src = ready ? ready.src : StationUi.url(StationView3D.svg(plan, meta));
    if (!ready) StationRender.image(plan, meta).then(image => this._swap(image, plan.hash));
    const webgl = StationRender.ok();
    const outs = webgl
      ? StationPlan.VIEWS.map(([, angle, cap]) => ({
          az: angle,
          cap,
          ready: StationRender.cached(plan, 'out', angle),
        }))
      : [];
    for (const out of outs)
      if (!out.ready)
        StationRender.image(plan, meta, 'out', out.az).then(image => this._swapOut(image, plan.hash, out.az));
    const cutCab = plan.items.some(unit => unit.mount === 'wall' && unit.wall === 'front');
    return `<div class="stl-views">
        <figure class="v3d"><figcaption><b>Разрез (3D-вид)</b><label class="stl-chk"><input type="checkbox" data-stl="photo" data-i="${index}"${photoOn ? ' checked' : ''}> главное фото станции — в строке КП и на титуле</label></figcaption>
          <img src="${esc(src)}" data-st3d="${esc(plan.hash || '')}" alt="3D-вид станции">${cutCab ? '<small class="stl-note">Стена прохода срезана вместе со шкафами на ней — их место на чертеже.</small>' : ''}</figure>
        ${webgl ? this._outside(plan, index, opts, outs) : ''}
        ${this.sheets(plan, meta, index, opts)}
        ${this._scheme(plan, meta, index, opts)}</div>`;
  }

  static _swap(image, hash) {
    if (!image) return;
    for (const img of document.querySelectorAll('img[data-st3d]')) if (img.dataset.st3d === hash) img.src = image.src;
  }

  static _swapOut(image, hash, angle) {
    if (!image) return;
    for (const img of document.querySelectorAll('img[data-st3do]')) {
      if (img.dataset.st3do === hash && img.dataset.az === String(angle)) {
        img.src = image.src;
        img.classList.remove('wait');
      }
    }
  }

  static _outside(plan, index, opts, outs) {
    const pics = outs
      .map(
        out =>
          `<div><img src="${esc(out.ready ? out.ready.src : this.BLANK)}"${out.ready ? '' : ' class="wait"'} data-st3do="${esc(plan.hash || '')}" data-az="${out.az}" alt="${esc(out.cap)}"><small>${esc(out.cap)}</small></div>`,
      )
      .join('');
    return `<figure class="v3d stl-out"><figcaption><b>Вид снаружи — 4 стороны</b><label class="stl-chk"><input type="checkbox" data-stl="out" data-i="${index}"${opts.out ? ' checked' : ''}> в КП — в изображениях позиции</label></figcaption>
          <div class="stl-out4">${pics}</div></figure>`;
  }

  static _scheme(plan, meta, index, opts) {
    const scheme = StationUi.scheme(plan);
    if (!scheme) return '';
    return `<figure class="dr"><figcaption><b>${esc(scheme.title)}</b><label class="stl-chk"><input type="checkbox" data-stl="scheme" data-i="${index}"${opts.scheme ? ' checked' : ''}> в КП — после чертежа</label></figcaption>
          <img src="${esc(StationUi.url(scheme.cls.svg(plan, meta)))}" alt="${esc(scheme.name)}"></figure>`;
  }

  /**
   * Матрица доступа: к каждой стороне агрегата — чем подойти (проход, зазор, ворота), класс по ширине.
   * @param {object} plan
   * @param {object} item
   * @returns {string}
   */
  static access(plan, item) {
    const rows = plan.access || [];
    if (!rows.length) return '';
    const bad = rows.filter(row => row.miss.length).length;
    const cell = side => `<td class="${this._cellClass(side)}">${side.ok ? '' : '⚠ '}${esc(side.t)}</td>`;
    const body = rows
      .map(
        row =>
          `<tr><td>${esc(row.pos)}</td><td>${esc(row.name || '')}</td>${this.SIDES.map(key => cell(row.s[key])).join('')}<td>${esc(row.cls)}</td></tr>`,
      )
      .join('');
    return `<details class="stl-air stl-sp"${Spoiler.attr(`acc:${item.id}`, bad > 0)}><summary class="stl-air-h"><b>Доступ к оборудованию</b>${bad ? `<span class="warn-t">⚠ ${bad}</span>` : '<span class="ok-t">✓ ко всем сторонам</span>'}</summary>
      <div class="tzi-tw"><table class="tzi-t stl-acc"><thead><tr><th>Поз.</th><th>Оборудование</th>${this.SIDES.map(key => `<th>${StationLayout.SIDE[key][0]}</th>`).join('')}<th>Класс</th></tr></thead><tbody>
      ${body}</tbody></table></div>
      <p class="muted" style="margin:6px 0 0">Какие стороны обслуживаются у вида оборудования, сколько нужно места и когда ставятся ворота — «Настройки → Инженерные правила станций → Матрица расстановки». Класс: узкое — помещается с основным проходом; широкое — с проходом «в крайнем случае» и сервисными воротами; сверхширокое — только поперёк или шире габарита перевозки.</p></details>`;
  }

  static _cellClass(side) {
    if (!side.ok) return 'warn-t';
    return side.t === 'не требуется' ? 'muted' : '';
  }

  /**
   * Габаритный чертёж — все листы в полный размер, один под другим; лист, повёрнутый на 90°, на экране повёрнут обратно.
   * @param {object} plan
   * @param {object} meta
   * @param {number} index
   * @param {object} opts
   * @returns {string}
   */
  static sheets(plan, meta, index, opts) {
    const list = StationDrawing.sheets(plan, meta);
    const count = list.length;
    const pages = list
      .map((svg, page) => {
        const img = `<img src="${esc(StationUi.url(svg))}" alt="Габаритный чертёж станции, лист ${page + 1}">`;
        return svg.includes(' rotate(90)">') ? `<div class="stl-rot">${img}</div>` : img;
      })
      .join('');
    return `<figure class="dr${count > 1 ? ' dr-all' : ''}"><figcaption><b>Габаритный чертёж${count > 1 ? ` — ${count} ${this._sheetsWord(count)}` : ''}</b><label class="stl-chk"><input type="checkbox" data-stl="draw" data-i="${index}"${opts.draw ? ' checked' : ''}> в КП — после характеристик${count > 1 ? ', все листы' : ''}</label></figcaption>
          <div class="stl-sheets">${pages}</div></figure>`;
  }

  static _sheetsWord(count) {
    return count < this.FEW_SHEETS ? 'листа' : 'листов';
  }

  /**
   * Порядок замечаний: ошибки, предупреждения, сведения.
   * @param {{level: string}} issue
   * @returns {number}
   */
  static rank(issue) {
    return this.RANK[issue.level] ?? 3;
  }

  /**
   * Системы контейнера по расчёту — коротко; подробно — в ТЗ на сборку.
   * @param {object} plan
   * @param {object} item
   * @returns {string}
   */
  static systems(plan, item) {
    const power = plan.power;
    if (!power) return '';
    const rows = [
      this._powerRow(power),
      this._lightRow(plan.light),
      this._socketsRow(plan.sockets),
      this._fireRow(plan.fire),
      this._heatRow(plan.heat),
      this._pipeRow(plan.pipe),
    ];
    return `<details class="stl-air stl-sys stl-sp"${Spoiler.attr(`sys:${item ? item.id : ''}`)}><summary class="stl-air-h"><b>Системы контейнера и электропитание</b><span class="muted">${StationPower.fmt(power.inst)} кВт, ввод ${this._breaker(power)} — подробно в ТЗ на сборку</span></summary><ul class="stl-sys-l">
      ${rows.join('\n      ')}</ul></details>`;
  }

  static _row(key, value) {
    return value ? `<li><b>${esc(key)}:</b> ${esc(value)}</li>` : '';
  }

  static _breaker(power) {
    return power.breaker ? `${power.breaker} А` : 'по проекту';
  }

  static _powerRow(power) {
    const fmt = StationPower.fmt;
    const own = power.dgu ? 'собственные нужды' : 'расчётная';
    return this._row(
      'Мощность',
      `установленная (с системами контейнера) ${fmt(power.inst)} кВт, ${own} — ${fmt(power.kw)} кВт (${power.mode === 'run' ? 'при работе' : 'зимой в простое'}); ток ${fmt(power.amp)} А при 3 × 400 В; вводной автомат — ${this._breaker(power)}`,
    );
  }

  static _lightRow(light) {
    if (!light || !light.on) return '';
    const lamps = StationFire.plural(light.n, ['светильник', 'светильника', 'светильников']);
    return this._row(
      'Освещение',
      `${lamps} по ${StationLight.LAMP.w} Вт — около ${Math.round(light.E)} лк на 0,8 м (норма ${light.lux}); аварийное — ${light.em} с блоком питания на 1 ч${light.floods ? `; прожекторов над дверями — ${light.floods}` : ''}`,
    );
  }

  static _socketsRow(sockets) {
    if (!sockets) return '';
    return this._row(
      'Розетки',
      `230 В — ${sockets.n230}, 380 В — ${sockets.n380}, ЯТП-0,25 (36 В) — ${sockets.ytp}; на высоте 1 м`,
    );
  }

  static _fireRow(fire) {
    if (!fire) return '';
    const auto = fire.auto
      ? `; модули «Буран-2,5» на потолке — ${fire.mods} (по площади, объёму и геометрии распыла${fire.rooms.some(room => room.shade) ? ', над затенёнными зонами' : ''})`
      : '';
    const category =
      fire.cat && fire.cat !== 'Д'
        ? `; категория ${fire.cat}${fire.zone ? `, зона ${fire.zone}` : ''} — табличка на двери`
        : '';
    return this._row(
      'Пожарная безопасность',
      `огнетушители ${StationFire.EXT} — ${fire.ext}${auto}${fire.ops ? '; щит ОПС у входа' : ''}${category}`,
    );
  }

  static _heatRow(heat) {
    if (!heat || !heat.on || !heat.n) return '';
    return this._row('Отопление', `${heat.n} × ${StationHeat.kw(heat.kw)} кВт = ${StationHeat.kw(heat.total)} кВт`);
  }

  static _pipeRow(pipe) {
    if (!pipe) return '';
    const lines = pipe.lines.map(line => `${line.name} — DN ${line.dn}`).join(', ');
    return this._row(
      'Трубопровод',
      `${lines} по расчёту (${pipe.why}, не более ${StationFire.dec1(pipe.lines[0].v)} м/с)${pipe.small ? ` — в составе DN ${pipe.set}, мало` : ''}`,
    );
  }

  /**
   * Подготовка воздуха: цепочка по ходу воздуха, класс чистоты (ISO 8573-1), чего не хватает — подобрать в каталоге.
   * @param {object} plan
   * @param {object} item
   * @param {number} index
   * @returns {string}
   */
  static air(plan, item, index) {
    const air = plan.air;
    if (!air) return '';
    const flow = value => AirChain.flowText(value);
    const missing = air.recs.length
      ? `<span class="warn-t">⚠ не хватает: ${air.recs.length}</span>`
      : '<span class="ok-t">✓ цепочка полная</span>';
    const recs = air.recs
      .map(
        (rec, row) =>
          `<li><span><b>${esc(rec.title)}</b> — ${esc(rec.why)}</span><button class="btn sm" type="button" data-a="stlRec" data-i="${index}" data-k="${row}">${rec.replace ? 'Заменить — подобрать в каталоге' : 'Подобрать в каталоге'}</button></li>`,
      )
      .join('');
    return `<details class="stl-air stl-sp"${Spoiler.attr(`air:${item.id}`)}><summary class="stl-air-h"><b>Подготовка воздуха</b>${missing}${air.q ? `<span class="muted">компрессоры — ${flow(air.work > 0 ? air.work : air.q)} м³/мин${air.q - air.work > 0 && air.work > 0 ? ` + ${flow(air.q - air.work)} в резерве` : ''} при ${flow(air.bar)} бар</span>` : ''}</summary>
      <div class="stl-chain">${this._chain(air)}<span class="stl-arr">→</span><span class="stl-node">потребителю</span></div>
      ${air.chain.some(step => step.guess) ? '<p class="muted stl-hint">Пунктиром — фильтр, у которого не указана ступень очистки: место выбрано по виду осушителя. Укажите «Ступень очистки» в характеристиках фильтра (предварительная, тонкая, сверхтонкая, угольный).</p>' : ''}
      ${this._grade(StationPlan.opts(item).air, index)}${recs ? `<p class="stl-rec-h">Не хватает в составе:</p><ul class="stl-recs">${recs}</ul>` : ''}</details>`;
  }

  static _chain(air) {
    return air.chain
      .map(
        step =>
          `<span class="stl-node${step.guess ? ' guess' : ''}"${step.guess ? ' title="Ступень фильтра не указана — место выбрано по виду осушителя"' : ''}>${esc(step.text)} <small>поз. ${step.pos}</small></span>`,
      )
      .join('<span class="stl-arr">→</span>');
  }

  static _grade(current, index) {
    const options = AirChain.options(current)
      .map(
        ([value, text]) => `<option value="${esc(value)}"${current === value ? ' selected' : ''}>${esc(text)}</option>`,
      )
      .join('');
    return `<label class="f stl-cls"><span>Класс чистоты воздуха по ISO 8573-1 (частицы.вода.масло)</span><select data-stl="air" data-i="${index}"><option value="">не задан — проверка по составу</option>${options}</select></label>`;
  }

  /**
   * Подпись размера блок-контейнера: подобран или задан вручную (вернуть подбор).
   * @param {object} container
   * @param {number} index
   * @returns {string}
   */
  static sizeNote(container, index) {
    if (!container || !StationGeo.FLEX[container.ctype]) return '';
    const size = String(container.size || '').trim();
    if (container.sizeAuto && size) return ' · размер подобран по оборудованию';
    return size
      ? ` · размер задан вручную — <button type="button" class="lnk" data-a="stlAuto" data-i="${index}">подобрать по оборудованию</button>`
      : '';
  }

  /**
   * Как расставляется оборудование и какие отступы (свод правил — из действующих значений).
   * @returns {string}
   */
  static how() {
    const raw = key => StationRules.raw(key);
    const ref = raw('dryer.ref');
    const cab = StationMatrix.grp('cab');
    return `<details class="stl-how"><summary>Как расставляется оборудование и какие отступы</summary>
      <p>Оборудование стоит вдоль задней стены лицевой стороной к проходу обслуживания (проход — вдоль стены с дверью); если не хватает длины, а ширина позволяет, — в два ряда с проходом посередине. Порядок — как в составе станции (стрелки ↑↓ на вкладке «Состав станции»), у компрессорной — по ходу воздуха; ДГУ — в дальнем торце радиатором к жалюзи. Габариты, масса и цвет — из характеристик элементов (цвет контейнера — поле «Цвет» в составе).</p>
      <p>Сжатый воздух — последовательно, по ходу: компрессоры → коллектор → «мокрый» ресивер → фильтры до осушителя → осушитель → фильтры после → угольный → «сухой» ресивер → потребителю. У осушителя, ресивера и фильтра — один вход и один выход: магистраль проходит через них, у ресивера вход внизу, выход вверху. Фильтры — по ступени очистки (поле «Ступень очистки» или название): предварительный и тонкий — перед осушителем, сверхтонкий от масла — после рефрижераторного; перед адсорбционным — всегда фильтр очистки от масла, после него — пылевой; угольный — последним. Фильтр без указанной ступени ставится по виду осушителя. Встроенные фильтры осушителя и встроенный осушитель компрессора учитываются. Фильтры висят на трубопроводе у осушителя — там, где к ним подойти из прохода (колба и элемент снимаются вниз).</p>
      <p>Подбор: осушитель и фильтры — не меньше суммы производительности компрессоров с поправкой на давление (номинал — при ${ref.p} бар, +${ref.inlet} °C на входе, +${ref.ambient} °C вокруг, ISO 7183), осушитель — ещё с поправками производителя на температуру воздуха на входе и в помещении летом (наружная — по требованиям, иначе +${raw('heat.t_summer')} °C, в помещении — на ${raw('heat.vent_dt')} °C выше, на входе — ещё на ${raw('dryer.inlet_dt')} °C), как в расчётной записке; ресивер — около ${Mm.text(1000 / (raw('receiver.method').cycles * raw('pressure.band')))} л на 1 м³/мин компрессора с регулированием «нагрузка — холостой ход» (с частотным — меньше). Класс чистоты по ISO 8573-1 (частицы.вода.масло) — какой нужен осушитель (вода 1–3 — адсорбционный, 4–6 — рефрижераторный) и какие ступени фильтров. Чего не хватает — кнопка «Подобрать в каталоге»: каталог открывается с нужным видом, ступенью и производительностью.</p>
      <p>Шкафы — на стене и не мешают проходу оператора: перед шкафом — не меньше прохода обслуживания (ПУЭ, п. 4.1.23: у щитов не менее 0,8 м в свету; сужение до 0,6 м допускается только строительными конструкциями). Сначала — на стене прохода у двери напротив промежутка между оборудованием, затем — на торце у двери или на дальнем торце, затем — на стене прохода с проходом «не менее»; низ — от ${Mm.text(cab.low)} мм, верх — до ${Mm.dec(cab.top / 1000)} м. Напольный шкаф (выбрано в составе, назван так или большой по габаритам) — в ряду у двери. Дверь оператора — не уже ${Mm.text(StationMatrix.grp('door').w)} мм в свету, открывается наружу.</p>
      <p><b>Свод правил компоновки</b> <span class="muted">— действующие значения; правятся в «Настройки → Инженерные правила станций → Правила компоновки»</span></p>${LayoutDigest.html()}
      <p>${this._howVent()}</p>
      <p>ДГУ: радиатор — вплотную к своей двери-жалюзи (зазор — «Настройки → Правила компоновки → ДГУ в контейнере»), у каждой ДГУ — свой выброс горячего воздуха и свой выхлоп. Одна ДГУ — вдоль, радиатором к дальнему торцу; две без бака — по одной у каждого торца радиаторами наружу, вход — между ними; три и больше (и две с баком) — поперёк, радиаторами к задней стене, у каждой — дверь-жалюзи в стене. Выхлоп — в глушитель на крыше над своей ДГУ (если он есть в составе), иначе — через заднюю стену (глушитель встроен в ДГУ). Дополнительный бак — в отсеке у торца: прямоугольный, габариты — по расчётному объёму; вход — ворота в торце, горловина — в нише с лючком заподлицо, топливопровод — по полу; конвекторы у ДГУ — плотнее (высота с глушителем — на чертеже; при перевозке глушитель снимают: с платформой — не выше 4 м). Трубопровод — вдоль задней стены с отводами к оборудованию и выходом через дальний торец; материал (сталь, нержавеющая сталь, полипропилен) — в «Составе станции», цвет трассы на чертеже и 3D-виде — по материалу.</p>
      <p>Разрез (3D-вид) и вид снаружи с четырёх сторон рисуются по расстановке: перспектива, мягкие тени, окраска по RAL, оцинковка, нержавеющая сталь, полипропилен. В разрезе стена со стороны зрителя срезана (шкафы на ней — на чертеже), ворота в торцах видны изнутри. Без WebGL2 (старая видеокарта, удалённый рабочий стол) — упрощённый вид.</p>
      <p>Морской контейнер, в который всё не помещается, — ошибка (КП не сохраняется) и подсказка, какой подойдёт; с большим запасом — подсказка, какой меньший (в том числе 10 футов) подойдёт так же.</p>
      <p>Чертёж — лист А4 по ЕСКД: рамка и основная надпись (ГОСТ Р 2.104), литера «П» — техническое предложение, масштаб из ряда ГОСТ 2.302, линии — ГОСТ 2.303, шрифт типа Б — ГОСТ 2.304, разрезы А–А и Б–Б и вид слева — ГОСТ 2.305, размеры габаритные, установочные и присоединительные — ГОСТ 2.307 и ГОСТ Р 2.109; оборудование — узнаваемые упрощённые рисунки, схематически сходные с изделием (компрессор с пультом, жалюзи и рамой, ресивер с люком, клапаном и манометром, осушитель с вентилятором, адсорбционный — с двумя колоннами, фильтр с индикатором и стаканом, шкаф с дверью и панелью, ДГУ, насос, бак); перечень составных частей, техническая характеристика и технические требования — ГОСТ 2.316. Схема пневматическая принципиальная (компрессорная) — ГОСТ 2.701 и 2.704, обозначения — ГОСТ 2.780, 2.781, 2.782, 2.785 и ISO 1219-1; позиции — те же, что в составе станции и на чертеже. Обозначение документа (например, «ПНЕВ.012345.001 ГЧ») — по организации из шаблона КП и отпечатку расстановки: тот же состав — то же обозначение.</p></details>`;
  }

  /** вентиляция — с действующими значениями правил */
  static _howVent() {
    const raw = key => StationRules.raw(key);
    const dec = value => String(value).replace('.', ',');
    const temps = raw('vent.temps');
    const speed = raw('vent.speed');
    const ach = raw('vent.ach');
    const boost = raw('vent.boost');
    const exfan = StationRules.opt('vent.exfan') || {};
    return `Вентиляция (решение ПНЕВМОТЕХ — сбалансированная, подробно — «Расчёт станции»): тепло компрессора Q = N · k (k = ${dec(raw('vent.k_heat').def.screw)} по умолчанию, паспортное тепловыделение важнее); воздух охлаждения — по паспорту, иначе его собственный вентилятор: L = Q · 3600 / (c · ρ · Δt_к), нагрев воздуха в компрессоре Δt_к = ${raw('heat.cool_dt')} °C, горячий воздух — воздуховодом наружу (помещение не греет). Тепло помещения (корпуса, осушители, солнце) — перепадом Δt = t_вн − t_нар (t_вн = ${temps.tIn} °C; меньше ${temps.dtMin} °C — предупреждение); компрессор протягивает воздух через помещение — приток один: больший из охлаждения и вентиляции помещения плюс воздух на сжатие, не меньше ${ach.min} объёмов в час; воздух у входа компрессора — не выше t_вн. При остановке — вытяжной вентилятор с термостатом (не меньше ${raw('vent.fan').stand} м³/ч). Проёмы — по рамке: приток S = L / (3600 · ${dec(speed.in)}) · ${dec(speed.inReserve)}, выброс S = L / (3600 · ${dec(speed.out)}); больше ${speed.max} м/с — предупреждение (Atlas Copco); воздуховод с жалюзи — не более ${speed.ductDp} Па для штатного вентилятора компрессора. Компактнее — система «Вентилятор в воздуховоде выброса» (приток ${dec(boost.vIn)} м/с, выброс ${dec(boost.vOut)} м/с) или «Вытяжные вентиляторы» — осевые вентиляторы вверху стены напротив притока, по датчику температуры (приток ${dec(exfan.vIn ?? 4)} м/с, выброс ${dec(exfan.vOut ?? 6)} м/с по рамке); если приточные жалюзи целиком не встают — программа сама ставит приточные вентиляторы на недостающий расход. Зимой — баланс: тепло работающего компрессора против потерь ограждений (U по утеплителю) и минимального воздухообмена (${ach.winter} объёма в час); жалюзи прикрываются до нужной доли (не меньше ${Math.round(raw('vent.winter').openMin * 100)} %). Свои значения (k, нагрев в компрессоре, Δt, скорости, U, КПД рекуператора) — «Условия для расчёта» → «Вентиляция и отопление — режим «эксперт»». Приток и выброс горячего воздуха — никогда на одной стене: выброс — сбоку, вверху задней стены над компрессором или над его сервисными воротами (короб-воздухоотвод от компрессора), в створки ворот выброс не ставится; не хватает — в торец, если компрессор стоит у торца и в торце нет ворот; иначе — через крышу, и тогда через крышу все компрессоры, каналы одного размера; у ДГУ — дверь-жалюзи радиатора в дальнем торце; приток — внизу на стене напротив выброса, затем в створках ворот и сервисных дверей, затем на остальных стенах (у ДГУ — дальше от радиатора). На воздуховодах компрессоров — клапаны рециркуляции: зимой тёплый воздух — в помещение (рекуперация тепла). Приток — одним проёмом (до 2 400 мм шириной), если где-то помещается; иначе — наименьшим числом одинаковых. Система контейнера «Маркизы на приточных жалюзи»: над каждой приточной жалюзи — откидной козырёк на петлях; открытый — с раскрывающимися боковыми створками-ограничителями, воздух входит только снизу, угол открытия — по расчёту (скорость на входе не более ${dec(raw('vent.hood_v'))} м/с, 30…75°); закрытый — закрывает проём как щит. Приток — выше конвекторов (вход над снегом), не ближе 300 мм к дверям. «Маркизы на жалюзи выброса» — по требованию: открытые направляют горячий воздух вниз, закрытые — щит. Размеры и места — на чертеже.`;
  }
}
