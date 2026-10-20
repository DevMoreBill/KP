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

/**
 * Расчёт модульной станции по требованиям заказчика, составу и инженерным правилам: каждый шаг — данные, формула,
 * коэффициенты с источником, результат и запас. Вкладка «Компоновка» и приложение к КП «Расчётная записка».
 */
export class StationCalc {
  static LEVEL = { error: 'Ошибка — станция не пройдёт', warn: 'Предупреждение' };
  static _items = list => list.map(item => `<li>${esc(item)}</li>`).join('');
  static KINDS = {
    comp(note, input, plan) {
      const air = AirDemand.run(note, input);
      const budget = PressureBudget.run(note, input);
      DryerSizing.run(note, input, air, budget);
      FilterSizing.run(note, input, air, budget);
      ReceiverSizing.run(note, input);
      ElectricLoad.run(note, input, plan);
    },
    dgu(note, input, plan) {
      GensetSizing.run(note, input, ElectricLoad.run(note, input, plan));
    },
    pump(note, input, plan) {
      PumpSizing.run(note, input);
      ElectricLoad.run(note, input, plan);
    },
  };
  static cache = new Map();

  /** Расчёт станции (с кэшем по отпечатку): разделы, ошибки, предупреждения, допущения, вопросы. */
  static run(station) {
    const input = CalcInput.of(station);
    const plan = StationUi.plan(station);
    const key = JSON.stringify([
      ReqNum.errors(station),
      input.req,
      input.cls,
      !!StationReq.of(station).accept,
      input.units.map(unit => [unit.name, unit.qty, unit.attrs]),
      StationRules.version() + StationRules.stamp(),
      plan.hash,
    ]);
    const cached = StationCalc.cache.get(station.id);
    if (cached && cached.key === key) return cached.res;
    const note = new CalcNote();
    if (!StationRules.ok()) {
      note.issue('warn', 'Файл инженерных правил станций не загружен — расчёт не выполнен.');
      return note.result();
    }
    StationCalc.inputErrors(note, station, plan);
    try {
      (StationCalc.KINDS[input.kind] || ElectricLoad.run)(note, input, plan);
      VentSizing.run(note, plan);
    } catch (err) {
      note.issue('warn', `Расчёт прерван: ${String((err && err.message) || err).slice(0, 200)}`);
    }
    const res = note.result();
    res.accept = !!StationReq.of(station).accept;
    StationCalc.cache.set(station.id, { key, res });
    return res;
  }

  /** Ошибки ввода требований и смещение ворот без причины — «согласованием» не снимаются. */
  static inputErrors(note, station, plan) {
    for (const err of ReqNum.errors(station))
      note.issue('error', `Требования: «${err.label}» — ${err.text}. Исправьте значение в «Подборе станции».`);
    for (const groups of [plan.gates, plan.gates2].filter(group => group && group.off && !group.offWhy)) {
      note.issue(
        'error',
        `Требования: «Причина смещения ворот» — ворота в торце смещены от оси на ${Mm.text(Math.abs(groups.off))} мм без причины; укажите причину («Условия для расчёта станции» → «Ворота в торце»).`,
      );
    }
  }

  /** Блокирующие ошибки: КП не сохраняется, пока их не исправят или не отметят «отклонения согласованы». */
  static errors(station) {
    if (!StationUi.on(station) || !isKit(station)) return [];
    const result = StationCalc.run(station);
    return result.accept ? result.errors.filter(err => /^Требования: «/.test(err.text)) : result.errors;
  }

  /** Блок «Расчёт станции» на вкладке «Компоновка»: под раскрытием (открыт при ошибке). */
  static html(station, i) {
    const result = StationCalc.run(station);
    const opts = StationUi.opts(station);
    const [cls, text] = StationCalc._head(result);
    const iss = result.issues.filter(issue => issue.level !== 'info');
    const accept = result.errors.length
      ? `<label class="stl-chk"><input type="checkbox" data-req="${i}" data-rk="accept"${result.accept ? ' checked' : ''}> отклонения согласованы с заказчиком — КП сохраняется</label>`
      : '';
    return `<details class="stl-air calc stl-sp"${Spoiler.attr(`calc:${station.id}`, !!(result.errors.length && !result.accept))}><summary class="stl-air-h"><b>Расчёт станции</b><span class="${cls}">${text}</span><small class="muted">формулы, коэффициенты, источники · правила ${esc(result.version)}</small></summary>
      <div class="calc-opts"><label class="stl-chk"><input type="checkbox" data-stl="calc" data-i="${i}"${opts.calc ? ' checked' : ''}> в КП — приложение «Расчётная записка» (только по запросу заказчика: ТКП — без расчётов)</label>
        ${accept}</div>
      ${iss.length ? `<ul class="stl-iss">${iss.map(issue => `<li class="${issue.level}"><b>${StationCalc.LEVEL[issue.level]}:</b> ${esc(issue.text)}</li>`).join('')}</ul>` : ''}
      ${result.questions.length ? `<h5 class="calc-h">Нужно узнать у заказчика</h5><ol class="calc-l">${StationCalc._items(result.questions)}</ol>` : ''}
      ${StationCalc.sections(result) || '<p class="muted">Укажите производительность и давление (или мощность нагрузки) в «Подборе станции» — расчёт появится здесь.</p>'}
      ${StationCalc.more(result, station)}
      <p class="stl-hint muted">Условия для расчёта (высота, влажность, запас, к каким условиям приведена производительность, нагрузка ДЭС) — в «Подборе станции» → «Все требования, условия расчёта и проверки».
        <button class="btn ghost sm" type="button" data-rulesdoc>Инженерные правила и источники (DOCX)</button></p></details>`;
  }

  static _head(result) {
    if (result.errors.length)
      return [
        'bad-t',
        `✕ Ошибок: ${result.errors.length}${result.accept ? ' — отклонения согласованы с заказчиком' : ' — КП не сохранится'}`,
      ];
    if (result.warnings.length) return ['warn-t', `⚠ Предупреждений: ${result.warnings.length}`];
    return result.sections.length ? ['ok-t', '✓ Проверки пройдены'] : ['muted', 'нет данных для расчёта'];
  }

  /** Шаги расчёта по разделам: отметка, что и по какой формуле, данные, результат, запас, источники. */
  static sections(result) {
    const mark = { true: '<b class="ok-t">✓</b>', false: '<b class="bad-t">✕</b>' };
    const src = ids => [...new Set((ids || []).map(id => StationRules.short(id)))].join('; ');
    const row = step => {
      const data = (step.data || []).length
        ? `<div class="calc-d">${step.data.map(([k, value]) => `<span>${esc(k)}: ${esc(value)}</span>`).join('')}</div>`
        : '';
      const rules = (step.rules || []).length ? `<div class="calc-src">${esc(src(step.rules))}</div>` : '';
      return `<tr><td class="calc-s">${mark[step.ok] || ''}</td>
      <td><b>${esc(step.what)}</b>${step.formula ? `<div class="calc-f">${esc(step.formula)}</div>` : ''}${data}${step.note ? `<div class="muted">${esc(step.note)}</div>` : ''}</td>
      <td class="calc-res">${esc(step.result || '')}${StationCalc._margin(step)}${rules}</td></tr>`;
    };
    return result.sections
      .map(
        section =>
          `<h5 class="calc-h">${esc(section.title)}</h5><table class="calc-t"><tbody>${section.steps.map(row).join('')}</tbody></table>`,
      )
      .join('');
  }

  static _margin(step) {
    if (step.margin == null) return '';
    let cls = 'muted';
    if (step.margin < 0) cls = step.ok ? 'warn-t' : 'bad-t';
    return `<div class="${cls}">запас ${step.margin > 0 ? '+' : ''}${CalcNote.fmt(step.margin, 1)} %</div>`;
  }

  /** Допущения, «требует подтверждения» и уточнения «на потом» — ещё одним раскрытием. */
  static more(result, station) {
    const count = result.assumptions.length + result.weak.length + result.later.length;
    if (!count) return '';
    const weak = result.weak
      .map(
        item =>
          `<li>${esc(item.title)}${item.src && item.src !== 'нет данных' ? ` <span class="muted">— ${esc(item.src)}</span>` : ''}</li>`,
      )
      .join('');
    return `<details class="calc-more"${Spoiler.attr(`calcm:${station.id}`)}><summary>Допущения и данные «по умолчанию» (${count}) — расчёт принял их с запасом в пользу заказчика</summary>
        ${result.assumptions.length ? `<h5 class="calc-h">Допущения</h5><ul class="calc-l">${StationCalc._items(result.assumptions)}</ul>` : ''}
        ${result.weak.length ? `<h5 class="calc-h">Требует подтверждения</h5><ul class="calc-l">${weak}</ul>` : ''}
        ${result.later.length ? `<h5 class="calc-h">Можно уточнить у заказчика позже</h5><ul class="calc-l">${StationCalc._items(result.later)}</ul>` : ''}</details>`;
  }

  /**
   * Приложение к КП «Расчётная записка и состав станции» — группы {name, rows: [{k, v}]}. ТКП: записка — только галочкой;
   * согласованные отклонения — всегда; заказчику — только расчёт и допущения (внутренние списки остаются в программе).
   */
  static docGroups(station) {
    if (!StationUi.on(station) || !isKit(station)) return [];
    const result = StationCalc.run(station);
    if (!result.sections.length) return [];
    const dev =
      result.accept && result.errors.length
        ? [
            {
              name: 'Отклонения, согласованные с заказчиком',
              rows: result.errors.map((err, i) => ({ k: String(i + 1), v: err.text })),
            },
          ]
        : [];
    if (StationUi.opts(station).calc === false) return dev;
    const ok = { true: ' — выполняется', false: ' — НЕ выполняется' };
    const marginText = step => {
      if (step.margin == null) return '';
      return step.margin < 0 && step.ok
        ? ' (в пределах погрешности данных)'
        : ` (запас ${CalcNote.fmt(step.margin, 1)} %)`;
    };
    const steps = section =>
      section.steps.map(step => ({
        k: step.what,
        v: [
          step.formula,
          (step.data || []).map(([k, value]) => `${k}: ${value}`).join('; '),
          (step.result || '') + (ok[step.ok] || '') + marginText(step),
        ]
          .filter(Boolean)
          .join('. '),
      }));
    const out = [
      StationCalc.docHead(station, result),
      ...result.sections.map(section => ({
        name: `Расчётная записка: ${section.title.toLowerCase()}`,
        rows: steps(section),
      })),
    ];
    if (result.assumptions.length)
      out.push({
        name: 'Допущения расчёта',
        rows: result.assumptions.map((assumption, i) => ({ k: String(i + 1), v: assumption })),
      });
    return [...out, ...dev];
  }

  /** Требования (без имени файла ТЗ), контейнер, ссылка на «Состав изделия», версия правил. */
  static docHead(station, result) {
    const req = StationReq.line({ ...station, req: { ...(station.req || {}), src: null } });
    const parts = kitParts(station).filter(part => part.role !== 'container' && String(part.name || '').trim());
    const container = kitContainer(station);
    return {
      name: 'Приложение. Расчётная записка и состав станции',
      rows: [
        ...(req ? [{ k: 'Требования заказчика', v: req }] : []),
        ...(container
          ? [
              {
                k: 'Контейнер',
                v: [ctypeOf(container.ctype).name, container.size, container.ins, container.climate]
                  .filter(Boolean)
                  .join(', '),
              },
            ]
          : []),
        ...(parts.length
          ? [{ k: 'Состав станции', v: `${parts.length} поз. — перечень и характеристики в разделе «Состав изделия»` }]
          : []),
        {
          k: 'Инженерные правила',
          v: `версия ${result.version} — значения коэффициентов и источники в документе «Инженерные правила и источники»`,
        },
      ],
    };
  }
}
