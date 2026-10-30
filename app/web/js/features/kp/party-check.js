import { SafeLink } from '../../core/safe-link.js';
import { ClientStore, Inn } from './client-store.js';
import { Toast } from '../../core/toast.js';
import { DefRegistry } from '../../core/defaults.js';
import { Money } from '../../core/money.js';
import { KpState, S } from '../../core/state.js';
import { FEAT } from '../../core/features.js';
import { $, esc } from '../../core/util.js';
import { Api } from '../../core/net.js';
import { UiKit } from '../../core/ui-kit.js';
import { KpForm } from '../../core/kp-form.js';

/**
 * Проверка контрагента: Checko — основной сервис, OFData — резерв (тот же формат данных), бухотчётность — бесплатно из
 * ГИР БО ФНС, Rusprofile — кнопкой (открытого API у него нет). Лимиты — на весь отдел, по московскому дню.
 */
export class PartyCheck {
  /** последний известный остаток: Checko + reserve (OFData), если задан его ключ */
  static quota = null;
  static TIP =
    '<p>Проверка по данным Checko: регистрация, долги, суды, исполнительные производства, бухотчётность. Видна только вам, в КП не попадает.</p>' +
    '<p>Бесплатно у Checko — 100 запросов в день на всех, полная проверка — 3 запроса: бухотчётность берётся бесплатно из ГИР БО ФНС. Резерв — OFData (свои 100 запросов в день, ключ — в «Настройки → Ключи API»): если у Checko кончился лимит или он не ответил, проверка идёт через OFData.</p>' +
    '<p>Если запросов не хватает нигде, программа делает краткую проверку (1 запрос) или бесплатную по ФНС и сама выполняет полную на следующий день. Проверка хранится 7 дней и общая для отдела — повторная проверка того же ИНН запросы не тратит. Rusprofile открывается кнопкой: у него нет API, карточка — в браузере.</p>';
  static SCORE = {
    ok: 'Существенных рисков не найдено',
    warn: 'Есть на что обратить внимание',
    bad: 'Высокий риск',
  };
  static DAY_MS = 864e5;
  static AUTO_DELAY = 50;
  static NOT_CHECKED = 'не проверено';

  /**
   * Остаток запросов на сегодня.
   * @returns {Promise<object|null>}
   */
  static async load() {
    try {
      this.quota = await Api.request('/api/check/quota');
    } catch {
      this.quota = null;
    }
    return this.quota;
  }

  /**
   * Поиск организации на Rusprofile.
   * @param {string} inn
   * @returns {string}
   */
  static rusprofile(inn) {
    return `https://www.rusprofile.ru/search?query=${encodeURIComponent(inn)}`;
  }

  // сервисы с ключом: [Checko, OFData]
  static _apis(quota) {
    const known = quota || this.quota;
    return known ? [known.key ? known : null, known.reserve || null].filter(Boolean) : [];
  }

  /**
   * Сколько проверок осталось сегодня — строкой.
   * @param {object} [quota]
   * @returns {string}
   */
  static quotaText(quota) {
    const list = this._apis(quota);
    if (!list.length) return '';
    const full = list.reduce((total, row) => total + (row.checks || 0), 0);
    const left = list.reduce((total, row) => total + (row.left || 0), 0);
    const src = list.map(row => row.name || 'Checko').join(' + ');
    if (full > 0) {
      return `сегодня осталось ${full} ${KPGen.plural(full, 'полная проверка', 'полные проверки', 'полных проверок')} (${src})`;
    }
    if (left > 0)
      return `сегодня осталось ${left} ${KPGen.plural(left, 'запрос', 'запроса', 'запросов')} (${src}) — будет краткая проверка`;
    return `лимит ${src} на сегодня исчерпан — будет бесплатная проверка по ФНС, полная — завтра автоматически`;
  }

  // остаток под кнопками: «Checko сегодня: осталось 40 из 100 · OFData: 100 из 100 · в очереди: 2»
  static _left(quota) {
    const list = this._apis(quota);
    if (!list.length) return '';
    return (
      list
        .map(
          row =>
            `${esc(row.name || 'Checko')} сегодня: ${row.left ? `осталось ${row.left} из ${row.limit}` : 'лимит исчерпан, обновится в 00:00 по Москве'}`,
        )
        .join(' · ') + (quota.queue ? ` · в очереди: ${quota.queue}` : '')
    );
  }

  /**
   * Строка проверки в разделе «Клиент».
   * @returns {string}
   */
  static line() {
    if (!FEAT.on('check')) return '';
    const check = S.check;
    const inn = Inn.digits(S.clientInn);
    if (!Inn.valid(inn)) return '';
    const rusprofile = `<a class="btn ghost" href="${SafeLink.href((check && check.rusprofile) || this.rusprofile(inn))}" target="_blank" rel="noopener" title="Открыть карточку организации в Rusprofile (в браузере)">Rusprofile</a>`;
    if (!check) return this._ask();
    if (check.error) return this._error(check, rusprofile);
    this._autoQueued(check, inn);
    return this._details(check, inn, rusprofile);
  }

  static _ask() {
    if (!this.quota) {
      this.load().then(quota => {
        const box = $('#chkQ');
        if (box) box.textContent = this.quotaText(quota);
      });
    }
    return `<div class="chk-line"><button class="btn ghost" type="button" data-a="checkRun">Проверить контрагента</button><span class="muted" id="chkQ">${esc(this.quotaText())}</span>${UiKit.tip(this.TIP)}</div>`;
  }

  static _error(check, rusprofile) {
    const nokey = check.error === 'nokey';
    return `<div class="chk-line warn"><span>${nokey ? 'Проверка Checko: не задан API-ключ.' : esc(check.message || check.error)}</span>${nokey ? '<button class="btn ghost" type="button" data-a="integrations">Ключ — в «Настройках»</button>' : '<button class="btn ghost" type="button" data-a="checkRun">Повторить</button>'}${rusprofile}</div>`;
  }

  // полная проверка стояла в очереди и могла уже выполниться (после 00:00 по Москве) — подтянуть её один раз
  static _autoQueued(check, inn) {
    if (!check.queued || !check.checkedAt || S._chkAuto === inn) return;
    if (new Date(check.checkedAt).toDateString() === new Date().toDateString()) return;
    S._chkAuto = inn;
    setTimeout(() => this.run(), this.AUTO_DELAY);
  }

  static _source(check) {
    const name = String(check.source || 'Checko').replace(/^OFData$/, 'OFData (резерв Checko)');
    if (check.free) return `Бесплатная проверка (${check.source})`;
    return check.partial ? `${name}, краткая проверка` : name;
  }

  static _count(block, text) {
    if (!block || block.count == null) return this.NOT_CHECKED;
    return block.count ? text(block) : 'нет';
  }

  static _facts(check) {
    const registered = check.regDate
      ? KPGen.ruDate(check.regDate.slice(0, 10)) +
        (check.ageYears != null ? ` (${String(check.ageYears).replace('.', ',')} г.)` : '')
      : '';
    let tax = check.taxDebt ? Money.rub(check.taxDebt) : 'нет';
    if (check.free) tax = this.NOT_CHECKED;
    return [
      ['Регистрация', registered],
      ['Уставный капитал', check.capital != null ? Money.rub(check.capital) : ''],
      ['Сотрудников', check.employees != null ? String(check.employees) : ''],
      ['Категория МСП', check.msp],
      ['Основной ОКВЭД', check.okved],
      ['Налоговая недоимка', tax],
      ['Арбитраж (ответчик)', this._count(check.courts, courts => `${courts.count} дел на ${Money.rub(courts.sum)}`)],
      [
        'Исполнительные производства',
        this._count(check.fssp, fssp => `${fssp.count}${fssp.sum ? ` на ${Money.rub(fssp.sum)}` : ''}`),
      ],
    ].filter(fact => fact[1]);
  }

  static _finances(check) {
    if (!(check.finances || []).length) return '';
    const rows = check.finances
      .map(
        row =>
          `<tr><td>${esc(row.year)}</td><td>${Money.rub(row.revenue)}</td><td class="${row.profit < 0 ? 'bad-t' : ''}">${Money.rub(row.profit)}</td></tr>`,
      )
      .join('');
    const source = check.finSource
      ? `<p class="muted chk-fin">Бухотчётность: ${check.finUrl ? `<a href="${SafeLink.href(check.finUrl)}" target="_blank" rel="noopener">${esc(check.finSource)}</a>` : esc(check.finSource)}</p>`
      : '';
    return `<table class="fin"><tr><th>Год</th><th>Выручка</th><th>Чистая прибыль</th></tr>${rows}</table>${source}`;
  }

  static _summary(check) {
    const age = check.checkedAt ? (Date.now() - new Date(check.checkedAt)) / this.DAY_MS : 0;
    const old = age > DefRegistry.num('kp.checkDays', 30); // проверка устарела — предложить обновить
    return `<summary><b>${esc(this._source(check))}: ${esc(this.SCORE[check.score] || '')}</b> <span class="muted">· ${esc(KPGen.ruDate((check.checkedAt || '').slice(0, 10)))} · подробнее</span>${check.queued ? ' <span class="chk-old" title="Выполнится автоматически, когда обновится лимит (после 00:00 по Москве)">полная — в очереди</span>' : ''}${old ? ` <span class="chk-old" title="Данные могли измениться">проверке ${Math.floor(age)} дн. — обновите</span>` : ''}</summary>`;
  }

  static _details(check, inn, rusprofile) {
    const quota = check.quotaNow;
    const links = (check.links || []).length
      ? `<p class="chk-links"><span class="muted">Проверить вручную (бесплатно):</span> ${check.links.map(link => `<a href="${SafeLink.href(link.url)}" target="_blank" rel="noopener">${esc(link.name)}</a>`).join(' · ')}</p>`
      : '';
    return `<details class="chk ${esc(check.score)}">${this._summary(check)}
      ${check.note ? `<p class="chk-note">${esc(check.note)}</p>` : ''}
      <ul class="flags">${(check.flags || []).map(flag => `<li class="${esc(flag.level)}">${esc(flag.text)}</li>`).join('')}</ul>
      ${(check.missing || []).length ? `<p class="muted chk-miss">Не проверено: ${esc(check.missing.join(', '))}.</p>` : ''}
      ${check.finNote ? `<p class="muted chk-miss">${esc(check.finNote)}</p>` : ''}
      <dl class="facts">${this._facts(check)
        .map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`)
        .join('')}</dl>
      ${this._finances(check)}
      ${links}
      <div class="row" style="margin-top:10px"><button class="btn ghost" type="button" data-a="checkRun" data-force="1">Обновить проверку</button><a class="btn ghost" href="${SafeLink.href(check.url || `https://checko.ru/search?query=${inn}`)}" target="_blank" rel="noopener">Открыть на checko.ru</a>${rusprofile}${quota ? `<span class="muted">${this._left(quota)}</span>` : ''}</div></details>`;
  }

  /** Проверить контрагента (свежая проверка из хранилища отдела не тратит запросы). */
  static run() {
    return this._run('');
  }

  /** Обновить проверку принудительно. */
  static refresh() {
    return this._run('&force=1');
  }

  static async _run(force) {
    const inn = Inn.digits(S.clientInn);
    if (!Inn.valid(inn)) {
      Toast.show('Укажите корректный ИНН');
      return;
    }
    const button = document.querySelector('[data-a="checkRun"]');
    if (button) {
      button.disabled = true;
      button.textContent = 'Проверяю…';
    }
    const state = S;
    let answer;
    try {
      answer = await Api.request(`/api/check?inn=${inn}${force}`);
    } catch (error) {
      answer = {
        error: 'net',
        message: `Ошибка запроса: ${error.message}`,
        url: `https://checko.ru/search?query=${inn}`,
        rusprofile: this.rusprofile(inn),
      };
    }
    if (answer && answer.quotaNow) this.quota = answer.quotaNow;
    if (S !== state || Inn.digits(S.clientInn) !== inn) {
      Toast.show(`Проверка ИНН ${inn} готова, но клиент уже другой — запустите проверку снова`);
      KpForm.render();
      return;
    }
    S.check = answer;
    KpForm.render();
    KpState.persist();
    if (!S.check.error && S.client) ClientStore.save();
  }
}
