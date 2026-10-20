import { AdminApi } from './admin-core.js';
import { FeedFmt, FeedState } from './feed-state.js';

/** Ход загрузки или проверки фида. */
export class FeedJob {
  static PERCENT = 100;
  static MIN_BAR = 5;

  /**
   * Строка хода.
   * @param {object|null} job
   * @returns {string}
   */
  static html(job) {
    if (!job) return '';
    if (job.state === 'run')
      return `<div class="fd-prog"><span>${job.kind === 'import' ? 'Загружаю позиции, фото и характеристики' : 'Сверяю цены'}… ${job.done} из ${job.total || '?'}</span><i style="width:${job.total ? Math.round((job.done / job.total) * this.PERCENT) : this.MIN_BAR}%"></i></div>`;
    if (job.state === 'error') return `<p class="msg err">${esc(job.msg)}</p>`;
    return job.msg ? `<p class="msg ok">${esc(job.msg)}</p>` : '';
  }
}

/** «Проверить фид»: что в нём есть, категории фида → категории программы; план сборки фида из файлов. */
export class FeedPreview {
  static LIST_MAX = 300;
  static KOP = 100;

  static _select(catId, value) {
    const types = FeedState.types
      .map(type => `<option value="${esc(type.id)}"${value === type.id ? ' selected' : ''}>${esc(type.name)}</option>`)
      .join('');
    return `<select data-fdcat="${esc(catId)}" aria-label="Категория программы"><option value="skip"${value === 'skip' ? ' selected' : ''}>— не загружать —</option>
    <option value=""${value ? '' : ' selected'}>по названию позиции</option>${types}</select>`;
  }

  static _sum(preview, files) {
    if (files)
      return [
        ['позиций', preview.total],
        ['с ценой из прайса', preview.withPrice],
        ['с фото', preview.withPhoto],
        ['уже в каталоге', preview.inCatalog],
      ];
    return [
      ['товаров', preview.total],
      ['в наличии', preview.available],
      ['с ценой', preview.withPrice],
      ['с остатком', preview.withQty],
      ['с фото', preview.withPhoto],
      ['с описанием', preview.withDesc],
      ['уже в каталоге', preview.inCatalog],
    ].filter(([, value]) => value != null);
  }

  static _match(preview, feed) {
    const match = preview.match || {};
    const how = match.how;
    const ways = how
      ? ` (по названию ${how.name || 0}, без знаков ${how.key || 0}, по модели ${(how.model || 0) + (how.short || 0) + (how.set || 0)})`
      : '';
    const priceOnly =
      feed && feed.priceOnly
        ? ' (загружаются как отдельные позиции, разделы «Прайс / …»)'
        : ' (не загружаются — есть настройка «Добавлять и позиции, которых нет в парсе»)';
    return `<p class="muted fd-match">Сопоставление с прайсом: строка прайса нашлась у ${Fmt.num(match.matched)} ${plural(match.matched, 'позиции', 'позиций', 'позиций')} парса${ways}; строк прайса без страницы на сайте — ${Fmt.num(match.priceOnly)}${priceOnly}. Позиции без строки прайса или с пустой ценой («по запросу») загружаются без цены.</p>`;
  }

  static _extra(extra) {
    return `<p class="muted fd-match">Файл описаний: описание из файла получили ${Fmt.num(extra.applied)} ${plural(extra.applied, 'позиция', 'позиции', 'позиций')} фида (серий в файле — ${Fmt.num(extra.series)}, позиций — ${Fmt.num(extra.items)}).</p>`;
  }

  static _qty(offer) {
    if (offer.qty != null) return offer.qty > 0 ? `в наличии ${offer.qty}` : 'нет';
    return offer.available ? 'в наличии' : 'нет';
  }

  static _sample(offer, files) {
    return `<tr><td>${esc(offer.name)}</td><td>${esc([offer.maker, offer.model].filter(Boolean).join(' '))}</td><td>${esc(offer.sku || '')}</td><td class="muted">${esc(FeedFmt.typeName(offer.cat))}</td><td class="num">${offer.price != null ? `${money(Math.round(offer.price * this.KOP))} ${esc(offer.cur || '')}` : '—'}</td>
        ${files ? '' : `<td>${this._qty(offer)}</td>`}<td class="num">${offer.pics} / ${offer.params}</td></tr>`;
  }

  /**
   * Предпросмотр фида.
   * @param {object} preview
   * @param {object} [feed]
   * @returns {string}
   */
  static html(preview, feed) {
    const files = preview.kind === 'files';
    const cats = preview.cats
      .map(
        cat =>
          `<tr><td>${esc(cat.path)}</td><td class="num">${cat.count}</td><td class="num">${cat.inCatalog || ''}</td><td class="muted">${FeedFmt.kinds(cat.kinds)}</td><td>${this._select(cat.id, FeedState.cats[cat.id] ?? cat.map)}</td></tr>`,
      )
      .join('');
    return `${this._head(preview, feed, files)}
    <div class="sub">Категории ${files ? 'парса' : 'фида'} → категории программы ${tip('По умолчанию категория определяется по названию каждой позиции: разделы фида часто — подборки («200 л/мин», «С ресивером»), где вперемешку винтовые и поршневые. Выберите категорию, только если весь раздел — одно и то же, или «не загружать».')}</div>
    <div class="fd-tw"><table class="fd-t"><thead><tr><th>Категория ${files ? 'в парсе' : 'в фиде'}</th><th class="num">Товаров</th><th class="num">В каталоге</th><th>По названию</th><th>Категория программы</th></tr></thead>
      <tbody>${cats}</tbody></table></div>
    <p class="muted fd-cnt" id="fdCnt"></p>
    ${preview.params.length ? `<details class="more"><summary>Характеристики (${preview.params.length})</summary><p class="muted">${preview.params.map(([key, count]) => `${esc(key)} <small>(${count})</small>`).join(' · ')}</p></details>` : ''}
    ${this._samples(preview, feed, files)}`;
  }

  static _head(preview, feed, files) {
    const sums = this._sum(preview, files)
      .map(([title, value]) => `<span><b>${Fmt.num(value)}</b> ${title}</span>`)
      .join('');
    return `<div class="fd-sum">${sums}${preview.shop && !files ? `<span class="muted">${esc(preview.shop)}${preview.date ? ` · ${esc(preview.date)}` : ''}</span>` : ''}</div>
    ${files && preview.match ? this._match(preview, feed) : ''}
    ${!files && preview.extra ? this._extra(preview.extra) : ''}`;
  }

  static _samples(preview, feed, files) {
    const cost = FeedFmt.costKind(feed || { kind: preview.kind, priceKind: 'cost' });
    return `<details class="more"><summary>Первые товары</summary><div class="fd-tw"><table class="fd-t"><thead><tr><th>Товар</th><th>Производитель, модель</th><th>Артикул</th><th>Категория</th><th class="num">${cost ? 'Закупка' : 'РРЦ'}</th>${files ? '' : '<th>Наличие</th>'}<th class="num">Фото / ТТХ</th></tr></thead>
      <tbody>${preview.sample.map(offer => this._sample(offer, files)).join('')}</tbody></table></div></details>`;
  }

  /**
   * Сколько позиций загрузится по выбранным категориям.
   * @param {HTMLElement} main
   */
  static count(main) {
    const preview = FeedState.prev;
    if (!preview) return;
    const label = main.querySelector('#fdCnt');
    if (!label) return;
    const count = preview.cats
      .filter(cat => (FeedState.cats[cat.id] ?? cat.map) !== 'skip')
      .reduce((sum, cat) => sum + cat.count, 0);
    label.textContent = `Будет загружено: ${count} ${plural(count, 'позиция', 'позиции', 'позиций')}. Новые появятся в каталоге, уже загруженные обновятся (ручные правки сохранятся).`;
    const button = main.querySelector('[data-fd=import]');
    if (button) button.textContent = `Загрузить в каталог (${count})`;
  }

  static _list(list, show) {
    return list.length
      ? `<p class="muted">${list.slice(0, this.LIST_MAX).map(show).join(' · ')}${list.length > this.LIST_MAX ? ' …' : ''}</p>`
      : '';
  }

  /**
   * План сборки каталога по парсу (или что нового в парсе после сборки).
   * @param {object} plan
   * @returns {string}
   */
  static buildPlan(plan) {
    const name = entry => esc(entry.name);
    if (plan.built)
      return `<div class="fd-plan"><p><b>Новых позиций в парсе: ${Fmt.num(plan.addCount)}</b>${plan.addCount ? ' — «Добавить новые из парса» создаст их; имеющиеся не изменятся.' : ' — каталог совпадает с парсом.'}</p>${this._list(plan.add, esc)}</div>`;
    return `<div class="fd-plan"><div class="fd-sum"><span><b>${Fmt.num(plan.offers)}</b> позиций в парсе</span><span><b>${Fmt.num(plan.withPrice)}</b> с ценой из прайса</span>
      <span><b>${Fmt.num(plan.links)}</b> сопоставлено с имеющимися</span><span><b>${Fmt.num(plan.new)}</b> новых</span><span><b>${Fmt.num(plan.dups.length)}</b> дублей — в корзину</span><span><b>${Fmt.num(plan.keep.length)}</b> нет в парсе</span></div>
    ${plan.dups.length ? `<details class="more" open><summary>Дубли — уйдут в корзину (${plan.dups.length})</summary>${this._list(plan.dups, name)}</details>` : ''}
    ${
      plan.keep.length
        ? `<details class="more"><summary>Позиции производителя, которых нет в парсе (${plan.keep.length})</summary>${this._list(plan.keep, name)}
      <label class="fd-auto"><input type="checkbox" id="fdTrashMissing"> Убрать и их в корзину (по умолчанию остаются в каталоге как есть)</label></details>`
        : ''
    }
    ${plan.linkSample.length ? `<details class="more"><summary>Имеющиеся позиции, которые перестроятся по парсу с новым названием (${plan.linkSample.length})</summary>${this._list(plan.linkSample, pair => `${esc(pair[0])} → <b>${esc(pair[1])}</b>`)}</details>` : ''}</div>`;
  }
}

/** Журнал загрузок и проверок фида. */
export class FeedLog {
  static PERCENT = 100;
  static TENTHS = 1000;
  static TEN = 10;

  /**
   * Загрузить журнал в раздел «Журнал загрузок и проверок».
   * @param {string} feedId
   */
  static async load(feedId) {
    try {
      const reply = await AdminApi.get(`feeds/${feedId}/log`);
      const box = $('#fdLog');
      if (!box) return;
      box.innerHTML = (reply.items || []).length
        ? reply.items.map(entry => this.item(entry)).join('')
        : '<p class="muted">Загрузок и проверок ещё не было.</p>';
    } catch (error) {
      const box = $('#fdLog');
      if (box) box.innerHTML = `<p class="muted">Журнал не загрузился: ${esc(error.message || error)}</p>`;
    }
  }

  static _kind(entry, costLog) {
    if (entry.kind !== 'import') return costLog ? 'Обновление закупки по прайсу' : 'Проверка РРЦ и наличия';
    if (entry.mode === 'build') return 'Сборка каталога по парсу';
    return entry.mode === 'add' ? 'Новые позиции из парса' : 'Загрузка в каталог';
  }

  static _sum(entry) {
    const photos = entry.photos;
    if (entry.kind !== 'import')
      return `проверено ${entry.checked}, обновлено ${entry.updated}${entry.new ? `, новых в фиде ${entry.new}` : ''}`;
    const photoText =
      photos && photos.items
        ? ` · фото: в среднем ${FeedFmt.dec(photos.avg)} на позицию, с несколькими фото — ${photos.multi} из ${photos.items}${photos.new ? `, скачано новых ${photos.new}` : ''}`
        : '';
    return `добавлено ${entry.added}, обновлено ${entry.updated}, без изменений ${entry.same}${photoText}`;
  }

  static _table(rows, show) {
    return `<table class="fd-t"><tbody>${rows.map(show).join('')}</tbody></table>`;
  }

  static _change(change) {
    if (!change.old) return '';
    const percent = ((change.new - change.old) / change.old) * this.PERCENT;
    return `${percent > 0 ? '+' : ''}${FeedFmt.dec(Math.round(((change.new - change.old) / change.old) * this.TENTHS) / this.TEN)} %`;
  }

  static _price(change) {
    const show = value => (change.cur ? FeedFmt.money(value, change.cur) : FeedFmt.rub(value));
    return `<tr><td>${esc(change.name)}</td><td class="muted">${change.kind === 'cost' ? 'Закупка' : 'РРЦ'}</td><td class="num">${show(change.old)} → <b class="${change.new > change.old ? 'bad-t' : 'ok-t'}">${show(change.new)}</b></td><td class="num">${this._change(change)}</td></tr>`;
  }

  static _build(entry) {
    if (entry.mode !== 'build') return '';
    return `<p class="sub">Сборка</p><p class="muted">Сопоставлено с имевшимися позициями: ${Fmt.num(entry.linked || 0)}, в корзину: ${Fmt.num(entry.trashed || 0)}.</p>${(entry.dups || []).length ? `<details class="more"><summary>Дубли в корзине (${entry.dups.length})</summary><p class="muted">${entry.dups.map(esc).join(' · ')}</p></details>` : ''}${(entry.keep || []).length ? `<details class="more"><summary>Позиции производителя, которых нет в парсе (${entry.keep.length})</summary><p class="muted">${entry.keep.map(esc).join(' · ')}</p></details>` : ''}`;
  }

  static _body(entry, costLog) {
    return `<div class="st-logb">${this._changes(entry, costLog)}
      ${this._news(entry)}
      ${this._build(entry)}
      ${this._errors(entry)}</div>`;
  }

  static _changes(entry, costLog) {
    const prices = entry.price || [];
    const stock = entry.stock || [];
    const gone = entry.gone || [];
    return `${prices.length ? `<p class="sub">${costLog ? 'Закупка' : 'РРЦ'}</p>${this._table(prices, change => this._price(change))}` : ''}
      ${stock.length ? `<p class="sub">Наличие</p>${this._table(stock, change => `<tr><td>${esc(change.name)}</td><td>${esc(change.old)} → <b>${esc(change.new)}</b></td></tr>`)}` : ''}
      ${gone.length ? `<p class="sub">Пропали из фида</p>${this._table(gone, change => `<tr><td>${esc(change.name)}</td></tr>`)}` : ''}`;
  }

  static _news(entry) {
    return `${entry.newSample && entry.newSample.length ? `<p class="sub">Новые товары в фиде (ещё не в каталоге)</p><p class="muted">${entry.newSample.map(esc).join(' · ')}${entry.new > entry.newSample.length ? ' …' : ''} — «Проверить фид» → «Загрузить в каталог».</p>` : ''}
      ${entry.cards ? this.cards(entry.cards) : ''}`;
  }

  static _errors(entry) {
    const errors = entry.errors || [];
    const quiet =
      !(entry.price || []).length &&
      !(entry.stock || []).length &&
      !(entry.gone || []).length &&
      !errors.length &&
      !entry.new;
    return `${errors.length ? `<p class="sub">Ошибки</p><p class="bad-t">${errors.map(esc).join('<br>')}</p>` : ''}
      ${quiet ? '<p class="muted">Изменений нет.</p>' : ''}`;
  }

  /**
   * Запись журнала.
   * @param {object} entry
   * @returns {string}
   */
  static item(entry) {
    const prices = entry.price || [];
    const stock = entry.stock || [];
    const gone = entry.gone || [];
    const costLog = prices.length && prices.every(change => change.kind === 'cost');
    const kind = this._kind(entry, costLog);
    if (entry.error)
      return `<div class="st-row"><div><b>${esc(FeedFmt.date(entry.at))} · ${kind}</b><span class="bad-t">${esc(entry.error)}</span></div></div>`;
    return `<details class="st-log"><summary><span class="t">${esc(FeedFmt.date(entry.at))}</span><b>${kind}</b><span class="muted">${esc(this._sum(entry))}${prices.length ? ` · ${costLog ? 'закупка' : 'РРЦ'} изменилась: ${prices.length}` : ''}${stock.length ? ` · наличие: ${stock.length}` : ''}${gone.length ? ` · нет в фиде: ${gone.length}` : ''}</span><span class="u">${esc(entry.by || '')}</span></summary>
    ${this._body(entry, costLog)}</details>`;
  }

  /**
   * Карточки производителя, заведённые вручную: сколько получили цену из прайса и какие — нет (почему).
   * @param {object} cards
   * @returns {string}
   */
  static cards(cards) {
    const list = (rows, title) =>
      rows.length
        ? `<details class="more"><summary>${title}: ${rows.length}</summary><p class="muted">${rows.map(row => esc(row.name) + (row.rows && row.rows.length ? ` <small>(${esc(row.rows[0])})</small>` : '')).join(' · ')}</p></details>`
        : '';
    return `<p class="sub">Карточки, заведённые вручную</p><p class="muted">Всего ${Fmt.num(cards.cards)}, цена из прайса — у ${Fmt.num(cards.priced)}, изменились — ${Fmt.num(cards.updated)}.</p>
    ${list(cards.noPrice || [], 'В прайсе без цены («по запросу»)')}${list(cards.missing || [], 'Такого исполнения нет в прайсе')}${list(cards.unclear || [], 'Не понятна модель')}`;
  }
}
