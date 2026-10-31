import { AdminFeedback } from './admin-feedback.js';
import { AdminSystem } from './admin-system.js';
import { ModerationView } from '../catalog/moderation.js';
import { Fmt } from '../../core/str.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';
import { AdminApi } from '../../core/admin-api.js';
import { AdminDialog } from '../../core/admin-dialog.js';

/**
 * «Главная» «Настроек» — входящие администратора: всё, что ждёт решения, и решение прямо в строке (правка товара —
 * принять или отклонить, сообщение — «Прочитано», копия — «Сделать сейчас», обновление — «Установить», фид — «Повторить»).
 */
export class AdminInbox {
  static LEVEL = { bad: 'Важно', warn: 'Внимание', info: 'К сведению' };
  static SHOWN = 8;
  static FEED_WAIT_MS = 1500;
  // действие строки: подпись кнопки и обработчик
  static ACTS = {
    backup: ['Сделать копию сейчас', '_backup'],
    update: ['Скачать и установить', '_update'],
    restart: ['Перезапустить', '_restart'],
    feed: ['Повторить', '_feed'],
  };

  /**
   * Нарисовать входящие в блок.
   * @param {HTMLElement} box
   */
  static async render(box) {
    let reply;
    try {
      reply = await AdminApi.get('attention');
    } catch {
      box.innerHTML = '';
      return;
    }
    const items = reply.items || [];
    if (!items.length) {
      box.innerHTML =
        '<div class="st-card at-card at-ok"><p class="sub" style="margin:0">✓ Всё в порядке — ничего не ждёт решения</p></div>';
      return;
    }
    box.innerHTML = `<div class="st-card at-card"><p class="sub">Ждёт решения · ${items.length}</p>${items.map(row => this._row(row)).join('')}</div>`;
    box.onclick = event => this._click(box, event);
    for (const row of items) {
      if (row.do === 'moderation') this._moderation(box);
      if (row.do === 'feedback') this._feedback(box);
    }
  }

  static _row(row) {
    const kind = String(row.do || '').split(':')[0];
    const act = this.ACTS[kind];
    const button = act
      ? `<button class="btn sm primary" type="button" data-inb="${esc(row.do)}">${esc(act[0])}</button>`
      : '';
    const open =
      row.tab && kind !== 'feedback'
        ? `<button class="btn sm ghost" type="button" data-sttab="${esc(row.tab)}">Открыть</button>`
        : '';
    const sub = ['moderation', 'feedback'].includes(kind) ? `<div class="inb-sub" data-inbsub="${kind}"></div>` : '';
    return `<div class="at-r at-${esc(row.level)}"><span class="at-l">${esc(this.LEVEL[row.level] || '')}</span><span class="at-t">${esc(row.text)}</span>${button}${open}${sub}</div>`;
  }

  // правки товаров сотрудников: принять или отклонить, не уходя с главной
  static async _moderation(box) {
    const place = box.querySelector('[data-inbsub="moderation"]');
    if (!place) return;
    let reply;
    try {
      reply = await AdminApi.get('moderation');
    } catch {
      return;
    }
    const rows = (reply.pending || []).slice(0, this.SHOWN);
    place.innerHTML = rows
      .map(
        edit => `<div class="inb-i"><div><b>${esc(edit.name)}</b><span class="muted">${esc(edit.kind === 'create' ? 'новый товар' : (edit.fields || []).join(', '))} · ${esc(edit.userName || '—')} · ${esc(Fmt.dateTime(edit.created))}${edit.stale ? ' · <span class="bad-t">товар изменили после отправки</span>' : ''}</span></div>
        <span class="inb-a">${edit.stale ? '' : `<button class="btn sm primary" type="button" data-inbok="${edit.id}">Принять</button><button class="btn sm" type="button" data-inbno="${edit.id}">Отклонить</button>`}<button class="btn sm ghost" type="button" data-inbview="${edit.id}">Посмотреть</button></span></div>`,
      )
      .join('');
  }

  // сообщения менеджеров о проблемах: прочитать прямо здесь
  static async _feedback(box) {
    const place = box.querySelector('[data-inbsub="feedback"]');
    if (!place) return;
    let reply;
    try {
      reply = await AdminApi.get('feedback');
    } catch {
      return;
    }
    const rows = (reply.items || []).filter(row => !row.done).slice(0, this.SHOWN);
    place.innerHTML = `${rows
      .map(
        row => `<div class="inb-i"><div><b>${esc(row.by || 'менеджер')}</b> <span>${esc(row.text)}</span><span class="muted">${esc([row.ctx?.dialog || row.ctx?.where, row.ctx?.version && `версия ${row.ctx.version}`].filter(Boolean).join(' · '))} · ${esc(
          String(row.at || '')
            .replace('T', ' ')
            .slice(0, 16),
        )}</span></div>
        <span class="inb-a"><button class="btn sm" type="button" data-inbread="${esc(row.id)}">Прочитано</button></span></div>`,
      )
      .join('')}<button class="btn sm ghost" type="button" data-inball>Все сообщения…</button>`;
  }

  static async _click(box, event) {
    const target = event.target;
    const handlers = [
      ['[data-inb]', button => this._act(box, button)],
      ['[data-inbok]', button => this._review(box, button.dataset.inbok, 'approve')],
      ['[data-inbno]', button => this._review(box, button.dataset.inbno, 'reject')],
      ['[data-inbview]', button => ModerationView.open(+button.dataset.inbview, () => this.render(box))],
      ['[data-inbread]', button => this._read(box, button)],
      ['[data-inball]', () => AdminFeedback.open(() => this.render(box))],
    ];
    for (const [selector, run] of handlers) {
      const button = target.closest(selector);
      if (button) {
        await run(button);
        return;
      }
    }
  }

  static async _act(box, button) {
    const [kind, arg] = button.dataset.inb.split(':');
    const [, method] = this.ACTS[kind] || [];
    if (!method) return;
    button.disabled = true;
    try {
      await this[method](box, arg);
    } catch (error) {
      Toast.show(error.message || String(error));
    }
    button.disabled = false;
  }

  static async _backup(box) {
    Toast.show('Делаю копию базы…');
    const reply = await AdminApi.post('maint/backup');
    const ok = reply && reply.backup ? reply.backup.ok !== false : true;
    Toast.show(ok ? 'Копия базы сохранена' : 'Копия не сохранилась — подробности в «Обслуживание → Копии и база»');
    this.render(box);
  }

  static async _update() {
    const text =
      'Программа скачает архив обновления с GitHub, сохранит копию базы и установит обновление. Затем — перезапуск (сотрудникам — пара секунд ожидания).';
    if (!(await AdminDialog.confirm('Установить новую версию?', text, 'Установить'))) return;
    Toast.show('Скачиваю и устанавливаю…');
    const reply = await AdminApi.post('update/download');
    AdminSystem.restart(`Устанавливается версия ${reply.version || ''}`);
  }

  static _restart() {
    return AdminSystem.restart();
  }

  static async _feed(box, fid) {
    await AdminApi.post(`feeds/${encodeURIComponent(fid)}/check`);
    Toast.show('Фид проверяется заново — результат появится здесь и во вкладке фида');
    setTimeout(() => this.render(box), this.FEED_WAIT_MS);
  }

  static async _review(box, id, verdict) {
    try {
      await AdminApi.post(`pending/${encodeURIComponent(id)}/${verdict}`, {});
    } catch (error) {
      Toast.show(error.message || String(error));
      return;
    }
    Toast.show(verdict === 'approve' ? 'Правка принята' : 'Правка отклонена');
    this.render(box);
  }

  static async _read(box, button) {
    try {
      await AdminApi.post(`feedback/${encodeURIComponent(button.dataset.inbread)}/done`);
    } catch (error) {
      Toast.show(error.message || String(error));
      return;
    }
    this.render(box);
  }
}

/** «Готовность программы» над входящими: полоска «N из 9» и что ещё не настроено — с «Настроить». Всё готово — свёрнута. */
export class AdminReadiness {
  /**
   * HTML полоски (пусто, если сервер не ответил).
   * @returns {Promise<string>}
   */
  static async html() {
    let reply;
    try {
      reply = await AdminApi.get('readiness');
    } catch {
      return '';
    }
    const items = reply.items || [];
    const done = items.filter(row => row.ok).length;
    const left = items.filter(row => !row.ok);
    const bar = `<div class="rd-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${items.length}" aria-valuenow="${done}"><i style="width:${items.length ? Math.round((done / items.length) * 100) : 0}%"></i></div>`;
    const rows = items
      .map(
        row =>
          `<li class="${row.ok ? 'rd-ok' : ''}"><span>${row.ok ? '✓' : '○'} ${esc(row.label)}</span>${row.ok ? '' : `<button class="btn sm" type="button" data-sttab="${esc(row.tab)}">Настроить</button>`}</li>`,
      )
      .join('');
    return `<details class="st-card rd"${left.length && !document.documentElement.classList.contains('mob') ? ' open' : ''}><summary class="sub">Готовность программы · ${done} из ${items.length}${left.length ? '' : ' — всё настроено'}</summary>${bar}<ul class="rd-l">${rows}</ul></details>`;
  }
}
