import { LayoutMode } from './layout-mode.js';
import { LayoutRoof } from './layout-roof.js';
import { Mm } from './mm.js';
import { PressureVessel } from './pressure-vessel.js';
import { StationGeo } from './station-geo.js';
import { StationHeat } from './station-heat.js';
import { StationMatrix } from './station-matrix.js';
import { StationMods } from './station-mods.js';

const n = v => Mm.text(v);
const uniq = list => [...new Set(list)];
const named = e => `поз. ${e.pos} «${e.short}»`;
const FILL_WALL = { left: 'в торце', front: 'в стене с дверью оператора', back: 'в задней стене' };

/** Сведения и замечания плана: режимы-исключения, станция из модулей, условные габариты, ресиверы снаружи, бак, выхлоп. */
export class LayoutNotes {
  constructor(lay) {
    this.lay = lay;
  }

  /** Режим-исключение: что сделано и почему (согласовать с заказчиком). */
  mode(r, m, geo) {
    const why =
      geo.auto || geo.road
        ? `станция прошла по габариту перевозки без спецразрешения (ширина до ${n(StationGeo.ROAD_W)} мм)`
        : 'оборудование поместилось в заданный контейнер';
    if (m.tight) this.tight(r, why);
    if (m.ends && r.ends) r.issues.push({ level: 'info', text: this.endsText(r.ends, why) });
    if (m.cross && r.cross) {
      r.issues.push({
        level: 'warn',
        text: `Сквозного прохода нет: поз. ${r.cross.pos} стоит поперёк станции лицом к входу — к нему спереди и к оборудованию до него подходят от двери оператора, к нему сзади и к оборудованию за ним — через вторую дверь оператора. Доступ ко всему оборудованию остаётся с разных сторон. Исключение, чтобы ${why}.`,
      });
    }
    r.mode = m;
  }

  tight(r, why) {
    const [rec, min] = this.lay.aisle0;
    const w = r.aisle && r.aisle.w;
    r.aisleRule = [rec, Math.min(min, LayoutMode.TIGHT)];
    if (w < min) {
      r.issues.push({
        level: 'warn',
        text: `Проход оператора сужен до ${n(w)} мм (норма — не менее ${n(min)} мм, ПУЭ, п. 4.1.23): исключение, чтобы ${why}. Согласуйте с заказчиком.`,
      });
    }
  }

  endsText(E, why) {
    const door = E.next ? `поз. ${E.next}` : 'остальным оборудованием';
    const recv = E.recv.length
      ? `; ресиверы поз. ${E.recv.join(', ')} — в два ряда у дальнего торца, доступ — через ворота там`
      : '';
    if (E.n > 1) {
      return `Без продольного прохода: компрессоры поз. ${E.all.join(', ')} (${E.n} шт.) — рядом в ряд от торца по середине ширины, обслуживание спереди и сзади — через сервисные ворота с обеих сторон, сбоку — через ворота в торце и промежутки не меньше ${n(StationMatrix.modes().next)} мм между компрессорами и за последним; дверь оператора — между последним компрессором и ${door}${recv}. Так ${why}.`;
    }
    return `Без продольного прохода: поз. ${E.pos} (компрессор) — у торца по середине ширины, обслуживание спереди и сзади — через сервисные ворота с обеих сторон, сбоку — через ворота в торце; дверь оператора — между компрессором и ${door}${recv}. Так ${why}.`;
  }

  /** Станция из модулей: раскладка, размер модуля, стыковка; на стыке и на стойке каркаса — ошибка. */
  mods(plan) {
    const g = plan.geo;
    const m = g && g.mods;
    if (!m || !m.Lm) return;
    const iss = (plan.issues = plan.issues || []);
    const [L, W, H] = plan.int;
    const push = (level, text) => iss.push({ level, mods: true, text });
    push(
      'info',
      `Станция из модулей: ${StationMods.shape(m)} — модуль ${n(m.Lm)} × ${n(m.Wm)} × ${n(g.ext[2])} мм (в габарите перевозки, каждый везётся отдельно), вместе ${n(g.ext[0])} × ${n(g.ext[1])} мм, внутри — одно помещение ${n(L)} × ${n(W)} × ${n(H)} мм. Каждый агрегат — целиком в своём модуле. На производстве станцию собирают и стыкуют, обвязывают, запускают и проверяют; на перевозку — расстыковка трубопровода, кабелей и коммуникаций на стыках (разъёмные соединения), стыковые проёмы — временными щитами; модули везут с оборудованием внутри. На объекте — быстрая стыковка: соединение каркасов, уплотнение, нащельники на стенах и кровле, пол без порога, подключение сетей через стык; стыков — ${StationMods.joints(m)}.`,
    );
    this.modSize(m, push);
    const on = StationMods.cross(plan.items, g);
    if (on.length) {
      plan.level = 'error';
      push(
        'error',
        `Поз. ${uniq(on.map(i => i.pos)).join(', ')} — на стыке модулей: модуль везут с оборудованием внутри, каждый агрегат должен быть целиком в своём модуле. Выберите другую раскладку или размер модуля по оборудованию («Модули…»).`,
      );
    }
    this.posts(plan, push);
  }

  modSize(m, push) {
    const ws = StationMods.widths();
    const [lo, hi] = [ws[0], ws[ws.length - 1]];
    const lMin = StationMods.M.lMin;
    const maxL = StationMatrix.fit().maxL;
    if (m.Wm < lo || m.Wm > hi)
      push(
        'warn',
        `Ширина модуля ${n(m.Wm)} мм — вне ${n(lo)}…${n(hi)} мм (модули — одной ширины, не шире габарита перевозки): уберите размер — он подберётся по оборудованию.`,
      );
    if (m.Lm < lMin) {
      push(
        'warn',
        `Длина модуля ${n(m.Lm)} мм — меньше ${n(lMin)} мм (модуль станции из нескольких модулей — не короче; «Настройки → Правила компоновки → Станция из нескольких модулей»): уберите размер — он подберётся по оборудованию, или соберите станцию из меньшего числа модулей.`,
      );
    }
    if (m.Lm > maxL) push('warn', `Длина модуля ${n(m.Lm)} мм — больше наибольшей длины перевозки ${n(maxL)} мм.`);
  }

  /** Стойки каркаса на пересечениях стыков: оборудование на стойке — ошибка, иначе — их обходят в проходе. */
  posts(plan, push) {
    const g = plan.geo;
    const half = StationMods.M.post / 2;
    const floor = (plan.items || []).filter(i => i.mount !== 'wall' && i.mount !== 'pipe');
    for (const p of StationMods.posts(g)) {
      const hit = StationMods.hits(floor, g).filter(
        i => i.x < p.x + half && i.x + i.lx > p.x - half && i.y < p.y + half && i.y + i.ly > p.y - half,
      );
      if (hit.length) {
        plan.level = 'error';
        push(
          'error',
          `Поз. ${uniq(hit.map(i => i.pos)).join(', ')} — на стойке каркаса стыка модулей (${n(p.x)}, ${n(p.y)} мм): выберите другую раскладку модулей или измените состав.`,
        );
      } else {
        push(
          'info',
          `Стойка каркаса на пересечении стыков модулей — ${n(2 * half)} × ${n(2 * half)} мм (${n(p.x)}, ${n(p.y)} мм от угла помещения): в проходе её обходят.`,
        );
      }
    }
  }

  /** Сведения плана: условные габариты, что не размещено, ресиверы снаружи, бак, отопление, учёт сосудов, крыша, трубы. */
  plan(plan) {
    const iss = plan.issues;
    this.sizes(iss);
    this.outside(plan, iss);
    this.fuel(plan, iss);
    StationHeat.notes(plan);
    this.vessels(plan, iss);
    this.roof(plan, iss);
    this.exhausts(plan, iss);
    this.piping(plan, iss);
  }

  sizes(iss) {
    const eq = this.lay.eq;
    const tanks = eq.filter(e => e.place && !e.known && e.kind === 'tank');
    if (tanks.length) {
      const list = tanks
        .map(e => `${named(e)} ${e.vol ? `${n(e.vol)} л — ` : ''}${n(e.l)} × ${n(e.w)} × ${n(e.h)} мм`)
        .join('; ');
      iss.push({
        level: 'info',
        text: `Габариты бака — по расчётному объёму (прямоугольный, стенка ${n(StationMatrix.tank().wall)} мм; требует подтверждения изготовителем бака): ${list}. Свои размеры — строкой «Габариты» в составе станции.`,
      });
    }
    const guessed = eq.filter(e => e.place && !e.known && e.kind !== 'tank');
    if (guessed.length) {
      const list = guessed.map(e => `${named(e)} ${n(e.l)} × ${n(e.w)} × ${n(e.h)} мм`).join('; ');
      iss.push({
        level: 'info',
        text: `Габариты не указаны в характеристиках — взяты условные: ${list}. Укажите размеры в составе станции (характеристики элемента).`,
      });
    }
    const missing = eq.filter(e => e.nodims);
    if (missing.length)
      iss.push({ level: 'info', text: `Не размещены — нет габаритов: ${missing.map(e => `«${e.name}»`).join(', ')}.` });
  }

  /** Ресиверы снаружи: площадка и подключение; при морозе — конденсат, если воздух не осушен адсорбционным осушителем. */
  outside(plan, iss) {
    const out = plan.outside || [];
    if (!out.length) return;
    const D = this.lay.eq.filter(e => e.kind === 'dryer' && e.air && e.air.type !== 'gen');
    iss.push({
      level: 'info',
      text: `${out.length > 1 ? 'Ресиверы' : 'Ресивер'} поз. ${uniq(out.map(i => i.pos)).join(', ')} — снаружи, на бетонной площадке в ${n(StationMatrix.recv().outGap)} мм от дальнего торца (ФНП ОРПД, п. 65): трубопровод — через стену с запорной арматурой, на ресивере — предохранительный клапан и манометр, площадка — с ограждением от наезда.`,
    });
    if (!D.length) {
      iss.push({
        level: 'warn',
        text: 'Ресивер снаружи без осушителя: зимой конденсат в ресивере и отводе замерзает — нужен обогреваемый отвод конденсата (греющий кабель, теплоизоляция) или осушитель перед ресивером.',
      });
    } else if (!D.some(e => e.air.type === 'ads')) {
      iss.push({
        level: 'info',
        text: 'Ресивер снаружи после рефрижераторного осушителя (точка росы +3 °C): при морозе в нём выпадает и замерзает конденсат — нужен обогреваемый отвод конденсата или адсорбционный осушитель (точка росы −40 °C).',
      });
    }
    if (plan.chassis)
      iss.push({
        level: 'info',
        text: 'Станция на шасси: ресивер снаружи перевозится отдельно и ставится на площадку на объекте.',
      });
  }

  fuelEntry(plan) {
    const G = plan.fuel.gate;
    if (G) return `двустворчатые ворота в торце ${n(G.w)} × ${n(G.h)} мм (монтаж и замена бака)`;
    return plan.geo && plan.geo.sea ? 'штатные двери контейнера' : 'своя дверь снаружи';
  }

  fuel(plan, iss) {
    if (!plan.fuel) return;
    const P = uniq((plan.items || []).filter(i => i.tank).map(i => i.pos)).join(', ');
    iss.push({
      level: 'info',
      text: `Топливный бак поз. ${P} — в отдельном отсеке у торца: противопожарная перегородка 1-го типа (EI 45) без проёмов, топливопровод — через гильзу с уплотнением; вход в отсек — ${this.fuelEntry(plan)}; заливная горловина — ${FILL_WALL[plan.fuel.fill.wall]}, утоплена в стену: ниша с лючком заподлицо под замок (ничего не выступает, габарит не меняется); дыхательный клапан с огнепреградителем — над крышей; бак — в поддоне на полный объём; в отсеке — естественная вентиляция.`,
    });
  }

  /** Учёт в Ростехнадзоре — по произведению давления на вместимость. */
  vessels(plan, iss) {
    const V = (plan.vessels || []).filter(v => v.pv != null);
    const reg = V.filter(v => v.reg);
    const free = V.filter(v => !v.reg);
    const list = L => L.map(v => `поз. ${v.pos} — ${PressureVessel.text(v)}`).join('; ');
    if (reg.length) {
      const inside = reg.some(v => !v.out)
        ? '; размещают на открытой площадке или в отдельном здании, в помещении — когда иначе нельзя (п. 65): «Ресивер снаружи» — в требованиях заказчика на вкладке «Состав станции»'
        : '';
      iss.push({
        level: 'info',
        text: `Подлежат учёту в Ростехнадзоре (ФНП ОРПД, п. 223: p·V больше 1,0 МПа·м³): ${list(reg)}. Регистрация, техническое освидетельствование и ответственные за исправное состояние — у эксплуатирующей организации${inside}.`,
      });
    }
    if (free.length)
      iss.push({ level: 'info', text: `Учёту в Ростехнадзоре не подлежат (p·V не больше 1,0 МПа·м³): ${list(free)}.` });
  }

  /** Глушитель на крыше: высота станции с ним, по одному на ДГУ, условный размер. */
  roof(plan, iss) {
    const rf = plan.roof || [];
    if (!rf.length || !plan.geo || !plan.geo.ext) return;
    const top = Math.max(...rf.map(m => m.gap + m.d));
    const h = plan.geo.ext[2] + Math.max(top, plan.geo.rise || 0);
    const chassis = plan.chassis ? LayoutRoof.CHASSIS_H : 0;
    iss.push({
      level: 'info',
      text: `Глушитель на крыше над ДГУ, выхлоп — горизонтально в сторону (не вверх): высота станции с глушителем ${n(h)} мм${chassis ? ` (на шасси — ${n(h + chassis)} мм)` : ''}. Глушитель съёмный: при перевозке его снимают и ставят на объекте — высота с платформой не более ${n(LayoutRoof.ROAD_H)} мм.`,
    });
    const qty = this.lay.eq.filter(e => e.kind === 'muffler' && e.roof).reduce((s, e) => s + e.qty, 0);
    if (rf.length > qty) {
      iss.push({
        level: 'warn',
        text: `Глушитель на крыше — у каждой ДГУ (если хоть у одной он на крыше): в составе ${qty} шт., нужно ${rf.length} — увеличьте количество «${rf[0].name}» до ${rf.length}.`,
      });
    }
    const guessed = rf.filter(m => !m.known);
    if (guessed.length) {
      const list = uniq(guessed.map(m => `поз. ${m.pos} — ${n(Math.max(m.lx, m.ly))} × Ø${n(m.d)} мм`)).join('; ');
      iss.push({ level: 'info', text: `Размер глушителя не указан — взят условный по мощности ДГУ: ${list}.` });
    }
  }

  exhaustWho(wall, all) {
    if (wall.length === all) return all > 1 ? 'всех ДГУ' : 'ДГУ';
    return wall.length > 1 ? `${wall.length} ДГУ` : 'одной ДГУ';
  }

  /** Выхлоп каждой ДГУ без своего глушителя на крыше — через стену (глушитель встроен в ДГУ). */
  exhausts(plan, iss) {
    const all = plan.exhausts || [];
    const wall = all.filter(e => e.how === 'wall');
    if (!wall.length) return;
    const heights = uniq(wall.map(e => n(e.z))).join(' / ');
    iss.push({
      level: 'info',
      text: `Выхлоп ${this.exhaustWho(wall, all.length)} — через заднюю стену (у каждой — свой вывод, над ДГУ на высоте ${heights} мм): глушителя на крыше для ${wall.length > 1 ? 'них' : 'неё'} в составе нет — глушитель встроен в ДГУ (у небольших ДГУ — штатно). Проходка — через гильзу с негорючей теплоизоляцией, снаружи — отвод вниз под 45° с дождевым колпаком; не напротив приточных жалюзи и дверей. Если встроенного глушителя нет — добавьте в состав «Глушитель на крыше» (по одному на ДГУ).`,
    });
  }

  /** Трубопровод: в составе нет, а фильтры на трубе; материал не выбран; полипропилен — не для топлива и горячего воздуха. */
  piping(plan, iss) {
    const eq = this.lay.eq;
    const hang = (plan.items || []).filter(i => i.mount === 'pipe' && !i.unit);
    for (const pp of plan.piping || []) {
      if (pp.implicit) {
        iss.push({
          level: 'info',
          text: `Фильтры (${hang.map(i => `поз. ${i.pos}`).join(', ')}) висят на трубопроводе, а трубопроводной обвязки в составе нет — добавьте элемент «Трубопроводная обвязка и запорная арматура».`,
        });
      } else if (!pp.mat) {
        iss.push({
          level: 'info',
          text: `Материал трубопровода (поз. ${pp.pos}) не выбран — на чертеже сталь. Выберите в «Составе станции»: сталь, нержавеющая сталь или полипропилен.`,
        });
      } else if (pp.mat === 'pp' && eq.some(e => e.kind === 'dgu')) {
        iss.push({
          level: 'warn',
          text: `Топливопровод (поз. ${pp.pos}) из полипропилена не применяют — выберите сталь или нержавеющую сталь.`,
        });
      } else if (pp.mat === 'pp' && eq.some(e => e.kind === 'compressor')) {
        iss.push({
          level: 'info',
          text: `Полипропилен для сжатого воздуха (поз. ${pp.pos}) — только в пределах давления труб при рабочей температуре (PP-R PN20 — 20 бар при 20 °C, при нагреве меньше); участок сразу после компрессора — металлом.`,
        });
      }
    }
  }
}
