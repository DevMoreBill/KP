import { CrmFmt } from './crm-fmt.js';
import { CrmFunnel } from './crm-funnel.js';
import { esc, today } from '../../core/util.js';

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
          `<button class="btn${index === 0 ? ' primary' : ' ghost'}" type="button" data-dknow="${action.act}">${esc(action.label)}</button>`,
      )
      .join('');
    return `<section class="dk-now${step.tone ? ` ${step.tone}` : ''}" aria-label="Что сделать сейчас"><div class="dk-nt"><span class="dk-nk">Что сделать сейчас</span><b>${esc(step.title)}</b>${step.hint ? `<span class="muted">${esc(step.hint)}</span>` : ''}</div><div class="dk-na">${buttons}</div></section>`;
  }

  /**
   * Главное действие по сделке: {title, hint, tone, actions: [{act, label}]} или null.
   * @param {object} deal
   * @returns {object|null}
   */
  static step(deal) {
    if (CrmFunnel.closed(deal)) return null;
    const next = this.nextStage(deal);
    const rules = [
      () => this._take(deal, next),
      () => this._gaps(deal),
      () => this._offer(deal),
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
      title: `Новая заявка — возьмите в работу: «${next.label}»`,
      hint: 'по регламенту — до конца дня; что нужно заполнить, программа спросит сама',
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
      title: 'Подготовьте КП',
      hint: 'клиент, контакт и сделка подставятся сами; сумма и поля Битрикс24 заполнятся по КП',
      tone: '',
      actions: [
        { act: 'kp', label: '＋ Создать КП' },
        { act: 'link', label: 'Добавить готовое КП клиента' },
      ],
    };
  }

  static _exec(deal) {
    const exec = deal.exec || {};
    const point = exec.signed ? exec.next : null;
    if (!point || point.state !== 'overdue') return null;
    return {
      title: `Исполнение: ${point.label}`,
      hint: `план ${CrmFmt.day(point.plan)} — просрочено`,
      tone: 'bad',
      actions: [{ act: 'exec', label: 'Открыть исполнение' }],
    };
  }

  static _openTask(deal) {
    return (deal.tasks || [])
      .filter(task => task.state === 'open')
      .sort((one, two) => `${one.due}${one.time || ''}`.localeCompare(`${two.due}${two.time || ''}`))[0];
  }

  static _task(deal) {
    if (this._openTask(deal)) return null;
    return {
      title: 'Запланируйте следующий шаг',
      hint: 'звонок, встреча или письмо — чтобы сделка не потерялась',
      tone: 'warn',
      actions: [{ act: 'task', label: '＋ Звонок или дело' }],
    };
  }

  static _late(deal) {
    if (!deal.expected || deal.expected >= today()) return null;
    return {
      title: `Ожидаемая дата прошла (${CrmFmt.day(deal.expected)})`,
      hint: 'перенесите дату или закройте сделку',
      tone: 'warn',
      actions: [{ act: 'date', label: 'Изменить дату' }],
    };
  }

  static _planned(deal, next) {
    const task = this._openTask(deal);
    const actions = next ? [{ act: 'next', label: `Перевести на «${next.label}»` }] : [];
    return {
      title: `Следующий шаг: ${task.title}`,
      hint: CrmFmt.rel(task.due) + (task.time ? `, ${task.time}` : ''),
      tone: task.due < today() ? 'bad' : '',
      actions,
    };
  }
}
