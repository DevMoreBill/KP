import { FeedDiscounts } from './feed-disc.js';
import { FeedFmt, FeedState } from './feed-state.js';
import { FeedPurgeUi, FeedRulesUi } from './feed-rules.js';
import { FeedJob, FeedPreview } from './feed-view.js';
import { UiKit } from '../../ui/ui-kit.js';
import { Spoiler } from '../station/spoiler.js';
import { Fmt } from '../../core/str.js';
import { esc } from '../../core/util.js';

/** Открытый фид: сверху — что сделать сейчас и файлы поставщика; редкое — под раскрытием (запоминается). */
export class FeedPanel {
  /**
   * Поставщик фида из справочника.
   * @param {object} feed
   * @returns {string}
   */
  static supName(feed) {
    const sup = (FeedState.sups || []).find(entry => entry.id === feed.supplier);
    return sup ? sup.name : '';
  }

  static _when(feed) {
    const last = feed.last;
    return [
      last && last.check ? `${FeedFmt.isFiles(feed) ? 'цены' : 'проверка'} ${FeedFmt.date(last.check.at)}` : '',
      last && last.import ? `загрузка ${FeedFmt.date(last.import.at)}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /**
   * Строка фида в списке.
   * @param {object} feed
   * @returns {string}
   */
  static row(feed) {
    const sup = this.supName(feed);
    const run = feed.job && feed.job.state === 'run';
    const open = feed.id === FeedState.sel;
    const when = this._when(feed);
    return `<div class="st-row fd-row${open ? ' on' : ''}" data-fd="open" data-id="${esc(feed.id)}" role="button" tabindex="0"><div><b>${esc(feed.name)}</b>
        <span class="muted">${sup ? `поставщик: ${esc(sup)} · ` : ''}в каталоге: ${Fmt.num(feed.linked)} ${KPGen.plural(feed.linked, 'позиция', 'позиции', 'позиций')}${when ? ` · ${esc(when)}` : ''}${feed.auto ? ' · автопроверка раз в день' : ''}</span>
        ${run ? `<span class="ok-t">${feed.job.kind === 'import' ? 'Загружаю' : 'Проверяю'}… ${feed.job.done}/${feed.job.total || '?'}</span>` : ''}</div>
      <div class="acts"><span class="fd-chev" aria-hidden="true">${open ? '▾' : '▸'}</span></div></div>`;
  }

  /**
   * Итог сетки скидок одной строкой.
   * @param {object} feed
   * @returns {string}
   */
  static discSum(feed) {
    const count = (feed.discounts || []).length;
    const other = feed.discount;
    if (!count && !other) return 'не задана — закупка без скидки';
    return `${count ? `${count} ${KPGen.plural(count, 'правило', 'правила', 'правил')}` : 'без правил'}${other ? `, остальное — ${FeedFmt.dec(other)} %` : ''}`;
  }

  /**
   * Раздел под раскрытием.
   * @param {string} key
   * @param {string} title
   * @param {string} sum
   * @param {string} body
   * @param {{open?: boolean}} [opts] open — раскрыт по умолчанию
   * @returns {string}
   */
  static sec(key, title, sum, body, { open = false } = {}) {
    return `<details class="fd-sec"${Spoiler.attr(`fd.${key}`, open)}><summary><b>${title}</b><span class="muted">${sum}</span></summary><div class="fd-secb">${body}</div></details>`;
  }

  static _settingsSum(feed, files) {
    const sup = this.supName(feed);
    return [
      files ? 'файлы' : 'YML',
      feed.maker ? `производитель ${feed.maker}` : '',
      sup ? `поставщик ${sup}` : 'поставщик не указан',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  static _data(feed, files) {
    const sup = this.supName(feed) || feed.name;
    return `<div class="row fd-acts"><button class="btn" type="button" data-fd="export" data-sup="${esc(sup)}"${feed.linked ? '' : ' disabled'} title="Копия с фото или Excel для правки — без цен и остатков">Выгрузить каталог поставщика…</button></div>
        ${FeedPurgeUi.row(feed)}${files && feed.built ? `<div class="row fd-acts"><button class="btn ghost danger" type="button" data-fd="rebuild">Сформировать каталог заново…</button><span class="muted">перестроит позиции по парсу; обычно не нужно</span></div>` : ''}<div class="row fd-acts"><button class="btn ghost danger" type="button" data-fd="del">Удалить фид…</button><span class="muted">позиции в каталоге останутся</span></div>`;
  }

  static _logSum(feed) {
    const last = feed.last;
    if (!last || !(last.import || last.check)) return 'записей нет';
    const imported = (last.import || {}).at || '';
    const checked = (last.check || {}).at || '';
    return `последняя запись — ${esc(FeedFmt.date(imported > checked ? last.import.at : last.check.at))}`;
  }

  /**
   * Панель открытого фида.
   * @param {object} feed
   * @returns {string}
   */
  static html(feed) {
    const files = FeedFmt.isFiles(feed);
    const src = files
      ? esc(FeedFmt.filesShort(feed))
      : `<a href="${esc(feed.url)}" target="_blank" rel="noopener">${esc(feed.url)}</a>`;
    const preview = FeedState.prev && FeedState.prev.id === feed.id ? FeedPreview.html(FeedState.prev, feed) : '';
    return `<div class="st-card fd-panel" id="fdPanel">
      <div class="fd-ph"><b>${esc(feed.name)}</b><span class="muted">${src}</span></div>
      ${FeedActions.html(feed)}<div id="fdJob">${FeedJob.html(feed.job)}</div><div id="fdPrev">${preview}</div>
      ${files ? FeedFiles.html(feed) : FeedFiles.extra(feed)}
      ${this.sec('rules', 'Что загружать', esc(FeedRulesUi.sum(feed)), FeedRulesUi.html(feed), { open: true })}
      ${this.sec('disc', 'Скидки поставщика', this.discSum(feed), `<div id="fdDisc">${FeedDiscounts.html(feed)}</div>`)}
      ${this.sec('set', 'Настройки фида', esc(this._settingsSum(feed, files)), FeedForm.html(feed))}
      ${this.sec('data', 'Позиции фида: выгрузить, удалить', `в каталоге ${Fmt.num(feed.linked)}${feed.excluded ? `, не загружаются снова ${Fmt.num(feed.excluded)}` : ''}`, this._data(feed, files))}
      ${this.sec('log', 'Журнал загрузок и проверок', this._logSum(feed), '<div id="fdLog"><p class="muted">Загружаю…</p></div>')}
    </div>`;
  }
}

/** Кнопки шага открытого фида. */
export class FeedActions {
  static NO_PAGES = ' disabled title="Сначала загрузите файл парса сайта"';

  /**
   * Кнопки.
   * @param {object} feed
   * @returns {string}
   */
  static html(feed) {
    const files = FeedFmt.isFiles(feed);
    const ready = !files || (feed.files && feed.files.pages);
    if (files) return this._files(feed, ready);
    return `<div class="row fd-acts"><button class="btn" type="button" data-fd="preview"${ready ? '' : this.NO_PAGES}>Проверить фид</button>
    <button class="btn primary" type="button" data-fd="rplan">Что загрузится…</button>
    <button class="btn" type="button" data-fd="check"${feed.linked ? '' : ' disabled title="Сначала загрузите позиции в каталог"'}>Проверить цены и наличие сейчас</button></div>`;
  }

  // фид из файлов: сначала «Сформировать каталог», потом парс только добавляет новые позиции, а прайс обновляет цены
  static _files(feed, ready) {
    const noFile = ready ? '' : this.NO_PAGES;
    const built = feed.built;
    if (!built) return this._unbuilt(noFile);
    const stock = feed.files && feed.files.stock;
    return `<div class="fd-build"><p class="ok-t">Каталог сформирован ${esc(FeedFmt.date(built.at))}${built.by ? ` · ${esc(built.by)}` : ''}: позиций ${Fmt.num(built.items || 0)}, сопоставлено с имевшимися ${Fmt.num(built.linked || 0)}, в корзину ${Fmt.num(built.trashed || 0)}.</p>
      <p class="muted">Парс больше не меняет позиции каталога — только добавляет новые, если они появятся. Описания, фото и характеристики правятся вручную в карточке. Цены${stock ? ' и остатки' : ''}: загрузите новый прайс${stock ? ' или файл остатков' : ''} и нажмите «${FeedFmt.updLabel(feed)}».</p></div>
    <div class="row fd-acts"><button class="btn" type="button" data-fd="plan"${noFile}>Что нового в парсе</button>
      <button class="btn" type="button" data-fd="addnew"${noFile}>Добавить новые из парса</button>
      <button class="btn primary" type="button" data-fd="check"${feed.linked ? '' : ' disabled'}>${FeedFmt.updLabel(feed)}</button></div>`;
  }

  static _unbuilt(noFile) {
    return `<div class="fd-build"><p class="muted">${UiKit.tip('<p>Парс сайта — полный список номенклатуры. «Сформировать каталог» создаёт позицию на каждое исполнение из парса (давление, ресивер, осушитель — как на сайте): описание по блокам, характеристики (сверены с прайсом — он точнее), главное фото из парса, цена из прайса.</p><p>Уже имеющиеся позиции производителя (из прошлых загрузок и заведённые вручную) сопоставляются с позициями парса и перестраиваются — id сохраняется, ссылки в КП не теряются. Лишние совпадения (дубли, например карточка «на все давления») уходят в корзину — 30 дней их можно восстановить.</p><p>После сборки парс больше не меняет позиции — только добавляет новые; описания, фото и характеристики правятся вручную. Цены обновляются загрузкой нового прайса.</p>')} Каталог производителя ещё не сформирован по полному парсу.</p></div>
    <div class="row fd-acts"><button class="btn" type="button" data-fd="preview"${noFile}>Проверить фид</button>
      <button class="btn" type="button" data-fd="plan"${noFile}>План сборки</button>
      <button class="btn primary" type="button" data-fd="build"${noFile}>Сформировать каталог</button></div>`;
  }
}

/** Форма фида: новый или «Настройки фида» открытого. */
export class FeedForm {
  /**
   * Форма.
   * @param {object} feed
   * @param {{isNew?: boolean}} [opts] isNew — форма нового фида
   * @returns {string}
   */
  static html(feed, { isNew = false } = {}) {
    const files = FeedFmt.isFiles(feed);
    const kind = `<label class="f"><span>Источник</span><select data-fdf="kind"${isNew ? '' : ' disabled'}><option value="yml"${files ? '' : ' selected'}>Адрес фида (YML)</option><option value="files"${files ? ' selected' : ''}>Файлы: парс сайта + прайс</option></select></label>`;
    const body = files ? this._files(feed, kind, isNew) : this._yml(feed, kind, isNew);
    return `${this._open(feed, files, isNew)}
    <div class="st-ed-g">${body}</div>
    ${this._buttons(isNew)}</div>`;
  }

  static _open(feed, files, isNew) {
    if (!isNew) return `<div class="fd-form" data-fdform="${esc(feed.id)}">`;
    return `<div class="st-card fd-form" data-fdform="new"><p class="sub">${files ? 'Новый фид из файлов' : 'Новый фид'}</p>`;
  }

  static _buttons(isNew) {
    return `<div class="row fd-fb"><button class="btn primary" type="button" data-fd="save">${isNew ? 'Добавить фид' : 'Сохранить'}</button>${isNew ? '<button class="btn ghost" type="button" data-fd="cancel">Отмена</button>' : ''}</div>`;
  }

  static _common(feed, files) {
    const sups = (FeedState.sups || [])
      .map(
        sup => `<option value="${esc(sup.id)}"${sup.id === feed.supplier ? ' selected' : ''}>${esc(sup.name)}</option>`,
      )
      .join('');
    return `<label class="f"><span>Название</span><input type="text" data-fdf="name" value="${esc(feed.name || '')}" placeholder="${files ? 'Dalgakiran' : 'Remeza'}"></label>
      <label class="f"><span>Производитель по умолчанию</span><input type="text" data-fdf="maker" value="${esc(feed.maker || '')}" placeholder="${files ? 'Dalgakiran' : 'если в фиде нет поля vendor'}"></label>
      <label class="f"><span>Поставщик в справочнике${UiKit.tip('Чей это фид: поставщик из «Клиенты и поставщики → Поставщики и склады». По нему работают фильтр «Поставщик» в каталоге и выгрузка «Каталог поставщика». Не указан — поставщиком считается название фида.')}</span><select data-fdf="supplier"><option value="">— не указан (= название фида) —</option>${sups}</select></label>`;
  }

  static _files(feed, kind, isNew) {
    const curs = FeedState.CURS.map(
      ([value, title]) => `<option value="${value}"${(feed.cur || '') === value ? ' selected' : ''}>${title}</option>`,
    ).join('');
    return `${kind}${this._common(feed, true)}
      <label class="f"><span>Цена в прайсе — это${UiKit.tip('<p><b>Наша закупка</b> — дилерский прайс: цена идёт в закупку позиции (валюта — как в прайсе), цена продажи остаётся за менеджером и «Экономикой сделки».</p><p><b>РРЦ</b> — розничный прайс: цена идёт в РРЦ и цену КП, закупка — РРЦ минус скидка.</p>')}</span><select data-fdf="priceKind"><option value="cost"${feed.priceKind !== 'rrc' ? ' selected' : ''}>наша закупка (дилерская цена)</option><option value="rrc"${feed.priceKind === 'rrc' ? ' selected' : ''}>РРЦ (розничная цена)</option></select></label>
      <label class="f"><span>Валюта прайса</span><select data-fdf="cur">${curs}</select></label>
      ${isNew ? `<label class="f"><span>Скидка от цены прайса, %${UiKit.tip('Если задана — закупка = цена прайса минус скидка. Пусто — закупка равна цене прайса. Сетку скидок по видам оборудования можно задать после создания фида.')}</span><input type="text" inputmode="decimal" data-fdf="discount" value="${esc(feed.discount ?? '')}" placeholder="например, 10"></label>` : ''}
      <label class="fd-auto"><input type="checkbox" data-fdf="priceOnly"${feed.priceOnly ? ' checked' : ''}> Добавлять и позиции, которых нет в парсе (только из прайса)${UiKit.tip('Строки прайса, для которых не нашлось страницы сайта: без фото и описания, с характеристиками из столбцов прайса. Разделы — по листам прайса.')}</label>
      <label class="fd-auto"><input type="checkbox" data-fdf="pageDesc"${feed.pageDesc ? ' checked' : ''}> Дополнять описание и фото со страницы товара (дольше)${UiKit.tip('Программа откроет страницу каждого товара по ссылке из парса. Обычно не нужно: описание, фото и характеристики уже есть в файле парса.')}</label>`;
  }

  static _yml(feed, kind, isNew) {
    return `${kind}<label class="f wide"><span>Адрес фида (YML)</span><input type="text" inputmode="url" data-fdf="url" value="${esc(feed.url || '')}" placeholder="https://…/catalog_export/yandex.php"></label>
      ${this._common(feed, false)}
      ${isNew ? `<label class="f"><span>Наша скидка от РРЦ, %${UiKit.tip('Если задана — закупка позиции = РРЦ минус скидка; обновляется вместе с РРЦ. Пусто — закупку фид не трогает. Сетку скидок по видам оборудования можно задать после создания фида.')}</span><input type="text" inputmode="decimal" data-fdf="discount" value="${esc(feed.discount ?? '')}" placeholder="например, 25"></label>` : ''}
      <label class="fd-auto"><input type="checkbox" data-fdf="auto"${feed.auto !== false ? ' checked' : ''}> Раз в день проверять РРЦ и наличие</label>
      <label class="fd-auto"><input type="checkbox" data-fdf="pageDesc"${feed.pageDesc !== false ? ' checked' : ''}> Описание, фото и применимость — со страницы товара${UiKit.tip('При загрузке в каталог программа открывает страницу каждого товара (ссылка из фида): описание из блока описания (itemprop="description") — если оно длиннее описания в фиде; до 8 фото товара (без блоков «похожие товары»); характеристики, которых нет в фиде; у запчастей — применимость («Применяемость», «Подходит для…»). Страницы запоминаются на 30 дней; первая загрузка большого фида — дольше на несколько минут. Описание, исправленное вручную, не затирается.')}</label>`;
  }

  /**
   * Значения полей формы.
   * @param {HTMLElement} box
   * @returns {object}
   */
  static values(box) {
    const out = {};
    box.querySelectorAll('[data-fdf]').forEach(input => {
      out[input.dataset.fdf] = input.type === 'checkbox' ? input.checked : input.value.trim();
    });
    return out;
  }
}

/** Файлы фида: парс сайта, прайсы, остатки (фид из файлов) или описания к YML-фиду. */
export class FeedFiles {
  static PAGES_TIP =
    '<p><b>JSON</b> (надёжнее): {"items": [{"category", "name", "model", "url", "images": [адреса, первое — главное], "description": [{"title": "Назначение", "text": "…"}, {"title": "Общие характеристики", "items": ["…"]}], "specs": [{"name": "Давление", "value": "8,5 бар"}]}]}.</p><p><b>CSV</b>: столбцы — категория, название, ссылка на страницу товара, картинки (через « | »), описание, технические характеристики («Ключ: значение | Ключ: значение»). Первая строка — заголовки.</p><p>Из него создаются позиции каталога: название, раздел, описание, характеристики, фото (скачиваются по ссылкам).</p>';
  static STOCK_TIP =
    '<p>Необязательно. Выгрузка склада поставщика в одном из видов:</p><p><b>сводка</b> — «Артикул», «Номенклатура» и количество (столбец с числами можно не подписывать);</p><p><b>по единицам</b> — строка на каждую машину: «Бренд», «Модель», «Статус» (на складе / в пути / в производстве), «Склад», «Скидки и акции». Программа считает, сколько штук в наличии и на каком складе, сколько в пути и в производстве (с датой, если она в статусе).</p><p>Позиция находится по артикулу из прайса, иначе — по коду модели в названии. Нет в файле — «нет в наличии». Чтобы обновить остатки, загрузите новый файл и нажмите «Обновить цены и остатки».</p>';
  static EXTRA_TIP =
    '<p>Необязательно. Если в фиде у части позиций нет описания или вместо него рекламный текст сайта, загрузите файл описаний (JSON):</p><p><b>series</b> — описание серии: раздел фида (cats — id, names — название), при необходимости шаблон названия (match); mode «empty» — только позициям без описания, «replace» — вместо описания фида;</p><p><b>items</b> — описание отдельной позиции (oid — id предложения или url — ссылка на товар);</p><p><b>logos</b> — логотипы марок (картинка data:image/…), если в каталоге логотипа марки ещё нет.</p><p>Описание из файла важнее описания со страницы товара. Цены и наличие по-прежнему берутся из фида.</p>';
  static PRICE_TIP =
    '<p>Книги Excel с листами по сериям: шапка «Модель» (полное название), характеристики, «Цена»/«РРЦ» (и столбцы опций). Объединённые ячейки учитываются. Можно загрузить несколько прайсов — по одному на марку или раздел; строки всех прайсов сопоставляются с парсом вместе.</p><p>Валюта берётся из шапки («Цена, €», «РРЦ, USD»). Если в файле её нет — выберите валюту у прайса (или у отдельного листа). «Дилерская цена» и «Дилер скидка, %» идут в закупку.</p><p>Новый прайс той же марки (с тем же именем файла без даты) заменяет прежний. Чтобы обновить цены, загрузите прайсы и нажмите «Обновить цены…».</p>';

  static _row({ kind, title, accept, hint, meta, info, drop }) {
    return `<div class="fd-file"><div><b>${title}</b>${UiKit.tip(hint)}<br>${meta ? `<span class="muted">${esc(meta.name)} · ${esc(FeedFmt.date(meta.at))} · ${info}</span>` : '<span class="bad-t">файл ещё не загружен</span>'}</div>
      <div class="fd-fbtn"><label class="btn fd-up"><input type="file" accept="${accept}" data-fdfile="${kind}" hidden>${meta ? 'Заменить файл' : 'Загрузить файл'}</label>${drop ? `<button class="btn ghost" type="button" data-fd="fdrop" data-kind="${drop}" title="Убрать файл">✕</button>` : ''}</div></div>`;
  }

  /**
   * Файлы фида из файлов: что загружено и кнопки загрузки.
   * @param {object} feed
   * @returns {string}
   */
  static html(feed) {
    const files = feed.files || {};
    const pages = files.pages;
    const stock = files.stock;
    return `<div class="fd-files">
    ${this._row({ kind: 'pages', title: 'Парс сайта (JSON или CSV)', accept: '.json,application/json,.csv,text/csv', hint: this.PAGES_TIP, meta: pages, info: pages ? `${Fmt.num(pages.rows)} ${KPGen.plural(pages.rows, 'позиция', 'позиции', 'позиций')}, разделов: ${pages.cats}` : '' })}
    ${this.prices(FeedFmt.prices(feed))}
    ${this._row({ kind: 'stock', title: 'Остатки на складе (XLSX)', accept: FeedState.XLSX, hint: this.STOCK_TIP, meta: stock, info: stock ? FeedFmt.stockInfo(stock) : '', drop: stock ? 'stock' : '' })}
    <p class="muted fd-note" id="fdUpSt"></p></div>`;
  }

  /**
   * Фид YML: файл описаний (JSON).
   * @param {object} feed
   * @returns {string}
   */
  static extra(feed) {
    const extra = (feed.files || {}).extra;
    const info = extra
      ? `${Fmt.num(extra.series)} ${KPGen.plural(extra.series, 'серия', 'серии', 'серий')}, ${Fmt.num(extra.rows)} ${KPGen.plural(extra.rows, 'позиция', 'позиции', 'позиций')}${extra.logos ? `, логотипов: ${Fmt.num(extra.logos)}` : ''}`
      : '';
    return `<div class="fd-files"><div class="fd-file"><div><b>Описания к фиду (JSON)</b>${UiKit.tip(this.EXTRA_TIP)}<br>${extra ? `<span class="muted">${esc(extra.name)} · ${esc(FeedFmt.date(extra.at))} · ${info}</span>` : '<span class="muted">не загружен — описания только из фида</span>'}</div>
      <div class="fd-fbtn"><label class="btn fd-up"><input type="file" accept=".json,application/json" data-fdfile="extra" hidden>${extra ? 'Заменить файл' : 'Загрузить файл'}</label>${extra ? '<button class="btn ghost" type="button" data-fd="fdrop" data-kind="extra" title="Убрать файл">✕</button>' : ''}</div></div>
    <p class="muted fd-note" id="fdUpSt"></p></div>`;
  }

  /**
   * Прайсы фида.
   * @param {object[]} prices
   * @returns {string}
   */
  static prices(prices) {
    return `<div class="fd-prs"><div class="fd-file"><div><b>Прайсы поставщика (XLSX)</b>${UiKit.tip(this.PRICE_TIP)}<br>${prices.length ? `<span class="muted">${prices.length} ${KPGen.plural(prices.length, 'файл', 'файла', 'файлов')}</span>` : '<span class="bad-t">прайс ещё не загружен</span>'}</div>
      <label class="btn fd-up"><input type="file" accept="${FeedState.XLSX}" data-fdfile="price" data-slot="new" multiple hidden>+ Добавить прайс</label></div>${prices.map(price => this._price(price)).join('')}</div>`;
  }

  static _curSelect(value, attrs, auto) {
    return `<select ${attrs}>${FeedState.CURS.map(([code, title]) => `<option value="${code}"${(value || '') === code ? ' selected' : ''}>${code ? title : auto}</option>`).join('')}</select>`;
  }

  static _sheets(price, missing) {
    const all = (price.sheetCurs || []).filter(sheet => sheet.rows);
    if (all.length <= 1 && !missing.length) return '';
    const open = (missing.length && !price.curSet) || Object.keys(price.curSheets || {}).length;
    const rows = all
      .map(
        sheet =>
          `<label><span>${esc(sheet.name)} <i class="muted">· ${Fmt.num(sheet.rows)} · ${sheet.cur ? `в файле: ${esc(sheet.cur)}` : '<b class="bad-t">не указана</b>'}</i></span>${this._curSelect((price.curSheets || {})[sheet.name] || '', `data-fdcur="${esc(price.slot)}" data-sheet="${esc(sheet.name)}" aria-label="Валюта листа ${esc(sheet.name)}"`, 'как у прайса')}</label>`,
      )
      .join('');
    return `<details class="fd-shc"${open ? ' open' : ''}><summary>Валюта по листам${missing.length ? ` (не указана: ${missing.length})` : ''}</summary><div class="fd-shl">${rows}</div></details>`;
  }

  static _price(price) {
    const missing = (price.sheetCurs || []).filter(sheet => sheet.rows && !sheet.cur);
    const found = [
      ...new Set((price.sheetCurs || []).filter(sheet => sheet.rows && sheet.cur).map(sheet => sheet.cur)),
    ];
    const fallback = price.cur ? [price.cur] : [];
    const cur = (found.length ? found : fallback).map(code => FeedFmt.curName(code)).join(', ');
    const warn =
      missing.length && !price.curSet
        ? `<span class="bad-t"> · валюта не указана на ${missing.length} ${KPGen.plural(missing.length, 'листе', 'листах', 'листах')} — выберите</span>`
        : '';
    return `<div class="fd-file fd-pr"><div><b>Прайс</b> <span class="muted">${esc(price.name)} · ${esc(FeedFmt.date(price.at))} · ${Fmt.num(price.rows)} ${KPGen.plural(price.rows, 'строка', 'строки', 'строк')} на ${price.sheets} ${KPGen.plural(price.sheets, 'листе', 'листах', 'листах')}, с ценой: ${Fmt.num(price.withPrice)}${cur ? `, ${esc(cur)}` : ''}</span>${warn}
        <label class="fd-cur"><span>Валюта, где в файле не указана:</span> ${this._curSelect(price.curSet || '', `data-fdcur="${esc(price.slot)}" aria-label="Валюта прайса"`, 'как у фида')}</label>${this._sheets(price, missing)}</div>
      <div class="fd-fbtn"><label class="btn fd-up"><input type="file" accept="${FeedState.XLSX}" data-fdfile="price" data-slot="${esc(price.slot)}" hidden>Заменить</label><button class="btn ghost" type="button" data-fd="fdrop" data-kind="price" data-slot="${esc(price.slot)}" title="Убрать прайс">✕</button></div></div>`;
  }
}
