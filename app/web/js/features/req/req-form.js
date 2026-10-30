import { ExpertLog } from './expert-log.js';
import { ReceiverSync } from './receiver-sync.js';
import { ReqNum } from './req-num.js';
import { StationReq } from './station-req.js';
import { StationQuick } from '../station/station-quick.js';
import { Toast } from '../../core/toast.js';
import { Kit } from '../kit/kit.js';
import { KpState, S } from '../../core/state.js';
import { ReceiverPlan } from '../layout/receiver-plan.js';
import { Mm } from '../layout/mm.js';
import { ExpertFix } from '../station/expert-fix.js';
import { SupplyDocs } from '../kit/supply-docs.js';
import { esc } from '../../core/util.js';
import { KpForm } from '../../core/kp-form.js';
import { StationSize } from '../kit/station-size.js';
import { StationParams } from '../kit/station-params.js';
import { Spoiler } from '../../core/spoiler.js';
import { StationPlan } from '../kit/station-plan.js';

/**
 * Форма «Все требования, условия расчёта и проверки» (под раскрывающимся блоком «Подбора станции»): проверки состава,
 * итог подбора, ресиверы, условия расчёта, режим «эксперт» ворот и вентиляции, особые требования; и изменение её полей.
 */
export class ReqForm {
  static STATIONS = ['comp', 'dgu', 'pump'];
  static VENT_COMP_ONLY = /^vent(K|Dtc)$/;

  /**
   * Форма требований.
   * @param {object} item позиция КП
   * @param {number} index
   * @returns {string}
   */
  static html(item, index) {
    const ctx = this._context(item, index);
    const { req, kind, field, select } = ctx;
    const head = this._head(ctx);
    const vent = this._vent(ctx);
    const station = this.STATIONS.includes(kind);
    return `<div class="kit-req open">${head}
      <div class="kr-g">${select('work', 'Рабочих агрегатов', StationReq.WORK, req.work || '')}
        ${field('tmin', 'Наружный воздух от, °C', '−45', 'text')}${field('tmax', 'до, °C', '+40', 'text')}
        ${select('fire', 'Категория помещения (СП 12.13130)', this._fireList(item), StationReq.fire(item))}
        ${field('noise', 'Шум на рабочем месте, не более дБА', '80', 'numeric')}</div>
      ${kind === 'comp' ? this._receivers(ctx) : ''}
      ${station ? this._conditions(ctx, vent) : ''}
      ${station ? '' : vent}
      ${kind === 'comp' ? `<label class="chk kr-out"><input type="checkbox" data-req="${index}" data-rk="recvOut"${StationReq.recvOut(item) ? ' checked' : ''}> Ресивер после подготовки — снаружи, на площадке у торца <span class="muted">(ФНП ОРПД, п. 65)</span></label>` : ''}
      <div class="kr-opts">${this._options(ctx)}</div>
      <label class="chk" title="${esc(SupplyDocs.list(item).join('; '))}"><input type="checkbox" data-req="${index}" data-rk="docs"${StationReq.docs(item) ? ' checked' : ''}> Документы при поставке — в КП <span class="muted">(паспорта, декларации ТР ТС 010, 004, 020, 032, исполнительная документация)</span></label>
      ${req.notes ? `<label class="f kr-n"><span>Прочие требования из ТЗ</span><textarea rows="3" data-p="${ctx.path}.notes" data-req="${index}">${esc(req.notes)}</textarea></label>` : ''}</div>`;
  }

  static _context(item, index) {
    const req = StationReq.of(item);
    const path = `items.${index}.req`;
    const field = (key, label, hint, mode = 'decimal', extra = '') => {
      const mark = ReqNum.mark(item, key);
      return `<label class="f"><span>${label}</span><input type="text" inputmode="${mode}" data-p="${path}.${key}" data-req="${index}" value="${esc(req[key] ?? '')}" placeholder="${esc(hint || '')}" autocomplete="off"${mark.cls ? ' class="bad"' : ''}>${mark.msg}${extra}</label>`;
    };
    const select = (key, label, list, current) => {
      const options = list
        .map(
          ([value, text]) =>
            `<option value="${esc(value)}"${String(current) === String(value) ? ' selected' : ''}>${esc(text)}</option>`,
        )
        .join('');
      return `<label class="f"><span>${label}</span><select data-req="${index}" data-rk="${key}">${options}</select></label>`;
    };
    return { item, index, req, kind: StationReq.kind(item), path, field, select, checks: StationReq.checks(item) };
  }

  static _fireList(item) {
    const auto = StationReq.fireDef(item);
    return StationReq.FIRE.map(fire => [fire, fire + (fire === auto ? ' (ориент.)' : '')]);
  }

  static _head({ req, index, checks }) {
    const chips = checks
      .map(
        check => `<span class="chip sm ${check.ok ? 'on' : 'warn'}">${check.ok ? '✓' : '⚠'} ${esc(check.text)}</span>`,
      )
      .join('');
    return `${checks.length ? `<div class="kr-ck">${chips}</div>` : ''}
      ${req.pick ? `<p class="kr-pick"><span>${esc(req.pick)}</span><button class="icon sm" type="button" data-a="reqPickX" data-i="${index}" title="Скрыть" aria-label="Скрыть итог подбора">✕</button></p>` : ''}`;
  }

  // замечания с решениями (ExpertFix): разделы своих замечаний раскрыты
  static _own(kind) {
    return [...(kind === 'comp' ? ['recv'] : []), 'vent', ...(kind === 'comp' || kind === 'pump' ? ['gate'] : [])];
  }

  static _vent({ item, index, req, kind, field, select }) {
    const fields = StationReq.VENT.filter(([reqKey]) => kind === 'comp' || !this.VENT_COMP_ONLY.test(reqKey))
      .map(([reqKey, , label, hint]) => field(reqKey, label, hint, 'text', ExpertLog.mark(item, index, reqKey)))
      .join('');
    return `<details class="kr-calc"${Spoiler.attr(`vent:${item.id}`, ExpertFix.has(item, ['vent']))}><summary>Вентиляция и отопление — режим «эксперт»</summary>
        ${ExpertFix.html(item, index, ['vent'], { all: true })}<div class="kr-g">${fields}${select('hrvType', 'Тип рекуператора', StationReq.HRV, req.hrvType || '')}</div>
        ${ExpertLog.foot(item, index, ExpertLog.VENT())}
        <p class="muted kr-hint">Для нестандартных условий. Не заданы — значения из инженерных правил (k = 0,9, нагрев воздуха в компрессоре 15 °C, t_вн = 40 °C, приток 3 м/с с запасом 10 %, выброс 4 м/с, U — по утеплителю). k и U сильнее всего влияют на результат; паспортный расход охлаждающего воздуха важнее расчёта. Компактнее — система «Вентилятор в воздуховоде выброса», рекуператор — система «Рекуператор (по требованию)».</p></details>`;
  }

  static _conditions(ctx, vent) {
    const { item, kind } = ctx;
    const open = ExpertFix.has(
      item,
      this._own(kind).filter(section => section !== 'recv'),
    );
    return `<details class="kr-calc"${Spoiler.attr(`cond:${item.id}`, open)}><summary>Условия для расчёта станции</summary><div class="kr-g">${this._conditionFields(ctx)}</div>
        <p class="muted kr-hint">Не заданы — расчёт берёт значения с запасом в пользу заказчика; они перечислены в «Расчёте станции» (вкладка «Компоновка»).</p>
        ${kind !== 'dgu' ? this._gate(ctx) : ''}${vent}</details>`;
  }

  static _conditionFields({ kind, req, field, select }) {
    const alt = field('alt', 'Высота над уровнем моря, м', '0', 'text');
    if (kind === 'pump') {
      return (
        select('liquid', 'Перекачиваемая жидкость', StationReq.LIQUID, req.liquid || '') +
        field('tliq', 'Температура жидкости, °C', '20', 'text') +
        field('hsuct', 'Высота всасывания, м (подпор — с минусом)', 'по ТЗ', 'text') +
        alt
      );
    }
    if (kind === 'comp') {
      return (
        field('margin', 'Запас производительности, %', '0 — по ТЗ') +
        alt +
        field('rh', 'Влажность воздуха, % (для н. м³)', '100 — с запасом', 'numeric') +
        field('tin', 'Воздух на входе в осушитель, °C', 'по расчёту', 'text')
      );
    }
    return (
      field('load', 'Средняя нагрузка за сутки, %', '100') +
      field('motor', 'Наибольший двигатель нагрузки, кВт', '—') +
      select('start', 'Пуск этого двигателя', StationReq.START, req.start || '') +
      alt
    );
  }

  static _gate({ item, index, req, path, field }) {
    const offset = field(
      'gateOff',
      'Смещение от оси торца, мм (+ к задней стене)',
      '0 — по оси',
      'text',
      ExpertLog.mark(item, index, 'gateOff'),
    );
    const noReason = StationReq.num(req.gateOff) && !String(req.gateWhy || '').trim();
    return `<details class="kr-calc"${Spoiler.attr(`gate:${item.id}`, ExpertFix.has(item, ['gate']))}><summary>Ворота в торце — режим «эксперт»</summary>${ExpertFix.html(item, index, ['gate'], { all: true })}<div class="kr-g">${offset}
          <label class="f kr-n"><span>Причина смещения (обязательна)</span><input type="text" data-p="${path}.gateWhy" data-req="${index}" value="${esc(req.gateWhy || '')}" maxlength="300" placeholder="например: проход к воротам у передней стены" autocomplete="off"${noReason ? ' class="bad"' : ''}></label></div>
          <p class="muted kr-hint">По умолчанию ворота — по оси торца; программа смещает их сама, только если агрегат иначе не провезти (причина — в замечаниях и ТЗ). Своё смещение без причины не сохранится в КП.</p>${ExpertLog.foot(item, index, ExpertLog.GATE)}</details>`;
  }

  static _options({ item, index, req, kind }) {
    return StationReq.OPTS.filter(([, , kinds]) => kinds.includes(kind))
      .map(([key, label]) => {
        if (key === 'oilFree' && !req.oilFree && StationReq.oilFree(item)) {
          return `<label class="chk" title="Правило: в пищевой и медицинской промышленности — только безмасляные компрессоры"><input type="checkbox" checked disabled> ${esc(label)} <span class="muted">— ${esc(StationReq.oilWhy(item))}</span></label>`;
        }
        return `<label class="chk"><input type="checkbox" data-req="${index}" data-rk="${key}"${req[key] ? ' checked' : ''}> ${esc(label)}</label>`;
      })
      .join('');
  }

  // блок «Ресиверы»: где ставить, типоразмер, ТЗ, ΔP, клапан, циклограмма, пик точки — и итог расчёта одной строкой
  static _receivers({ item, index, req, field, select }) {
    return `<details class="kr-calc"${Spoiler.attr(`recv:${item.id}`, ExpertFix.has(item, ['recv']))}><summary>Ресиверы — исходные данные и расчёт</summary>${this._receiverSum(item)}${ExpertFix.html(item, index, ['recv'], { all: true })}
      <div class="kr-g">${select('recv', 'Где ставить', StationReq.RECV, StationReq.recv(item))}${select('recvSize', 'Типоразмер', StationReq.RSIZE, req.recvSize || '')}
        ${req.recvSize === '500' || req.recvWhy ? select('recvWhy', 'Обоснование 500 л', StationReq.RWHY, req.recvWhy || '') : ''}
        ${field('recvVol', 'Объём по ТЗ, л', 'по расчёту', 'numeric')}${field('recvDp', 'ΔP разгрузка − нагрузка, бар', '1 — по правилу')}
        ${field('recvValve', 'Уставка предохранительного клапана, бар', 'по паспорту')}</div>
      <p class="kr-sub">Циклограмма потребления — если есть (приоритет 2)</p>
      <div class="kr-g">${field('recvT', 'Длительность пика T, мин', '—')}${field('recvC', 'Расход в пике C, м³/мин', '—')}${field('recvDrop', 'Допустимый перепад P1 − P2, бар', '—')}
        ${field('recvPoint', 'Пик отдельной точки, м³/мин', '—')}</div>
      <p class="muted kr-hint">Методика ПНЕВМОТЕХ: 1 — цикл V = Q / (8 · ΔP); 2 — пик V = T · (C − S) · Pa / (P1 − P2); 3 — без циклограммы 0,25 · Q (винтовой), 1 · Q (поршневой). Нужен наибольший; ресиверы — по 900 л (500 л — крайняя необходимость), мокрый до осушителя — 30–50 % основного, у потребителя — если пик точки больше 50 % компрессора.</p></details>`;
  }

  static _receiverSum(item) {
    const plan = StationReq.recvPlan(item);
    if (!plan) return '<p class="muted kr-rp">Расчёт ресиверов — после выбора компрессора с производительностью.</p>';
    const checks = plan.checks;
    const errors = checks.filter(check => check.level === 'error').length;
    return `<p class="kr-rp"><b>Приоритет ${esc(String(plan.prio))}</b>: нужно ${Mm.text(plan.theor)} л → ${esc(ReceiverPlan.text(plan))}. <span class="${this._verdictClass(checks, errors)}">${this._verdict(checks, errors)}</span></p>`;
  }

  static _verdictClass(checks, errors) {
    if (errors) return 'bad-t';
    return checks.length ? 'warn-t' : 'ok-t';
  }

  static _verdict(checks, errors) {
    if (!checks.length) return 'Все проверки пройдены.';
    const warnings = checks.length - errors;
    const errorText = errors ? `ошибок: ${errors}${warnings ? ', ' : ''}` : '';
    return `${errorText}${warnings ? `предупреждений: ${warnings}` : ''} — подробно в «Расчёте станции»`;
  }

  /** Обработчик изменения полей требований (data-req). */
  static listen() {
    document.addEventListener('change', event => {
      const target = event.target;
      if (target && target.dataset && target.dataset.req != null) this.change(target);
    });
  }

  /**
   * Поле требований изменилось.
   * @param {HTMLElement} target
   */
  static change(target) {
    const index = +target.dataset.req;
    const item = S.items[index];
    if (!item) return;
    const key = target.dataset.rk;
    const field = this._store(item, target, key);
    ExpertLog.note(item);
    if (target.dataset.stpar != null) StationParams.changed(item);
    if (key === 'recv' || key === 'recvOut') this._relayout(item);
    this._syncReceivers(item, field);
    if (this._repick({ index, item, target, key, field })) return;
    if ((key === 'ats' || key === 'scada') && target.checked) this._addCabinets(item);
    KpState.persist();
    KpForm.render();
  }

  // значение поля в требования; менеджер решил сам — подбор «снаружи» и типоразмер 500 л больше не меняет
  static _store(item, target, key) {
    const req = StationReq.ensure(item);
    if (key) req[key] = target.type === 'checkbox' ? target.checked : target.value;
    if (key === 'recvOut') delete req.recvOutAuto;
    const field =
      key ||
      String(target.dataset.p || '')
        .split('.')
        .pop();
    if (field === 'recvSize' || field === 'recvWhy') delete req.recvSizeAuto;
    return field;
  }

  static _relayout(item) {
    StationPlan.cache.delete(item.id);
    StationSize.refresh(item);
  }

  static _syncReceivers(item, field) {
    if (!ReceiverSync.KEYS.includes(field)) return;
    const changed = ReceiverSync.apply(item);
    if (!changed) return;
    Kit.sync(item);
    this._relayout(item);
    Toast.show(`Ресиверы по расчёту: ${changed}`);
  }

  // главное требование изменилось у подобранной станции — комплектующие подбираются заново, с уведомлением
  static _repick({ index, item, target, key, field }) {
    if (key === 'basis' && Kit.main(item)) {
      KpState.persist();
      StationQuick.auto(index, 'flow');
      return true;
    }
    if (!StationQuick.AUTO.includes(field) || !target.dataset.p || !Kit.main(item)) return false;
    StationReq.ensure(item)[field] = target.value;
    KpState.persist();
    StationQuick.auto(index, field);
    return true;
  }

  static _addCabinets(item) {
    const added = StationReq.ensureParts(item);
    if (!added.length) return;
    Kit.sync(item);
    this._relayout(item);
    Toast.show(`Добавлено в состав: ${added.join(', ')}`);
  }
}
