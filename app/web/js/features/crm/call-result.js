import { CrmTask } from './crm-task.js';
import { DealCard } from './deal-card.js';
import { DealNeed } from './deal-need.js';
import { DealNow } from './deal-now.js';
import { LostPick } from './lost-pick.js';
import { Modal } from '../../core/modal.js';
import { Api } from '../../core/net.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';
import { CrmFmt, DateChips } from '../../core/crm-fmt.js';

/**
 * Итог звонка по сделке (галочка у звонка): «Договорились» — следующий шаг и стадия дальше, «Думает» и «Не дозвонился» —
 * новый звонок, «Отказ» — проигрыш с причиной. Коротко о разговоре — в ленту сделки. Закрыли окно — звонок просто сделан.
 */
export class CallResult {
  static OUTCOMES = {
    agreed: { label: '✓ Договорились', said: 'договорились', days: 1 },
    think: { label: 'Думает — перезвонить', said: 'клиент думает', days: 3 },
    missed: { label: 'Не дозвонился', said: 'не дозвонился', days: 1 },
    refuse: { label: '✕ Отказ', said: 'отказ', days: 0 },
  };
  static CHIPS = [
    ['Завтра', () => CrmFmt.after(1)],
    ['Через 3 дня', () => CrmFmt.after(CallResult.OUTCOMES.think.days)],
    ['Через неделю', () => CrmFmt.after(CrmFmt.WEEK)],
    ['Через 2 недели', () => CrmFmt.after(CrmFmt.WEEK * 2)],
  ];
  static HEAD = { 'Content-Type': 'application/json; charset=utf-8' };

  /**
   * Спросить итог звонка и отметить звонок сделанным.
   * @param {number} taskId
   * @param {string} dealId
   * @param {Function} [after] после всех изменений (перерисовать список)
   */
  static ask(taskId, dealId, after) {
    Modal.once('call-result', async () => {
      const deal = await DealCard.fetch(dealId);
      const task = deal && (deal.tasks || []).find(row => row.id === taskId);
      if (!task) {
        CrmTask.put(taskId, { state: 'done' }, after);
        return;
      }
      this._open(deal, task, after);
    });
  }

  static _open(deal, task, after) {
    const modal = new Modal(this._html(deal, task), 'tk-dlg cr-dlg');
    const form = modal.$('form');
    let saved = false;
    modal.d.addEventListener('click', event => {
      if (DateChips.click(event)) return;
      const outcome = event.target.closest('[data-cro]');
      if (outcome) this._pick(modal, outcome.dataset.cro);
      else if (event.target.closest('[data-tqk]')) CrmTask.pickKind(event.target.closest('[data-tqk]'));
      else if (event.target.closest('[data-x]')) modal.close();
    });
    form.onsubmit = event => {
      event.preventDefault();
      if (saved) return;
      const answer = this._answer(form);
      if (!answer) return;
      saved = true;
      modal.close();
      this._save(deal, task, answer)
        .then(() => after && after())
        .catch(error => Toast.show(`Итог звонка не сохранён: ${error.message || error}`));
    };
    modal.d.addEventListener('close', () => {
      if (!saved) CrmTask.put(task.id, { state: 'done' }, after);
    });
  }

  static _html(deal, task) {
    const outcomes = Object.entries(this.OUTCOMES)
      .map(
        ([key, row]) =>
          `<button type="button" role="radio" aria-checked="false" class="chip" data-cro="${key}">${esc(row.label)}</button>`,
      )
      .join('');
    return `<div class="dlg-h"><h3>Итог звонка</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted cr-who">${esc(task.title)} · ${esc(deal.title || deal.client || '')}</p>
      <div class="cr-o" role="radiogroup" aria-label="Итог">${outcomes}</div>
      <form class="tk-ed cr-f" data-outcome="">
        <div class="cr-p" data-crp="agreed" hidden>
          <label class="f"><span>Следующий шаг</span><input type="text" name="title" maxlength="200" placeholder="Например: подготовить договор"></label>
          ${CrmTask.kinds('task')}${this._move(deal)}
        </div>
        <div class="cr-p" data-crp="date" hidden>${DateChips.html(this.CHIPS, 'due', '')}
          <div class="row tk-dt"><label class="f"><span>День</span><input type="date" name="due"></label><label class="f"><span>Время</span><input type="time" name="time"></label></div>
        </div>
        <p class="cr-p muted" data-crp="refuse" hidden>Дальше — причина отказа, сделка закроется как проигранная.</p>
        <label class="f"><span>Коротко о разговоре</span><textarea name="note" rows="2" maxlength="1000" placeholder="Уйдёт в ленту сделки"></textarea></label>
        <div class="row"><button class="btn primary" type="submit">Сохранить</button><span class="sp"></span><button class="btn" type="button" data-x>Просто отметить</button></div>
      </form>`;
  }

  // «Договорились» — перевести сделку на следующую стадию (галочка включена)
  static _move(deal) {
    const next = DealNow.nextStage(deal);
    return next
      ? `<label class="ck"><input type="checkbox" name="move" value="${esc(next.key)}" checked> Перевести на «${esc(next.label)}»</label>`
      : '';
  }

  // выбран итог: показать его поля, день — по умолчанию для итога
  static _pick(modal, key) {
    const form = modal.$('form');
    form.dataset.outcome = key;
    modal.d.querySelectorAll('[data-cro]').forEach(one => {
      const active = one.dataset.cro === key;
      one.classList.toggle('on', active);
      one.setAttribute('aria-checked', String(active));
    });
    const shown = { agreed: key === 'agreed', date: key !== 'refuse', refuse: key === 'refuse' };
    form.querySelectorAll('[data-crp]').forEach(part => {
      part.hidden = !shown[part.dataset.crp];
    });
    const day = CrmFmt.after(this.OUTCOMES[key].days);
    form.elements.due.value = day;
    form.querySelectorAll('[data-dchip]').forEach(chip => chip.classList.toggle('on', chip.dataset.day === day));
  }

  static _answer(form) {
    const key = form.dataset.outcome;
    if (!key) {
      Toast.show('Выберите итог звонка');
      return null;
    }
    const fields = form.elements;
    if (key !== 'refuse' && !fields.due.value) {
      Toast.show('Укажите день');
      return null;
    }
    return {
      key,
      title: fields.title.value.trim(),
      kind: form.querySelector('[data-tqk].on')?.dataset.tqk || 'task',
      move: fields.move && fields.move.checked ? fields.move.value : '',
      due: fields.due.value,
      time: fields.time.value,
      note: fields.note.value.trim(),
    };
  }

  static async _save(deal, task, answer) {
    const outcome = this.OUTCOMES[answer.key];
    const said = `Итог: ${outcome.said}${answer.note ? ` — ${answer.note}` : ''}`;
    await CrmTask.put(task.id, { state: 'done', note: [task.note, said].filter(Boolean).join('\n') });
    if (answer.note) await this._comment(deal, `Звонок «${task.title}» — ${outcome.said}: ${answer.note}`);
    const steps = {
      agreed: () => this._agreed(deal, answer),
      think: () => this._call(deal, 'Перезвонить: клиент думает', answer),
      missed: () => this._call(deal, task.title, answer),
      refuse: () => this._refuse(deal),
    };
    await steps[answer.key]();
  }

  static async _agreed(deal, answer) {
    if (answer.title)
      await this._task(deal, { kind: answer.kind, title: answer.title, due: answer.due, time: answer.time });
    if (!answer.move) return;
    const fresh = await DealCard.fetch(deal.id);
    if (fresh) await DealNeed.move(fresh, { stage: answer.move });
  }

  static _call(deal, title, answer) {
    return this._task(deal, { kind: 'call', title, due: answer.due, time: answer.time });
  }

  static async _refuse(deal) {
    const fresh = await DealCard.fetch(deal.id);
    const body = fresh && (await LostPick.ask(fresh));
    if (body) await DealNeed.move(fresh, body);
  }

  static _task(deal, body) {
    const owner = deal.managerId ? { managerId: deal.managerId } : {};
    return CrmTask.create({ ...body, deal: deal.id, ...owner });
  }

  static async _comment(deal, text) {
    try {
      await Api.request(`/api/crm/deal/${encodeURIComponent(deal.id)}/comment`, {
        method: 'POST',
        headers: this.HEAD,
        body: JSON.stringify({ text }),
      });
    } catch (error) {
      Toast.show(`Комментарий не сохранён: ${error.message}`);
    }
  }
}
