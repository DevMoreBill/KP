import { AdminApi, AdminDialog, AdminState } from './admin-core.js';
import { FeedDiscounts } from './feed-disc.js';
import { FeedForm, FeedPanel } from './feed-panel.js';
import { FeedPurgeUi, FeedRulesUi } from './feed-rules.js';
import { FeedState } from './feed-state.js';
import { FeedJob, FeedLog, FeedPreview } from './feed-view.js';
import { MakerLogoPanel } from './maker-logos.js';
import { SettingsWindow } from './settings-window.js';
import { StDirty, StNav } from './settings-tools.js';

/** «Фиды поставщиков»: товарный фид (YML) или фид из файлов (парс сайта + прайс) — загрузка в каталог и сверка цен. */
export class FeedsTab {
  static POLL_MS = 1500;
  static TIP =
    '<p>Товарный фид (YML, «Яндекс.Маркет») — выгрузка каталога с сайта поставщика: характеристики, фото, цены, наличие. Раз в день программа сверяет РРЦ и наличие.</p><p>Фид из файлов — для поставщика без YML: файл парса сайта (CSV: категория, название, ссылка, картинки, описание, характеристики) и прайс (XLSX). Позиции каталога создаются из парса, цена и артикул берутся из строки прайса с тем же названием. Новый прайс загружается в любой момент — «Обновить цены из прайса» пересчитает закупку.</p><p>«Проверить фид» покажет, что в нём есть, и предложит категории. «Что загружать» — какие марки, слова, цены, наличие и какие поля обновлять. «Что загрузится…» — план без записи: что добавится, что изменится, что пропущено; в каталог попадает только отмеченное — кнопкой «Загрузить отмеченное» (ручные правки сохраняются).</p>';
  static ACTIONS = {
    new: '_new',
    export: '_export',
    cancel: '_cancel',
    open: '_open',
    fdrop: '_dropFile',
    save: '_save',
    del: '_delete',
    preview: '_preview',
    check: '_check',
    rsave: '_rules',
    rplan: '_rules',
    rimport: '_import',
    purge: '_purge',
    unblock: '_unblock',
    plan: '_plan',
    build: '_build',
    addnew: '_addNew',
    rebuild: '_rebuild',
  };
  static DROP = {
    price: [
      'Убрать прайс?',
      'Цены из этого файла перестанут обновляться; уже записанные в каталог останутся.',
      'Прайс убран',
    ],
    extra: [
      'Убрать файл описаний?',
      'Описания, уже записанные в каталог, останутся; при следующей загрузке позиции получат описание из фида.',
      'Файл описаний убран',
    ],
    stock: [
      'Убрать файл остатков?',
      'Наличие в каталоге обновится при следующем «Обновить цены…» — у всех позиций станет «нет данных».',
      'Файл остатков убран',
    ],
  };

  /**
   * Вкладка.
   * @param {HTMLElement} main
   */
  static async render(main) {
    const [reply, sups] = await Promise.all([
      AdminApi.get('feeds'),
      FeedState.sups ? Promise.resolve(FeedState.sups) : api('/api/suppliers').catch(() => []),
    ]);
    FeedState.types = reply.types || [];
    FeedState.sups = sups || [];
    const items = reply.items || [];
    if (FeedState.sel && !items.some(feed => feed.id === FeedState.sel)) FeedState.sel = null;
    if (!items.length && !FeedState.edit) FeedState.edit = { ...FeedState.REMEZA };
    const feed = items.find(entry => entry.id === FeedState.sel);
    main.innerHTML = this._html(items, feed);
    MakerLogoPanel.bind(main);
    this._bind(main);
    if (!feed) return;
    FeedLog.load(feed.id);
    if (feed.job && feed.job.state === 'run') this.poll(feed.id, main);
  }

  static _html(items, feed) {
    return `<div class="st-card"><div class="row fd-head"><div class="sub" style="margin:0">Подключённые фиды${tip(this.TIP)}</div>
      <span class="sp"></span><button class="btn" type="button" data-fd="new">+ Новый фид</button></div>
    ${items.length ? `<div class="st-list">${items.map(entry => FeedPanel.row(entry)).join('')}</div>` : '<p class="muted">Фидов пока нет.</p>'}</div>
    ${FeedState.edit ? FeedForm.html(FeedState.edit, { isNew: true }) : ''}
    ${feed ? FeedPanel.html(feed) : ''}
    ${MakerLogoPanel.html()}`;
  }

  static _bind(main) {
    main.onclick = event => {
      const chip = event.target.closest('[data-rpf]');
      if (!chip || !FeedState.rplan) {
        this.click(event, main);
        return;
      }
      FeedState.rpf = chip.dataset.rpf;
      const box = main.querySelector('#frPlan');
      if (box) box.innerHTML = FeedRulesUi.plan(FeedState.rplan);
    };
    main.onkeydown = event => {
      const row = event.target.closest?.('.fd-row');
      if (!row || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      row.click();
    };
    main.oninput = event => {
      const input = event.target;
      if (input.dataset.fdd !== 'kwMax') return;
      const label = input.parentNode.querySelector('.fd-dku');
      if (label) label.hidden = !input.value.trim();
    };
    main.onchange = event => this._change(main, event.target);
  }

  static _change(main, target) {
    const data = target.dataset;
    if (data.rpall != null) {
      main.querySelectorAll('[data-rpo]').forEach(input => {
        input.checked = target.checked;
      });
      FeedRulesUi.count(main);
      return;
    }
    if (data.rpo != null) FeedRulesUi.count(main);
    else if (data.fdc != null) this._discCats(main, target);
    else if (data.fdcat != null) {
      FeedState.cats[data.fdcat] = target.value;
      FeedPreview.count(main);
    } else if (data.fdfile != null) this.upload(target, main);
    else if (data.fdcur != null) this._cur(main, target);
    else if (data.fdf === 'kind' && FeedState.edit) this._kind(main, target);
  }

  static _discCats(main, target) {
    FeedDiscounts.read(main);
    const details = target.closest('details');
    if (details)
      details.querySelector('summary').textContent = FeedDiscounts.catsText(
        FeedState.disc.discounts[+details.dataset.fdr].cats,
      );
  }

  static _cur(main, target) {
    this.fileSet(main, {
      kind: 'price',
      slot: target.dataset.fdcur,
      act: 'cur',
      cur: target.value,
      sheet: target.dataset.sheet || '',
    })
      .then(() => toast('Валюта прайса сохранена'))
      .catch(error => toast(error.message || String(error)));
  }

  static _kind(main, target) {
    const files = target.value === 'files';
    FeedState.edit = {
      ...(files ? FeedState.FILES : FeedState.REMEZA),
      ...FeedForm.values(target.closest('[data-fdform]')),
      kind: target.value,
    };
    if (files && FeedState.edit.url === FeedState.REMEZA.url) FeedState.edit.url = '';
    this.render(main);
  }

  /**
   * Изменить файл фида (валюта прайса, убрать файл) и перерисовать.
   * @param {HTMLElement} main
   * @param {object} body
   * @returns {Promise<*>}
   */
  static async fileSet(main, body) {
    await AdminApi.post(`feeds/${FeedState.sel}/file`, body);
    FeedState.prev = null;
    return this.render(main);
  }

  static _uploaded(kind, file, meta) {
    if (kind === 'pages')
      return `Парс сайта загружен: ${Fmt.num(meta.rows)} ${plural(meta.rows, 'позиция', 'позиции', 'позиций')}`;
    if (kind === 'extra')
      return `Описания загружены: ${Fmt.num(meta.series)} ${plural(meta.series, 'серия', 'серии', 'серий')}, ${Fmt.num(meta.rows)} ${plural(meta.rows, 'позиция', 'позиции', 'позиций')}. Нажмите «Загрузить в каталог», чтобы обновить описания`;
    if (kind === 'stock')
      return `Остатки загружены: ${Fmt.num(meta.rows)} ${plural(meta.rows, 'модель', 'модели', 'моделей')}, в наличии ${Fmt.num(meta.inStock)}. Нажмите «… и остатки», чтобы перенести их в каталог`;
    const noCur = (meta.sheetCurs || []).some(sheet => sheet.rows && !sheet.cur)
      ? ' — у части листов не указана валюта, выберите её'
      : '';
    return `Прайс «${file.name}» загружен: ${Fmt.num(meta.rows)} ${plural(meta.rows, 'строка', 'строки', 'строк')}, с ценой ${Fmt.num(meta.withPrice)}${noCur}`;
  }

  static async _send(file, kind, slot) {
    try {
      return await AdminApi.get(
        `feeds/${encodeURIComponent(FeedState.sel)}/upload?kind=${kind}&name=${encodeURIComponent(file.name)}${slot ? `&slot=${encodeURIComponent(slot)}` : ''}`,
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file },
      );
    } catch (error) {
      throw new Error(`«${file.name}»: ${error.message}`);
    }
  }

  /**
   * Загрузить файлы фида (парс, прайсы, остатки, описания).
   * @param {HTMLInputElement} input
   * @param {HTMLElement} main
   */
  static async upload(input, main) {
    const files = [...(input.files || [])];
    if (!files.length) return;
    // после загрузки панель перерисуется — несохранённые поля пропали бы молча
    if (!(await StDirty.leave())) {
      input.value = '';
      return;
    }
    const status = $('#fdUpSt');
    const kind = input.dataset.fdfile;
    const slot = input.dataset.slot || '';
    input.disabled = true;
    const done = [];
    try {
      for (const file of files) {
        if (status) status.textContent = `Загружаю «${file.name}» (${Fmt.size(file.size)})…`;
        const meta = await this._send(file, kind, slot);
        done.push(meta);
        toast(this._uploaded(kind, file, meta));
      }
      FeedState.prev = null;
      this.render(main);
    } catch (error) {
      input.disabled = false;
      if (status) status.textContent = '';
      toast(`Файл не принят: ${error.message || error}`);
      if (done.length) this.render(main);
    }
  }

  /**
   * Следить за загрузкой или проверкой, пока идёт.
   * @param {string} feedId
   * @param {HTMLElement} main
   */
  static poll(feedId, main) {
    clearTimeout(FeedState.poll);
    FeedState.poll = setTimeout(() => this._tick(feedId, main), this.POLL_MS);
  }

  static async _tick(feedId, main) {
    if (AdminState.tab !== 'feeds' || !$('#fdPanel')) return;
    let job = null;
    try {
      job = (await AdminApi.get(`feeds/${feedId}/status`)).job;
    } catch {
      return;
    }
    const box = $('#fdJob');
    if (box) box.innerHTML = FeedJob.html(job);
    if (job && job.state === 'run') {
      this.poll(feedId, main);
      return;
    }
    if (job && job.state === 'done') refreshCat();
    FeedState.prev = null;
    this.render(main);
  }

  /**
   * Кнопки вкладки.
   * @param {Event} event
   * @param {HTMLElement} main
   */
  static async click(event, main) {
    const button = event.target.closest('[data-fd]');
    if (!button) return;
    const action = button.dataset.fd;
    try {
      if (action.startsWith('disc')) {
        await FeedDiscounts.click(action, button, main);
        return;
      }
      const method = this.ACTIONS[action];
      if (method) await this[method]({ action, button, main });
    } catch (error) {
      toast(error.message || String(error));
      this.render(main);
    }
  }

  static async _new({ main }) {
    if (!(await StDirty.leave())) return;
    FeedState.edit = { ...FeedState.NEW_YML };
    FeedState.sel = null;
    await this.render(main);
  }

  static async _export({ button }) {
    StNav.sup = button.dataset.sup || '';
    StNav.select('backup');
    await SettingsWindow.tab();
  }

  static async _cancel({ main }) {
    if (!(await StDirty.leave())) return;
    FeedState.edit = null;
    await this.render(main);
  }

  static async _open({ button, main }) {
    if (!(await StDirty.leave())) return;
    FeedState.sel = FeedState.sel === button.dataset.id ? null : button.dataset.id;
    FeedState.forget();
    await this.render(main);
  }

  static async _dropFile({ button, main }) {
    const [title, text, done] = this.DROP[button.dataset.kind] || this.DROP.stock;
    if (!(await AdminDialog.confirm(title, text, 'Убрать'))) return;
    await this.fileSet(main, { kind: button.dataset.kind, slot: button.dataset.slot || '', act: 'drop' });
    toast(done);
  }

  static _form(button, main) {
    return button.closest('[data-fdform]') || main.querySelector(`[data-fdform="${FeedState.sel}"]`);
  }

  static async _save({ button, main }) {
    const form = this._form(button, main);
    const isNew = form.dataset.fdform === 'new';
    const values = FeedForm.values(form);
    const old = isNew ? {} : (await AdminApi.get('feeds')).items.find(entry => entry.id === FeedState.sel) || {};
    const feed = await AdminApi.post('feeds', {
      ...old,
      ...values,
      kind: isNew ? values.kind || 'yml' : old.kind,
      id: isNew ? undefined : FeedState.sel,
    });
    FeedState.edit = null;
    FeedState.sel = feed.id;
    FeedState.prev = null;
    toast(isNew && feed.kind === 'files' ? 'Фид создан — загрузите файл парса сайта и прайс' : 'Фид сохранён');
    await this.render(main);
  }

  static async _delete({ main }) {
    if (
      !(await AdminDialog.confirm(
        'Удалить фид?',
        'Позиции, уже загруженные в каталог, останутся; обновление цен и наличия для них прекратится.',
        'Удалить',
      ))
    )
      return;
    await AdminApi.post(`feeds/${FeedState.sel}/delete`);
    FeedState.sel = null;
    FeedState.prev = null;
    toast('Фид удалён');
    await this.render(main);
  }

  static async _preview({ button, main }) {
    button.disabled = true;
    button.textContent = 'Читаю…';
    const preview = await AdminApi.post(`feeds/${FeedState.sel}/preview`);
    FeedState.prev = { ...preview, id: FeedState.sel };
    FeedState.cats = {};
    preview.cats.forEach(cat => {
      FeedState.cats[cat.id] = cat.map;
    });
    await this.render(main);
    FeedPreview.count(main);
  }

  static async _check({ main }) {
    await AdminApi.post(`feeds/${FeedState.sel}/check`);
    toast('Обновление началось');
    await this.render(main);
  }

  static _cats(feed) {
    return FeedState.previewed() ? { ...FeedState.cats } : feed.cats;
  }

  static async _rules({ action, button, main }) {
    const box = main.querySelector('[data-frform]');
    const feed = (await AdminApi.get('feeds')).items.find(entry => entry.id === FeedState.sel);
    if (!feed) return;
    const rules = box ? FeedRulesUi.read(box) : { filter: feed.filter, fields: feed.fields };
    if (action === 'rsave') {
      await AdminApi.post('feeds', { ...feed, ...rules, cats: this._cats(feed) });
      toast('Сохранено: что загружать');
      await this.render(main);
      return;
    }
    button.disabled = true;
    button.textContent = 'Считаю…';
    const plan = await AdminApi.post(`feeds/${FeedState.sel}/loadplan`, {
      ...rules,
      cats: FeedState.previewed() ? { ...FeedState.cats } : undefined,
    });
    FeedState.rplan = { ...plan, id: FeedState.sel };
    FeedState.rpf = '';
    if (box) await AdminApi.post('feeds', { ...feed, ...rules, cats: this._cats(feed) }); // план — по сохранённым правилам
    await this.render(main);
    main.querySelector('#frPlan')?.scrollIntoView({ block: 'nearest' });
  }

  static async _import({ main }) {
    const plan = FeedState.rplan;
    const only = FeedRulesUi.only(main);
    const count = only ? only.length : plan.counts.add + plan.counts.update;
    if (!count) {
      toast('Ничего не отмечено');
      return;
    }
    const text = `Добавится ${Fmt.num(plan.counts.add)}, изменится до ${Fmt.num(plan.counts.update)} (только поля из «Обновлять у загруженных»). Пропущенное не загружается.`;
    if (!(await AdminDialog.confirm(`Загрузить в каталог: ${Fmt.num(count)}?`, text, 'Загрузить'))) return;
    await AdminApi.post(`feeds/${FeedState.sel}/import`, only ? { only } : {});
    FeedState.rplan = null;
    toast('Загрузка началась — можно продолжать работу');
    await this.render(main);
  }

  static _purge({ main }) {
    return FeedPurgeUi.open(FeedState.sel, main);
  }

  static async _unblock({ main }) {
    const text = 'При следующей загрузке фида удалённые позиции снова появятся в каталоге (если они есть в фиде).';
    if (!(await AdminDialog.confirm('Вернуть удалённые позиции в загрузку?', text, 'Вернуть'))) return;
    await AdminApi.post(`feeds/${FeedState.sel}/unblock`);
    toast('Удалённые позиции снова будут загружаться');
    await this.render(main);
  }

  static async _plan({ button, main }) {
    button.disabled = true;
    button.textContent = 'Считаю…';
    const plan = await AdminApi.post(`feeds/${FeedState.sel}/plan`);
    const box = main.querySelector('#fdPrev');
    if (box) box.innerHTML = FeedPreview.buildPlan(plan);
    button.disabled = false;
    button.textContent = plan.built ? 'Что нового в парсе' : 'План сборки';
  }

  static async _build({ main }) {
    const trashMissing = !!main.querySelector('#fdTrashMissing')?.checked;
    const text = `Позиции производителя перестроятся по парсу и прайсу (описания, характеристики, фото, цены), дубли уйдут в корзину${trashMissing ? ', позиции, которых нет в парсе, — тоже' : ''}. Ручные правки в этих позициях заменятся. Перед сборкой программа сделает копию базы.`;
    if (!(await AdminDialog.confirm('Сформировать каталог по парсу?', text, 'Сформировать'))) return;
    await AdminApi.post(`feeds/${FeedState.sel}/import`, { trashMissing });
    toast('Сборка каталога началась — можно продолжать работу');
    FeedState.prev = null;
    await this.render(main);
  }

  static async _addNew({ main }) {
    await AdminApi.post(`feeds/${FeedState.sel}/import`, {});
    toast('Добавляю новые позиции из парса');
    await this.render(main);
  }

  static async _rebuild({ main }) {
    const text =
      'Позиции производителя снова перестроятся по парсу — ручные правки описаний, фото и характеристик в них заменятся. Обычно это не нужно: новые позиции добавляет «Добавить новые из парса».';
    if (!(await AdminDialog.confirm('Сформировать каталог заново?', text, 'Разрешить пересборку'))) return;
    await AdminApi.post(`feeds/${FeedState.sel}/rebuild`);
    toast('Теперь можно сформировать каталог заново');
    await this.render(main);
  }
}
