import { CrmFunnel } from './crm-funnel.js';
import { esc, today } from '../../core/util.js';
import { CrmFmt } from '../../core/crm-fmt.js';

/**
 * «Что сделать сейчас» в карточке сделки: одно главное действие по состоянию сделки (взять в работу, заполнить нужное по
 * регламенту и перевести, подготовить КП, запланировать звонок, исполнение, дата) — крупной кнопкой, остальное — ссылками.
 */
export class DealNow {
  static NAMES_SHOWN = 3;

  /**
   * Блок или пусто (сделка закрыта).
   * @param {object} deal ответ /api/crm/deal
   * @returns {string}
   */
  static html(deal) {
    const step = this.step(deal);
    if (!step) return '';
    const buttons = step.actions
      .map(
        (action, index) =>
          `<button class="btn sm${index === 0 ? ' primary' : ' ghost'}" type="button" data-dknow="${action.act}">${esc(action.label)}</button>`,
      )
      .join('');
    const full = step.hint ? `${step.title} — ${step.hint}` : step.title;
    return `<section class="dk-now${step.tone ? ` ${step.tone}` : ''}" aria-label="Что сделать сейчас" title="${esc(full)}"><span class="dk-nk">${esc(step.kind || 'Сейчас')}</span><b class="dk-nb">${esc(step.title)}</b>${step.hint ? `<span class="muted dk-nh">${esc(step.hint)}</span>` : ''}<div class="dk-na">${buttons}</div></section>`;
  }

  /**
   * Главное действие по сделке: {title, hint, tone, actions: [{act, label}]} или null.
   * @param {object} deal
   * @returns {object|null}
   */
  static step(deal) {
    if (CrmFunnel.closed(deal)) return this._closing(deal);
    const next = this.nextStage(deal);
    const rules = [
      () => this._closing(deal),
      () => this._take(deal, next),
      () => this._gaps(deal),
      () => this._offer(deal),
      () => this._send(deal),
      () => this._exec(deal),
      () => this._task(deal),
      () => this._late(deal),
    ];
    for (const rule of rules) {
      const found = rule();
      if (found) return found;
    }
    return this._planned(deal, next);
  }

  /**
   * Следующая открытая стадия воронки или null.
   * @param {object} deal
   * @returns {{key: string, label: string}|null}
   */
  static nextStage(deal) {
    const open = CrmFunnel.columns(deal.funnel).filter(stage => !stage.closed);
    const index = open.findIndex(stage => stage.key === deal.stage);
    return index >= 0 && index + 1 < open.length ? open[index + 1] : null;
  }

  static _first(deal) {
    const open = CrmFunnel.columns(deal.funnel).filter(stage => !stage.closed);
    return open.length > 1 && open[0].key === deal.stage;
  }

  // новая заявка (из Битрикс24 или первая стадия по регламенту) — взять в работу
  static _take(deal, next) {
    if (!next || !(deal.bxNew || (deal.regsNext && this._first(deal)))) return null;
    return {
      kind: 'Новая',
      title: `Возьмите в работу: «${next.label}»`,
      hint: 'до конца дня; что заполнить — программа спросит',
      tone: 'warn',
      actions: [{ act: 'next', label: `Взять в работу` }],
    };
  }

  // по регламенту не хватает полей для следующей стадии
  static _gaps(deal) {
    const gaps = deal.regsNext;
    if (!gaps || !(gaps.names || []).length) return null;
    const rest = gaps.names.length - this.NAMES_SHOWN;
    return {
      kind: 'Регламент',
      title: `Для «${gaps.label}» не хватает: ${gaps.names.length}`,
      hint: `${gaps.names.slice(0, this.NAMES_SHOWN).join(', ')}${rest > 0 ? ` и ещё ${rest}` : ''}`,
      tone: '',
      actions: [
        { act: 'next', label: `Заполнить и перевести на «${gaps.label}»` },
        { act: 'fill', label: 'Только заполнить' },
      ],
    };
  }

  static _offer(deal) {
    if ((deal.kps || []).length) return null;
    return {
      kind: 'КП',
      title: 'Подготовьте КП',
      hint: 'клиент и контакт подставятся сами, сумма и поля — по КП',
      tone: '',
      actions: [
        { act: 'kp', label: '＋ Создать КП' },
        { act: 'link', label: 'Добавить готовое КП клиента' },
      ],
    };
  }

  /**
   * Последнее непроигранное КП сделки или null.
   * @param {object} deal
   * @returns {object|null}
   */
  static offer(deal) {
    return (deal.kps || []).find(row => row.status !== 'lost') || null;
  }

  // КП сохранено, но не отправлено: после отправки сделка сама перейдёт на «ТКП отправлено», звонок — через 3 дня
  static _send(deal) {
    const offer = this.offer(deal);
    if (!offer || offer.status !== 'new') return null;
    return {
      kind: 'КП',
      title: `КП № ${offer.number} готово — отправьте клиенту`,
      hint: 'после отправки — следующая стадия и звонок клиенту через 3 дня',
      tone: '',
      actions: [
        { act: 'send', label: '✉ Отправить письмом' },
        { act: 'sent', label: 'Уже отправил сам' },
      ],
    };
  }

  // поставка отмечена или сделка выиграна, а акта и УПД нет
  static _closing(deal) {
    if (!deal.closingDue) return null;
    return {
      kind: 'Документы',
      title: 'Прикрепите закрывающие документы',
      hint: 'акт или УПД — скан или PDF; уйдёт и в Битрикс24',
      tone: 'warn',
      actions: [{ act: 'docs', label: '📎 Прикрепить акт / УПД' }],
    };
  }

  static _exec(deal) {
    const exec = deal.exec || {};
    const point = exec.signed ? exec.next : null;
    if (!point || point.state !== 'overdue') return null;
    return {
      kind: 'Исполнение',
      title: point.label,
      hint: `план ${CrmFmt.day(point.plan)} — просрочено`,
      tone: 'bad',
      actions: [{ act: 'exec', label: 'Открыть исполнение' }],
    };
  }

  /**
   * Ближайшее открытое дело сделки или undefined.
   * @param {object} deal
   * @returns {object|undefined}
   */
  static openTask(deal) {
    return (deal.tasks || [])
      .filter(task => task.state === 'open')
      .sort((one, two) => `${one.due}${one.time || ''}`.localeCompare(`${two.due}${two.time || ''}`))[0];
  }

  static _task(deal) {
    if (this.openTask(deal)) return null;
    return {
      kind: 'Дело',
      title: 'Запланируйте следующий шаг',
      hint: 'звонок, встреча или письмо',
      tone: 'warn',
      actions: [{ act: 'task', label: '＋ Звонок или дело' }],
    };
  }

  static _late(deal) {
    if (!deal.expected || deal.expected >= today()) return null;
    return {
      kind: 'Срок',
      title: `Ожидаемая дата прошла (${CrmFmt.day(deal.expected)})`,
      hint: 'перенесите дату или закройте сделку',
      tone: 'warn',
      actions: [{ act: 'date', label: 'Изменить дату' }],
    };
  }

  // дело запланировано: главное — сделать его (звонок — с итогом), перевод стадии — рядом
  static _planned(deal, next) {
    const task = this.openTask(deal);
    const actions = [{ act: 'done', label: '✓ Сделано' }];
    if (next) actions.push({ act: 'next', label: `На «${next.label}»` });
    return {
      kind: 'Дело',
      title: task.title,
      hint: CrmFmt.rel(task.due) + (task.time ? `, ${task.time}` : ''),
      tone: task.due < today() ? 'bad' : '',
      actions,
    };
  }
}
