import { Api } from '../../core/net.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';
import { UiKit } from '../../ui/ui-kit.js';

/**
 * «Настройки → Связи → 1С»: адрес публикации базы (OData), логин и пароль (только в базе программы), проверка связи,
 * «Загрузить оплаты сейчас» и автозагрузка раз в 6 часов. Совпавшее поступление отмечает оплату клиента в сделке.
 */
export class OneCPanel {
  static conf = null;
  static result = null;

  /**
   * Вкладка.
   * @param {HTMLElement} main
   */
  static async render(main) {
    main.innerHTML = '<p class="muted">Загружаю…</p>';
    try {
      this.conf = await Api.request('/api/onec');
    } catch (error) {
      main.innerHTML = `<p class="msg err">${esc(error.message || error)}</p>`;
      return;
    }
    this._draw(main);
    main.onclick = event => this._click(main, event.target);
  }

  static _draw(main) {
    const conf = this.conf;
    const last = conf.last
      ? `<p class="muted">Последняя загрузка: ${esc(conf.last.at)} · поступлений ${conf.last.checked}, отмечено оплат ${conf.last.matched}</p>`
      : '';
    main.innerHTML = `<div class="st-card"><p class="sub">1С: оплаты клиентов${UiKit.tip('<p>Программа читает из 1С поступления на расчётный счёт (стандартный интерфейс OData публикации базы) и отмечает в исполнении сделки «оплата получена». Совпадение — по ИНН плательщика (= ИНН клиента сделки) и номеру КП / счёта в назначении платежа, иначе по сумме оплаты (до 0,5 %).</p><p>В 1С: «Администрирование → Настройки синхронизации → Публикация на веб-сервере», включить «Публиковать стандартный интерфейс OData» и разрешить чтение документов «Поступление на расчётный счёт» и справочника «Контрагенты» пользователю для программы.</p><p>Адрес, логин и пароль хранятся только в базе программы.</p>')}</p>
      <div class="od-grid"><label class="f"><span>Адрес публикации</span><input type="text" data-oc="url" value="${esc(conf.url)}" placeholder="http://server/base" autocomplete="off"></label>
      <label class="f"><span>Логин</span><input type="text" data-oc="login" value="${esc(conf.login)}" autocomplete="off"></label>
      <label class="f"><span>Пароль</span><input type="password" data-oc="password" value="${esc(conf.password)}" autocomplete="new-password"></label>
      <label class="f"><span>Глубина загрузки, дней</span><input type="text" inputmode="numeric" data-oc="days" value="${conf.days}"></label></div>
      <div class="row"><label class="sw"><input type="checkbox" data-oc="on"${conf.on ? ' checked' : ''}><span>Связь включена</span></label>
      <label class="sw"><input type="checkbox" data-oc="auto"${conf.auto ? ' checked' : ''}><span>Загружать оплаты сами раз в 6 часов</span></label></div>
      <div class="row"><button class="btn primary" type="button" data-ocb="save">Сохранить</button><button class="btn" type="button" data-ocb="check">Проверить связь</button><button class="btn" type="button" data-ocb="sync">Загрузить оплаты сейчас</button></div>
      ${last}<div id="ocOut">${this._result()}</div></div>`;
  }

  static _result() {
    const res = this.result;
    if (!res) return '';
    const row = pay =>
      `<li>${esc(pay.date)} · № ${esc(pay.number)} · ${esc(pay.sum)} ₽ · ИНН ${esc(pay.inn || '—')}${pay.title ? ` → <b>${esc(pay.title)}</b>: ${esc(pay.step)}` : ''}</li>`;
    const matched = (res.matched || []).map(row).join('');
    const unmatched = (res.unmatched || []).map(row).join('');
    return `<p>Поступлений: ${res.checked}, отмечено оплат: ${(res.matched || []).length}</p>${matched ? `<ul>${matched}</ul>` : ''}${unmatched ? `<details><summary>Не нашли сделку (${(res.unmatched || []).length})</summary><ul>${unmatched}</ul></details>` : ''}`;
  }

  static _form(main) {
    const value = key => main.querySelector(`[data-oc="${key}"]`);
    return {
      url: value('url').value.trim(),
      login: value('login').value.trim(),
      password: value('password').value,
      days: parseInt(value('days').value, 10) || 0,
      on: value('on').checked,
      auto: value('auto').checked,
    };
  }

  static async _click(main, target) {
    const button = target.closest('[data-ocb]');
    if (!button) return;
    const act = button.dataset.ocb;
    button.disabled = true;
    try {
      if (act === 'save') await this._save(main);
      else await this._call(main, act);
    } catch (error) {
      Toast.show(error.message || String(error));
    }
    button.disabled = false;
  }

  static async _save(main) {
    this.conf = await Api.request('/api/onec', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(this._form(main)),
    });
    this._draw(main);
    Toast.show('Подключение к 1С сохранено');
  }

  static async _call(main, act) {
    const answer = await Api.request(`/api/onec/${act}`, { method: 'POST' });
    if (!answer.ok) {
      Toast.show(answer.message || 'Не получилось');
      return;
    }
    if (act === 'check') {
      Toast.show(answer.message);
      return;
    }
    this.result = answer;
    this.conf = await Api.request('/api/onec');
    this._draw(main);
  }
}
