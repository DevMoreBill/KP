import { Kit } from '../kit/kit.js';
import { StationReq } from '../req/station-req.js';

/**
 * Три шага над «Подбором станции»: требования → подбор → проверка и КП. Готовый шаг — ✓, текущий — выделен; нажатие
 * прокручивает к месту шага.
 */
export class StationSteps {
  // [шаг, подпись, что сделать, куда прокрутить]
  static STEPS = [
    ['req', 'Требования', 'главное — производительность, мощность или подача; или ТЗ заказчика', '.sq-g'],
    ['pick', 'Подбор', 'кнопка «Подобрать оборудование»', '.sq-a'],
    ['check', 'Проверка и КП', 'итог, замечания и изображения для КП', '.sq-r'],
  ];

  /**
   * Полоса шагов.
   * @param {object} item станция
   * @param {{need: string, status: string}} state need — ключ главного требования, status — итог подбора (ok, warn, bad)
   * @returns {string}
   */
  static html(item, { need, status }) {
    const req = StationReq.of(item);
    const done = {
      req: StationReq.num(req[need]) > 0 || Boolean(req.src && req.src.name),
      pick: Boolean(Kit.main(item)),
      check: status === 'ok',
    };
    const current = this.STEPS.find(([key]) => !done[key]);
    const steps = this.STEPS.map(([key, label, hint, place], number) => {
      const cls = [done[key] ? 'done' : '', current && current[0] === key ? 'now' : ''].join(' ').trim();
      return `<li class="${cls}"><button type="button" data-sqstep="${place}" title="${hint}"><i>${done[key] ? '✓' : number + 1}</i><span>${label}</span></button></li>`;
    }).join('');
    return `<ol class="sq-steps" aria-label="Шаги подбора станции">${steps}</ol>`;
  }

  /** Нажатие по шагу — к его месту. */
  static listen() {
    document.addEventListener('click', event => {
      const button = event.target.closest && event.target.closest('[data-sqstep]');
      if (!button) return;
      const box = button.closest('.sq');
      const target = box && box.querySelector(button.dataset.sqstep);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
}
