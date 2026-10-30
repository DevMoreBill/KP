import { AdminApi, AdminDialog } from './admin-core.js';
import { BitrixPanel } from './bitrix-panel.js';
import { Money } from '../../core/money.js';
import { Fmt } from '../../core/str.js';
import { UiKit } from '../../ui/ui-kit.js';
import { esc } from '../../core/util.js';
import { BitrixDiffCard } from './bitrix-diff.js';

/** «Менеджеры»: менеджер программы ↔ пользователь Битрикса, участие, своё направление и воронка. */
export class BitrixManagers {
  static _row(manager, ctx) {
    const panel = BitrixPanel;
    const own = ctx.rules[manager.id] || { on: true, dir: '', cat: '' };
    const byMail = ctx.portal.auto[manager.id] && !(ctx.state.users || {})[manager.id];
    return `<tr data-bxm="${esc(manager.id)}"><td>${esc(manager.name)}${byMail ? ' <em class="muted">по e-mail</em>' : ''}</td>
          <td>${panel.sel('data-k="user"', ctx.userOpts, ctx.users[manager.id] || '', 'Пользователь Битрикса')}</td>
          <td><input type="checkbox" data-k="on"${own.on !== false ? ' checked' : ''} aria-label="Участвует в обмене"></td>
          <td>${panel.sel('data-k="dir"', panel.dirOpts(['both', 'in', 'out'], 'как общее'), own.dir || '', 'Направление')}</td>
          <td>${panel.sel('data-k="cat"', ctx.cats, own.cat || '', 'Воронка новых сделок')}</td></tr>`;
  }

  /**
   * Вкладка.
   * @returns {string}
   */
  static html() {
    const panel = BitrixPanel;
    const state = panel.state;
    const portal = panel.portal;
    const rules = panel.rules();
    const ctx = {
      state,
      portal,
      rules: rules.mgr || {},
      users: { ...(portal.auto || {}), ...(state.users || {}) },
      userOpts: [
        ['', '— не сопоставлен —'],
        ...portal.users.map(user => [user.id, user.name + (user.email ? ` · ${user.email}` : '')]),
      ],
      cats: [
        ['', `основная: ${panel.catName(state.category || '0')}`],
        ...portal.categories.map(cat => [cat.id, cat.name]),
      ],
    };
    return `<div class="st-card"><p class="sub">Менеджеры программы ↔ пользователи Битрикса</p>
      <div class="tzi-tw"><table class="tzi-t bx-mt"><thead><tr><th>Менеджер</th><th>Пользователь Битрикса</th><th>Участвует</th><th>Направление${UiKit.tip('<p>Своё направление менеджера действует вместе с общим (берётся более строгое).</p><p>Пример: общее «в обе стороны», у стажёра — «только в Битрикс»: его сделки уходят в Битрикс, а правки коллег из Битрикса к нему не приходят.</p>')}</th><th>Воронка новых сделок${UiKit.tip('<p>Куда в Битриксе попадают новые сделки этого менеджера из программы. Пусто — основная воронка.</p><p>Пример: сервисному инженеру — воронка «Заявки в Сервис».</p>')}</th></tr></thead><tbody>
      ${portal.managers.map(manager => this._row(manager, ctx)).join('')}</tbody></table></div>
      <p class="muted">Не участвует — его сделки и дела не уходят в Битрикс и не приходят из него. «Только из Битрикса» — у него правки остаются в программе.</p>
      <p class="muted">Новая сделка Битрикс24 с несопоставленным ответственным — «Сделки → Общие правила».</p>
      <div class="row" style="margin-top:12px"><button class="btn primary" type="button" id="bxSaveMgr" data-autosave>Сохранить</button></div></div>`;
  }

  /** События вкладки. */
  static bind() {
    const panel = BitrixPanel;
    panel.one('#bxSaveMgr').onclick = () => {
      const users = {};
      const mgr = {};
      panel.all('[data-bxm]').forEach(row => {
        const id = row.dataset.bxm;
        const field = key => row.querySelector(`[data-k="${key}"]`);
        if (field('user').value) users[id] = field('user').value;
        mgr[id] = { on: field('on').checked, dir: field('dir').value, cat: field('cat').value };
      });
      panel.save({ users, mgr });
    };
  }
}

/** «Воронки и этапы»: основная воронка, дополнительные воронки, соответствие этапов у каждой. */
export class BitrixStages {
  static asked = new Set(); // воронки, чьи стадии запрошены (идёт или не удалось), — перерисовка не повторяет запрос

  /** Вкладку открыли снова — запросить стадии, которые не загрузились. */
  static again() {
    this.asked.clear();
  }

  static _stageName(stage) {
    if (stage.sem === 'S') return `${stage.name} (успех)`;
    return stage.sem === 'F' ? `${stage.name} (провал)` : stage.name;
  }

  static _block(cat, ctx) {
    const panel = BitrixPanel;
    const state = panel.state;
    const stages = (panel.portal.stagesBy || {})[cat];
    const current = ctx.by[cat] || (cat === ctx.main ? state.stages || {} : {});
    const body = stages
      ? state.stagesOur
          .map(
            stage =>
              `<div class="bx-map"><label>${esc(stage.label)}</label>${panel.sel(`data-bxst="${esc(stage.key)}"`, [['', '— не передавать —'], ...stages.map(entry => [entry.id, this._stageName(entry)])], current[stage.key] || '', stage.label)}</div>`,
          )
          .join('')
      : `<p class="muted">Стадии загружаются…</p>`;
    return `<div class="bx-cat" data-bxcat="${esc(cat)}"><p class="sub">${esc(panel.catName(cat))}${cat === ctx.main ? ' <em class="muted">основная</em>' : ''}${ctx.mgrCats.has(cat) ? ' <em class="muted">воронка менеджера</em>' : ''}</p>
        ${body}</div>`;
  }

  /**
   * Вкладка.
   * @returns {string}
   */
  static html() {
    const panel = BitrixPanel;
    const portal = panel.portal;
    const rules = panel.rules();
    const main = String(panel.state.category || '0');
    const extra = new Set(rules.cats || []);
    const mgrCats = new Set(
      Object.values(rules.mgr || {})
        .map(entry => entry.cat)
        .filter(Boolean),
    );
    const shown = [
      main,
      ...portal.categories.map(cat => cat.id).filter(id => id !== main && (extra.has(id) || mgrCats.has(id))),
    ];
    const ctx = { main, mgrCats, by: rules.stagesBy || {} };
    const others = portal.categories
      .filter(cat => cat.id !== main)
      .map(cat => panel.chk(`data-bxcats="${esc(cat.id)}"`, extra.has(cat.id), esc(cat.name)))
      .join('');
    return `<div class="st-card"><div class="bx-map"><label>Основная воронка — сюда уходят новые сделки программы${UiKit.tip('<p>Сделка, созданная в программе (сохранено КП, «＋ Сделка»), появится в Битриксе в этой воронке.</p><p>Пример: «Общая». Сделки других воронок, загруженные из Битрикса, остаются в своих воронках.</p>')}</label>${panel.sel(
      'id="bxCat"',
      portal.categories.map(cat => [cat.id, cat.name]),
      main,
      'Основная воронка',
    )}</div>
      <p class="sub" style="margin-top:12px">Загружать сделки ещё из воронок</p>
      <div class="bx-chips">${others || '<span class="muted">Других воронок нет</span>'}</div>
      <p class="muted">Воронки менеджеров («Менеджеры») загружаются всегда. У каждой воронки — своё соответствие этапов; без стадии этап не передаётся (стадия в Битриксе остаётся как есть), стадии «успех» и «провал» без пары — «Выиграно» и «Проиграно».</p></div>
    <div class="st-card">${shown.map(cat => this._block(cat, ctx)).join('<hr class="bx-hr">')}
      <div class="row" style="margin-top:12px"><button class="btn primary" type="button" id="bxSaveCats" data-autosave>Сохранить</button></div></div>`;
  }

  static async _load(cat) {
    const panel = BitrixPanel;
    this.asked.add(cat);
    try {
      const reply = await AdminApi.post('bitrix/stages', { category: cat });
      panel.portal.stagesBy = { ...(panel.portal.stagesBy || {}), [cat]: reply.stages };
      if (panel.tab === 'cats') panel.render();
    } catch (error) {
      panel.render({ t: String(error.message || error), err: true });
    }
  }

  static _collect() {
    const stagesBy = {};
    BitrixPanel.all('[data-bxcat]').forEach(block => {
      const map = {};
      block.querySelectorAll('[data-bxst]').forEach(select => {
        if (select.value) map[select.dataset.bxst] = select.value;
      });
      if (block.querySelector('[data-bxst]')) stagesBy[block.dataset.bxcat] = map;
    });
    return stagesBy;
  }

  /** События вкладки. */
  static bind() {
    const panel = BitrixPanel;
    const need = [...new Set(panel.all('[data-bxcat]').map(block => block.dataset.bxcat))].filter(
      cat => !(panel.portal.stagesBy || {})[cat] && !this.asked.has(cat),
    );
    need.forEach(cat => this._load(cat));
    panel.one('#bxCat').onchange = event =>
      panel.save({ category: event.target.value }, 'Основная воронка изменена — проверьте этапы');
    const boxes = panel.all('[data-bxcats]');
    boxes.forEach(box => {
      box.onchange = () => {
        const cats = boxes.filter(entry => entry.checked).map(entry => entry.dataset.bxcats);
        panel.save({ cats, stagesBy: this._collect() }, 'Воронки обмена изменены — сопоставьте этапы');
      };
    });
    panel.one('#bxSaveCats').onclick = () => {
      const stagesBy = this._collect();
      const main = String(panel.state.category || '0');
      panel.save({ stagesBy, ...(stagesBy[main] ? { stages: stagesBy[main] } : {}) });
    };
  }
}

/** «Поля сделки»: поле программы ↔ поле Битрикса, направление, кто главный. */
export class BitrixFields {
  static OWN_FIELD = 'UF_CRM_KP_';

  static _bxOptions(spec, chosen, portalFields) {
    const own = spec.bx.startsWith(this.OWN_FIELD) ? '＋ своё поле программы (' : 'стандартное поле (';
    const opts = [
      [spec.bx, `${own}${spec.bx})`],
      ...portalFields
        .filter(field => field.code !== spec.bx)
        .map(field => [field.code, `${field.title} · ${field.code}`]),
    ];
    if (chosen.bx && !opts.some(opt => opt[0] === chosen.bx)) opts.push([chosen.bx, chosen.bx]); // выбранное раньше поле, которого нет в списке портала
    return opts;
  }

  static _row(spec, fields, portalFields) {
    const panel = BitrixPanel;
    const chosen = fields[spec.key] || { bx: spec.bx, dir: spec.def, win: 'last' };
    const field = spec.pick
      ? panel.sel('data-k="bx"', this._bxOptions(spec, chosen, portalFields), chosen.bx, 'Поле Битрикса')
      : `<code>${esc(spec.bx)}</code>`;
    const win = spec.shared
      ? panel.sel('data-k="win"', Object.entries(panel.WIN), chosen.win, 'Кто главный')
      : '<span class="muted">—</span>';
    return `<tr data-bxf="${esc(spec.key)}"${chosen.dir === 'off' ? ' class="off"' : ''}><td>${esc(spec.label)}</td><td>${field}</td><td>${panel.sel(
      'data-k="dir"',
      spec.dirs.map(dir => [dir, panel.DIR_SHORT[dir]]),
      chosen.dir,
      'Направление',
    )}</td><td>${win}</td></tr>`;
  }

  /**
   * Вкладка.
   * @returns {string}
   */
  static html() {
    const rules = BitrixPanel.rules();
    const fields = rules.fields || {};
    const portalFields = BitrixPanel.portal.fields || [];
    const rows = (rules.spec || []).map(spec => this._row(spec, fields, portalFields));
    return `<div class="st-card"><p class="sub">Поле программы ↔ поле сделки Битрикса</p>
      <div class="tzi-tw"><table class="tzi-t bx-ft"><thead><tr><th>Поле программы</th><th>Поле Битрикса</th><th>Направление</th><th>Правка с обеих сторон — главный${UiKit.tip('<p>Что делать, если поле изменили и в программе, и в Битриксе между двумя обменами.</p><p>«Последняя правка» — побеждает более поздняя; «программа» — всегда значение программы; «Битрикс» — всегда значение Битрикса.</p><p>Пример: ожидаемая дата — «последняя правка», ответственный — «Битрикс» (его меняет руководитель в Битриксе).</p>')}</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
      <p class="muted">«Своё поле программы» программа создаёт в сделках Битрикса сама при первом обмене; можно выбрать любое поле портала (в том числе ваши). Экономика и прочие поля — только в Битрикс. Сумма «→ в Битрикс»: сделка без КП берёт сумму из Битрикса; «← из Битрикса» — всегда из Битрикса.</p>
      <div class="row" style="margin-top:12px"><button class="btn primary" type="button" id="bxSaveFields" data-autosave>Сохранить</button><button class="btn ghost" type="button" id="bxFieldsDef">Все поля — по умолчанию</button></div></div>`;
  }

  /** События вкладки. */
  static bind() {
    const panel = BitrixPanel;
    panel.all('[data-bxf] [data-k="dir"]').forEach(select => {
      select.onchange = () => select.closest('tr').classList.toggle('off', select.value === 'off');
    });
    panel.one('#bxSaveFields').onclick = () => {
      const fields = {};
      panel.all('[data-bxf]').forEach(row => {
        const field = key => row.querySelector(`[data-k="${key}"]`);
        const entry = { dir: field('dir').value };
        if (field('bx')) entry.bx = field('bx').value;
        if (field('win')) entry.win = field('win').value;
        fields[row.dataset.bxf] = entry;
      });
      panel.save({ fields });
    };
    panel.one('#bxFieldsDef').onclick = async () => {
      const text =
        'Направления, поля Битрикса и «кто главный» вернутся к исходным: экономика — в свои поля программы, прочие поля не передаются.';
      if (!(await AdminDialog.confirm('Все поля — по умолчанию?', text, 'Вернуть'))) return;
      panel.save({ fields: {} }, 'Поля — по умолчанию');
    };
  }
}

/** «Журнал и проверка»: пробный прогон без записи, не отправленное, журнал по менеджеру. */
export class BitrixLog {
  static LEVEL = { error: 'bad-t', warn: 'warn-t' };

  static _list(items, empty) {
    return items.length
      ? `<ul class="bx-dry">${items.map(text => `<li>${esc(text)}</li>`).join('')}</ul>`
      : `<p class="muted">${empty}</p>`;
  }

  static _dry(dry) {
    if (!dry) return '';
    return `<div class="bx-dry2"><div><b>В Битриксе (${dry.bitrix.length + (dry.more || 0)})</b>${this._list(dry.bitrix, 'Ничего')}${dry.more ? `<p class="muted">и ещё ${dry.more}</p>` : ''}</div>
        <div><b>В программе (${dry.program.length})</b>${this._list(dry.program, 'Ничего')}</div></div>${dry.errors.length ? `<p class="bad-t">Ошибки: ${esc(dry.errors.join('; '))}</p>` : ''}`;
  }

  static _failed(failed) {
    if (!failed.length) return '';
    const rows = failed
      .map(
        entry =>
          `<div class="bx-f"><div><b>${esc(entry.title)}</b><span class="bad-t">${esc(entry.error)}</span><span class="muted">попыток ${entry.tries} · с ${esc(Fmt.dateTime(entry.added))}</span></div><button class="btn sm" type="button" data-bxre="${esc(entry.kind)}|${esc(entry.id)}">Повторить</button></div>`,
      )
      .join('');
    return `<div class="st-card"><p class="sub">Не отправлено <b class="bad-t">${failed.length}</b></p><div class="bx-fail">${rows}</div></div>`;
  }

  static _log(state) {
    const panel = BitrixPanel;
    const entries = (state.log || []).filter(
      entry => (!panel.errOnly || entry.level !== 'info') && (!panel.logMid || entry.mid === panel.logMid),
    );
    if (!entries.length)
      return `<p class="empty">${panel.errOnly || panel.logMid ? 'Таких записей нет.' : 'Обменов ещё не было.'}</p>`;
    return `<div class="bx-log">${entries.map(entry => `<div class="${this.LEVEL[entry.level] || ''}"><span class="muted">${esc(Fmt.dateTime(entry.at))}</span> ${esc(entry.text)}</div>`).join('')}</div>`;
  }

  /**
   * Вкладка.
   * @returns {string}
   */
  static html() {
    const panel = BitrixPanel;
    const state = panel.state;
    const managers = state.managers || [];
    return `${BitrixDiffCard.html(state.on)}<div class="st-card"><div class="row"><p class="sub" style="margin:0">Пробный прогон</p><span class="sp"></span><button class="btn" type="button" id="bxDry"${state.on ? '' : ' disabled'}>Проверить без записи</button></div>
      <p class="muted">Обмен по текущим правилам на копии базы: что изменилось бы в Битриксе и в программе. Ничего не записывается, очередь не трогается.</p>
      ${this._dry(panel.dry)}</div>
    ${this._failed(state.failed || [])}
    <div class="st-card"><div class="row"><p class="sub" style="margin:0">Журнал обмена</p><span class="sp"></span>
        ${panel.sel('id="bxLogMid" data-nodirty', [['', 'Все менеджеры'], ...managers.map(manager => [manager.id, manager.name])], panel.logMid, 'Менеджер')}
        <label class="cab-ck"><input type="checkbox" id="bxErr" data-nodirty${panel.errOnly ? ' checked' : ''}> Только ошибки</label></div>
      ${this._log(state)}</div>`;
  }

  static _resent(reply) {
    const result = reply.result || {};
    if (result.error) return `Не отправлено: ${result.error}`;
    return result.failed ? 'Снова ошибка — см. «Не отправлено»' : 'Отправлено';
  }

  /** События вкладки. */
  static bind() {
    const panel = BitrixPanel;
    panel.one('#bxErr').onchange = event => {
      panel.errOnly = event.target.checked;
      panel.render();
    };
    panel.one('#bxLogMid').onchange = event => {
      panel.logMid = event.target.value;
      panel.render();
    };
    panel.one('#bxDry').onclick = event => this._runDry(event.target);
    panel.all('[data-bxdiff]').forEach(button => {
      button.onclick = event => BitrixDiffCard.click(event, () => panel.render());
    });
    panel.all('[data-bxre]').forEach(button => {
      button.onclick = () => {
        const [kind, id] = button.dataset.bxre.split('|');
        button.disabled = true;
        button.textContent = 'Отправляю…';
        panel.run(
          () => AdminApi.post('bitrix/resend', { kind, id }),
          reply => this._resent(reply),
        );
      };
    });
  }

  static async _runDry(button) {
    const panel = BitrixPanel;
    button.disabled = true;
    button.textContent = 'Проверяю…';
    try {
      panel.dry = await AdminApi.post('bitrix/dry', {});
      panel.render({ t: 'Пробный прогон готов — ничего не записано' });
    } catch (error) {
      panel.render({ t: String(error.message || error), err: true });
    }
  }
}

/** «Старые сделки»: сделки Битрикса, созданные до включения связи, — с даты, с предпросмотром. */
export class BitrixOld {
  static ACT = { new: 'новая', link: 'связать', skip: 'пропустить' };

  static _row(item) {
    return `<tr><td><input type="checkbox" data-bximp="${esc(item.id)}"${item.act === 'skip' ? ' disabled' : ' checked'} aria-label="Загрузить"></td><td>${esc(item.title)} <span class="muted">№ ${esc(item.id)}</span></td><td>${esc(item.created)}</td><td>${item.sum ? esc(Money.rub(+item.sum)) : '—'}</td><td>${esc(item.stage)}</td><td>${esc(item.manager)}</td><td><b>${esc(this.ACT[item.act] || item.act)}</b> <span class="muted">${esc(item.why || '')}</span></td></tr>`;
  }

  static _preview(preview, cats) {
    const panel = BitrixPanel;
    const table = preview.items.length
      ? `<div class="tzi-tw"><table class="tzi-t bx-it"><thead><tr><th><input type="checkbox" id="bxImpAll" checked aria-label="Все"></th><th>Сделка Битрикса</th><th>Создана</th><th>Сумма</th><th>Этап</th><th>Менеджер</th><th>Что будет</th></tr></thead><tbody>
          ${preview.items.map(item => this._row(item)).join('')}</tbody></table></div>
          <div class="row" style="margin-top:12px"><button class="btn primary" type="button" id="bxImpGo">Загрузить отмеченные</button></div>`
      : '';
    return `<p class="muted">Найдено ${preview.items.length}${preview.items.length >= preview.max ? ` (показаны первые ${preview.max})` : ''} · воронки: ${esc(cats.map(cat => panel.catName(cat)).join(', '))} · до ${esc(preview.until)}</p>
        ${table}`;
  }

  /**
   * Вкладка.
   * @returns {string}
   */
  static html() {
    const panel = BitrixPanel;
    const state = panel.state;
    const preview = panel.imp;
    const cats = [String(state.category || '0'), ...(panel.rules().cats || [])];
    return `<div class="st-card"><p class="sub">Сделки Битрикса, созданные до включения связи</p>
      <p class="muted">Новые сделки воронок обмена приходят сами. Здесь — более ранние: с выбранной даты, по воронкам обмена. Сделка того же клиента (ИНН), открытая в программе и ещё не связанная, — связывается; остальные — новые сделки в программе (без отметки «новая из Битрикса»).</p>
      <div class="row bx-btns"><label class="f bx-num"><span>Созданные с${UiKit.tip('<p>С какой даты создания показать сделки Битрикса. Пример: 01.01.2026 — все сделки этого года из воронок обмена. Сначала — предпросмотр «Что будет», загрузка — только отмеченных.</p>')}</span><input type="date" id="bxFromD" value="${esc((preview && preview.from) || '')}"></label>
        <button class="btn" type="button" id="bxImpPv"${state.on ? '' : ' disabled'}>Показать</button></div>
      ${preview ? this._preview(preview, cats) : ''}</div>`;
  }

  /** События вкладки. */
  static bind() {
    const panel = BitrixPanel;
    panel.one('#bxImpPv').onclick = event => this._show(event.target);
    const all = panel.one('#bxImpAll');
    if (all)
      all.onchange = event =>
        panel.all('[data-bximp]:not(:disabled)').forEach(box => {
          box.checked = event.target.checked;
        });
    const start = panel.one('#bxImpGo');
    if (start) start.onclick = () => this._import();
  }

  static async _show(button) {
    const panel = BitrixPanel;
    const from = panel.one('#bxFromD').value;
    if (!from) {
      panel.render({ t: 'Выберите дату', err: true });
      return;
    }
    button.disabled = true;
    button.textContent = 'Ищу…';
    try {
      panel.imp = { ...(await AdminApi.post('bitrix/import/preview', { from })), from };
      panel.render();
    } catch (error) {
      panel.render({ t: String(error.message || error), err: true });
    }
  }

  static async _import() {
    const panel = BitrixPanel;
    const ids = panel.all('[data-bximp]:checked').map(box => box.dataset.bximp);
    if (!ids.length) {
      panel.render({ t: 'Ничего не отмечено', err: true });
      return;
    }
    const text = 'Сделки Битрикса появятся в кабинете у своих менеджеров; связанные — обновятся при следующем обмене.';
    if (!(await AdminDialog.confirm(`Загрузить сделок: ${ids.length}?`, text, 'Загрузить'))) return;
    const from = panel.imp.from;
    panel.imp = null;
    panel.run(
      () => AdminApi.post('bitrix/import', { from, ids }),
      reply => {
        const result = reply.result || {};
        return `Загружено: новых ${result.created || 0}, связано ${result.linked || 0}, пропущено ${result.skipped || 0}`;
      },
    );
  }
}
