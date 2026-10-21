import { ReqNum } from './req-num.js';
import { StationReq } from './station-req.js';
import { StationUi } from '../station/station-ui.js';

/** Короткая строка требований станции для заголовка блока: «12 м³/мин · 8 бар · 2 раб. + 1 рез. · от −40 °C до +35 °C». */
export class ReqLine {
  static FLOW_UNIT = { std: 'ст. м³/мин', normal: 'н. м³/мин' };

  /**
   * Строка требований.
   * @param {object} item позиция КП
   * @returns {string}
   */
  static of(item) {
    const req = StationReq.of(item);
    const kind = StationReq.kind(item);
    const ctx = { item, req, kind, air: StationUi.opts(item).air };
    return [
      ...this._main(ctx),
      this._crew(req),
      this._outdoor(ctx),
      this._value(ctx, 'alt') > 0 ? this._unit(ctx, 'alt', 'м над уровнем моря') : '',
      ...this._options(ctx),
      req.src && req.src.name ? `по ТЗ «${req.src.name}»` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  static _value({ req }, key) {
    return ReqNum.check(key, req[key]) ? null : StationReq.num(req[key]);
  }

  static _unit(ctx, key, unit) {
    const value = this._value(ctx, key);
    return value != null && value !== 0 ? `${ReqNum.comma(value)} ${unit}` : '';
  }

  static _main(ctx) {
    const { req, kind, air } = ctx;
    if (kind === 'comp') {
      return [
        this._unit(ctx, 'flow', this.FLOW_UNIT[req.basis] || 'м³/мин'),
        this._unit(ctx, 'pressure', 'бар'),
        air ? `класс ${air}` : '',
        this._value(ctx, 'margin') > 0 ? `запас ${this._unit(ctx, 'margin', '%')}` : '',
      ];
    }
    if (kind === 'dgu') {
      return [
        this._unit(ctx, 'kw', 'кВт'),
        req.mode === 'standby' ? 'резервный (ESP)' : '',
        this._value(ctx, 'load') > 0 ? `средняя нагрузка ${this._unit(ctx, 'load', '%')}` : '',
      ];
    }
    if (kind === 'pump') return [this._unit(ctx, 'q', 'м³/ч'), this._unit(ctx, 'head', 'м')];
    return [];
  }

  static _crew(req) {
    const work = StationReq.num(req.work);
    const reserve = StationReq.num(req.reserve);
    if (work > 0) return `${work} раб.${reserve > 0 ? ` + ${reserve} рез.` : ''}`;
    return reserve > 0 ? `резерв N+${reserve}` : '';
  }

  static _degrees(ctx, key) {
    const value = this._value(ctx, key);
    if (value == null) return '';
    return `${value > 0 ? '+' : ''}${ReqNum.comma(value).replace('-', '−')} °C`;
  }

  static _outdoor(ctx) {
    const low = this._degrees(ctx, 'tmin');
    const high = this._degrees(ctx, 'tmax');
    return [low ? `от ${low}` : '', high ? `до ${high}` : ''].filter(Boolean).join(' ');
  }

  static _options(ctx) {
    const { item, req, kind } = ctx;
    return [
      kind === 'comp' && req.industry ? this._industry(req.industry) : '',
      this._oil(item, req, kind),
      req.vsd && kind !== 'dgu' ? 'частотное регулирование' : '',
      req.ats ? 'два ввода с АВР' : '',
      req.scada ? 'диспетчеризация' : '',
    ];
  }

  static _industry(code) {
    const found = StationReq.INDUSTRY.find(option => option[0] === code) || ['', ''];
    return `${found[1].replace(/\s*\(.*\)$/, '')} отрасль`;
  }

  static _oil(item, req, kind) {
    if (StationReq.oilFree(item)) return 'безмасляный';
    return kind === 'comp' && req.oilOk && req.industry ? 'масляный — по требованию заказчика' : '';
  }
}
