import { Mm } from '../layout/mm.js';
import { AirDemand } from './air-demand.js';
import { CalcInput } from './calc-input.js';
import { CalcNote } from './calc-note.js';
import { DryerSizing } from './dryer-sizing.js';
import { ElectricLoad } from './electric-load.js';
import { FilterSizing } from './filter-sizing.js';
import { GensetSizing } from './genset-sizing.js';
import { PressureBudget } from './pressure-budget.js';
import { PumpSizing } from './pump-sizing.js';
import { ReceiverSizing } from './receiver-sizing.js';
import { VentSizing } from './vent-sizing.js';

const f = CalcNote.f;
const LEVEL = { error: 'Ошибка — станция не пройдёт', warn: 'Предупреждение' };
const li = L => L.map(a => `<li>${esc(a)}</li>`).join('');
const KINDS = {
  comp(N, q, plan) {
    const A = AirDemand.run(N, q);
    const P = PressureBudget.run(N, q);
    DryerSizing.run(N, q, A, P);
    FilterSizing.run(N, q, A, P);
    ReceiverSizing.run(N, q);
    ElectricLoad.run(N, q, plan);
  },
  dgu(N, q, plan) {
    GensetSizing.run(N, q, ElectricLoad.run(N, q, plan));
  },
  pump(N, q, plan) {
    PumpSizing.run(N, q);
    ElectricLoad.run(N, q, plan);
  },
};

/**
 * Расчёт модульной станции по требованиям заказчика, составу и инженерным правилам: каждый шаг — данные, формула,
 * коэффициенты с источником, результат и запас. Вкладка «Компоновка» и приложение к КП «Расчётная записка».
 */
export class StationCalc {
  static cache = new Map();

  static run(x) {
    const q = CalcInput.of(x);
    const plan = StationUi.plan(x);
    const key = JSON.stringify([
      ReqNum.errors(x),
      q.req,
      q.cls,
      !!StationReq.of(x).accept,
      q.units.map(u => [u.name, u.qty, u.attrs]),
      StationRules.version() + StationRules.stamp(),
      plan.hash,
    ]);
    const c = StationCalc.cache.get(x.id);
    if (c && c.key === key) return c.res;
    const N = new CalcNote();
    if (!StationRules.ok()) {
      N.issue('warn', 'Файл инженерных правил станций не загружен — расчёт не выполнен.');
      return N.result();
    }
    StationCalc.inputErrors(N, x, plan);
    try {
      (KINDS[q.kind] || ElectricLoad.run)(N, q, plan);
      VentSizing.run(N, plan);
    } catch (e) {
      N.issue('warn', `Расчёт прерван: ${String((e && e.message) || e).slice(0, 200)}`);
    }
    const res = N.result();
    res.accept = !!StationReq.of(x).accept;
    StationCalc.cache.set(x.id, { key, res });
    return res;
  }

  /** Ошибки ввода требований и смещение ворот без причины — «согласованием» не снимаются. */
  static inputErrors(N, x, plan) {
    for (const e of ReqNum.errors(x))
      N.issue('error', `Требования: «${e.label}» — ${e.text}. Исправьте значение в «Подборе станции».`);
    for (const G of [plan.gates, plan.gates2].filter(g => g && g.off && !g.offWhy)) {
      N.issue(
        'error',
        `Требования: «Причина смещения ворот» — ворота в торце смещены от оси на ${Mm.text(Math.abs(G.off))} мм без причины; укажите причину («Условия для расчёта станции» → «Ворота в торце»).`,
      );
    }
  }

  /** Блокирующие ошибки: КП не сохраняется, пока их не исправят или не отметят «отклонения согласованы». */
  static errors(x) {
    if (!StationUi.on(x) || !isKit(x)) return [];
    const R = StationCalc.run(x);
    return R.accept ? R.errors.filter(e => /^Требования: «/.test(e.text)) : R.errors;
  }

  /** Блок «Расчёт станции» на вкладке «Компоновка»: под раскрытием (открыт при ошибке). */
  static html(x, i) {
    const R = StationCalc.run(x);
    const o = StationUi.opts(x);
    const [cls, text] = StationCalc.head(R);
    const iss = R.issues.filter(t => t.level !== 'info');
    const accept = R.errors.length
      ? `<label class="stl-chk"><input type="checkbox" data-req="${i}" data-rk="accept"${R.accept ? ' checked' : ''}> отклонения согласованы с заказчиком — КП сохраняется</label>`
      : '';
    return `<details class="stl-air calc stl-sp"${Spoiler.attr(`calc:${x.id}`, !!(R.errors.length && !R.accept))}><summary class="stl-air-h"><b>Расчёт станции</b><span class="${cls}">${text}</span><small class="muted">формулы, коэффициенты, источники · правила ${esc(R.version)}</small></summary>
      <div class="calc-opts"><label class="stl-chk"><input type="checkbox" data-stl="calc" data-i="${i}"${o.calc ? ' checked' : ''}> в КП — приложение «Расчётная записка» (только по запросу заказчика: ТКП — без расчётов)</label>
        ${accept}</div>
      ${iss.length ? `<ul class="stl-iss">${iss.map(t => `<li class="${t.level}"><b>${LEVEL[t.level]}:</b> ${esc(t.text)}</li>`).join('')}</ul>` : ''}
      ${R.questions.length ? `<h5 class="calc-h">Нужно узнать у заказчика</h5><ol class="calc-l">${li(R.questions)}</ol>` : ''}
      ${StationCalc.sections(R) || '<p class="muted">Укажите производительность и давление (или мощность нагрузки) в «Подборе станции» — расчёт появится здесь.</p>'}
      ${StationCalc.more(R, x)}
      <p class="stl-hint muted">Условия для расчёта (высота, влажность, запас, к каким условиям приведена производительность, нагрузка ДЭС) — в «Подборе станции» → «Все требования, условия расчёта и проверки».
        <button class="btn ghost sm" type="button" data-rulesdoc>Инженерные правила и источники (DOCX)</button></p></details>`;
  }

  static head(R) {
    if (R.errors.length)
      return [
        'bad-t',
        `✕ Ошибок: ${R.errors.length}${R.accept ? ' — отклонения согласованы с заказчиком' : ' — КП не сохранится'}`,
      ];
    if (R.warnings.length) return ['warn-t', `⚠ Предупреждений: ${R.warnings.length}`];
    return R.sections.length ? ['ok-t', '✓ Проверки пройдены'] : ['muted', 'нет данных для расчёта'];
  }

  /** Шаги расчёта по разделам: отметка, что и по какой формуле, данные, результат, запас, источники. */
  static sections(R) {
    const mark = { true: '<b class="ok-t">✓</b>', false: '<b class="bad-t">✕</b>' };
    const src = ids => [...new Set((ids || []).map(id => StationRules.short(id)))].join('; ');
    const row = o => {
      const data = (o.data || []).length
        ? `<div class="calc-d">${o.data.map(([k, v]) => `<span>${esc(k)}: ${esc(v)}</span>`).join('')}</div>`
        : '';
      const rules = (o.rules || []).length ? `<div class="calc-src">${esc(src(o.rules))}</div>` : '';
      return `<tr><td class="calc-s">${mark[o.ok] || ''}</td>
      <td><b>${esc(o.what)}</b>${o.formula ? `<div class="calc-f">${esc(o.formula)}</div>` : ''}${data}${o.note ? `<div class="muted">${esc(o.note)}</div>` : ''}</td>
      <td class="calc-res">${esc(o.result || '')}${StationCalc.margin(o)}${rules}</td></tr>`;
    };
    return R.sections
      .map(
        s =>
          `<h5 class="calc-h">${esc(s.title)}</h5><table class="calc-t"><tbody>${s.steps.map(row).join('')}</tbody></table>`,
      )
      .join('');
  }

  static margin(o) {
    if (o.margin == null) return '';
    let cls = 'muted';
    if (o.margin < 0) cls = o.ok ? 'warn-t' : 'bad-t';
    return `<div class="${cls}">запас ${o.margin > 0 ? '+' : ''}${f(o.margin, 1)} %</div>`;
  }

  /** Допущения, «требует подтверждения» и уточнения «на потом» — ещё одним раскрытием. */
  static more(R, x) {
    const n = R.assumptions.length + R.weak.length + R.later.length;
    if (!n) return '';
    const weak = R.weak
      .map(
        w =>
          `<li>${esc(w.title)}${w.src && w.src !== 'нет данных' ? ` <span class="muted">— ${esc(w.src)}</span>` : ''}</li>`,
      )
      .join('');
    return `<details class="calc-more"${Spoiler.attr(`calcm:${x.id}`)}><summary>Допущения и данные «по умолчанию» (${n}) — расчёт принял их с запасом в пользу заказчика</summary>
        ${R.assumptions.length ? `<h5 class="calc-h">Допущения</h5><ul class="calc-l">${li(R.assumptions)}</ul>` : ''}
        ${R.weak.length ? `<h5 class="calc-h">Требует подтверждения</h5><ul class="calc-l">${weak}</ul>` : ''}
        ${R.later.length ? `<h5 class="calc-h">Можно уточнить у заказчика позже</h5><ul class="calc-l">${li(R.later)}</ul>` : ''}</details>`;
  }

  /**
   * Приложение к КП «Расчётная записка и состав станции» — группы {name, rows: [{k, v}]}. ТКП: записка — только галочкой;
   * согласованные отклонения — всегда; заказчику — только расчёт и допущения (внутренние списки остаются в программе).
   */
  static docGroups(x) {
    if (!StationUi.on(x) || !isKit(x)) return [];
    const R = StationCalc.run(x);
    if (!R.sections.length) return [];
    const dev =
      R.accept && R.errors.length
        ? [
            {
              name: 'Отклонения, согласованные с заказчиком',
              rows: R.errors.map((e, i) => ({ k: String(i + 1), v: e.text })),
            },
          ]
        : [];
    if (StationUi.opts(x).calc === false) return dev;
    const ok = { true: ' — выполняется', false: ' — НЕ выполняется' };
    const mg = o => {
      if (o.margin == null) return '';
      return o.margin < 0 && o.ok ? ' (в пределах погрешности данных)' : ` (запас ${f(o.margin, 1)} %)`;
    };
    const steps = s =>
      s.steps.map(o => ({
        k: o.what,
        v: [
          o.formula,
          (o.data || []).map(([k, v]) => `${k}: ${v}`).join('; '),
          (o.result || '') + (ok[o.ok] || '') + mg(o),
        ]
          .filter(Boolean)
          .join('. '),
      }));
    const out = [
      StationCalc.docHead(x, R),
      ...R.sections.map(s => ({ name: `Расчётная записка: ${s.title.toLowerCase()}`, rows: steps(s) })),
    ];
    if (R.assumptions.length)
      out.push({ name: 'Допущения расчёта', rows: R.assumptions.map((a, i) => ({ k: String(i + 1), v: a })) });
    return [...out, ...dev];
  }

  /** Требования (без имени файла ТЗ), контейнер, ссылка на «Состав изделия», версия правил. */
  static docHead(x, R) {
    const req = StationReq.line({ ...x, req: { ...(x.req || {}), src: null } });
    const parts = kitParts(x).filter(p => p.role !== 'container' && String(p.name || '').trim());
    const c = kitContainer(x);
    return {
      name: 'Приложение. Расчётная записка и состав станции',
      rows: [
        ...(req ? [{ k: 'Требования заказчика', v: req }] : []),
        ...(c
          ? [{ k: 'Контейнер', v: [ctypeOf(c.ctype).name, c.size, c.ins, c.climate].filter(Boolean).join(', ') }]
          : []),
        ...(parts.length
          ? [{ k: 'Состав станции', v: `${parts.length} поз. — перечень и характеристики в разделе «Состав изделия»` }]
          : []),
        {
          k: 'Инженерные правила',
          v: `версия ${R.version} — значения коэффициентов и источники в документе «Инженерные правила и источники»`,
        },
      ],
    };
  }
}
