import { AlertsCard } from './settings-panels.js';
import { AiDirect } from '../catalog/ai-chat.js';
import { TypesEditor } from '../catalog/types-editor.js';
import { Fmt } from '../../core/str.js';
import { EquipTypes } from '../../core/equip-types.js';
import { Attrs } from '../../core/item-attrs.js';
import { Catalog } from '../catalog/catalog-store.js';
import { Api } from '../../core/net.js';
import { Toast } from '../../core/toast.js';
import { TemplateDesigner } from '../doc/template-designer.js';
import { TemplateEditor } from '../doc/template-editor.js';
import { $, esc } from '../../core/util.js';
import { Templates } from '../doc/templates.js';
import { AdminApi } from '../../core/admin-api.js';
import { AdminDialog } from '../../core/admin-dialog.js';

/** Шаблоны КП: графический редактор, настройки, новый шаблон для компании, папка шаблонов. */
export class TemplatesTab {
  /**
   * Вкладка.
   * @param {HTMLElement} main
   */
  static render(main) {
    main.innerHTML = `<div class="st-card"><p class="sub">Шаблоны · ${Templates.list.length}</p>${Templates.list.map(row => this._row(row)).join('')}
      <div class="row" style="margin-top:10px"><button class="btn" type="button" data-tnew>+ Новый шаблон для компании…</button><button class="btn ghost" type="button" data-tfold>Папка шаблонов</button></div></div>`;
    main.onclick = event => this._click(event);
  }

  static _row(template) {
    const designer = template.error
      ? ''
      : `<button class="btn primary" type="button" data-tdes="${esc(template.id)}" title="Документ как в Word: щёлкните текст или картинку и меняйте шрифт, цвет, размеры, порядок разделов">Графический редактор</button>`;
    return `<div class="st-row"><div><b>${esc(template.name)}</b><span class="muted">${esc(template.description || template.id)}${template.error ? ` · <span class="bad-t">${esc(template.error)}</span>` : ''}</span></div>
      <div class="acts">${designer}<button class="btn" type="button" data-tpl="${esc(template.id)}">Настроить</button></div></div>`;
  }

  static _click(event) {
    const setup = event.target.closest('[data-tpl]');
    if (setup) {
      TemplateEditor.open(setup.dataset.tpl);
      return;
    }
    const design = event.target.closest('[data-tdes]');
    if (design) {
      TemplateDesigner.open(design.dataset.tdes);
      return;
    }
    if (event.target.closest('[data-tnew]')) {
      TemplateDesigner.newCompany().catch(error => Toast.show(`Не получилось: ${error.message || error}`));
      return;
    }
    if (event.target.closest('[data-tfold]')) this._folder();
  }

  static _folder() {
    Api.request('/api/templates/folder', { method: 'POST' })
      .then(reply => {
        if (reply && reply.remote) Toast.show('Шаблоны лежат на компьютере-сервере, в папке программы «templates»');
      })
      .catch(error => Toast.show(error.message));
  }
}

/** Категории оборудования (редактор — types-editor.js): сколько товаров в каждой, открыть редактор. */
export class TypesTab {
  /**
   * Вкладка.
   * @param {HTMLElement} main
   */
  static render(main) {
    const counts = {};
    for (const card of Catalog.cache) {
      const cat = Attrs.of(card).cat || '';
      counts[cat] = (counts[cat] || 0) + 1;
    }
    const units = EquipTypes.list.filter(type => !type.station);
    const stations = EquipTypes.list.filter(type => type.station);
    const row = type =>
      `<tr><td>${esc(type.name)}</td><td class="muted">${type.fields.length} ${KPGen.plural(type.fields.length, 'параметр', 'параметра', 'параметров')}</td><td>${Fmt.num(counts[type.id] || 0)}</td></tr>`;
    main.innerHTML = `<div class="st-card"><div class="row"><p class="sub" style="margin:0">Категории · ${units.length}${stations.length ? ` и станций · ${stations.length}` : ''}</p><span class="sp"></span><button class="btn primary" type="button" data-types>Открыть редактор категорий</button></div>
      <p class="muted">Параметры, фильтры, группы характеристик и шаблон таблицы. Удалить свою категорию или вернуть стандартные можно только отсюда (при входе в «Настройки»).</p>
      <table class="pv-t st-tt"><tr><th>Категория</th><th>Параметры</th><th>Товаров</th></tr>${[...units, ...stations].map(row).join('')}</table></div>`;
    main.onclick = event => {
      if (event.target.closest('[data-types]')) TypesEditor.open();
    };
  }
}

/** Почта: менеджеры отправляют КП клиентам из программы (сервер — app/kp_track.py, SMTP). */
export class MailTab {
  static SECURITY = [
    ['ssl', 'SSL/TLS (465)'],
    ['starttls', 'STARTTLS (587)'],
    ['none', 'Без защиты'],
  ];

  /**
   * Вкладка.
   * @param {HTMLElement} main
   * @param {{t: string, err?: boolean}} [note] сообщение сверху
   */
  static async render(main, note) {
    const mail = await AdminApi.get('mail');
    main.innerHTML = `${this._head(mail, note)}
  ${this._server(mail)}
  ${this._letter(mail)}
  <div class="st-card" id="stAlerts"></div>`;
    new AlertsCard($('#stAlerts')).open();
    this._bind(main);
  }

  static _head(mail, note) {
    return `<div class="st-card"><p class="sub" style="margin:0">Отправка КП по почте ${mail.on ? '<b class="ok-t">настроена</b>' : '<span class="muted">не настроена</span>'}</p>
    <p class="muted" style="margin:6px 0 0">Менеджеры отправляют КП клиенту из программы: журнал → «Отправить» или кнопка после сохранения КП. Письмо уходит с этого адреса,
      ответ клиента — на почту менеджера КП; отправка отмечается в журнале, статус КП становится «Отправлено».</p>
    ${note ? `<p class="msg${note.err ? ' err' : ''}" style="text-align:left">${esc(note.t)}</p>` : ''}</div>`;
  }

  static _server(mail) {
    const security = this.SECURITY.map(
      ([key, label]) => `<option value="${key}"${mail.security === key ? ' selected' : ''}>${label}</option>`,
    ).join('');
    return `<div class="st-card"><p class="sub">Почтовый сервер (SMTP)</p>
    <div class="grid g2"><label class="f"><span>Сервер</span><input type="text" id="mlHost" value="${esc(mail.host)}" placeholder="smtp.yandex.ru" autocomplete="off"></label>
      <div class="grid g2"><label class="f"><span>Порт</span><input type="text" inputmode="numeric" id="mlPort" value="${esc(mail.port)}"></label>
        <label class="f"><span>Защита</span><select id="mlSec">${security}</select></label></div>
      <label class="f"><span>Логин</span><input type="text" id="mlLogin" value="${esc(mail.login)}" autocomplete="off" placeholder="обычно — адрес почты"></label>
      <label class="f"><span>Пароль ${mail.hasPassword ? '<b class="ok-t">задан</b>' : ''}</span><input type="password" id="mlPw" autocomplete="new-password" placeholder="${mail.hasPassword ? 'Новый пароль — заменит текущий' : 'Пароль приложения для почты'}"></label>
      <label class="f"><span>Адрес отправителя</span><input type="text" id="mlFrom" value="${esc(mail.fromEmail)}" placeholder="kp@company.ru"></label>
      <label class="f"><span>Имя отправителя</span><input type="text" id="mlName" value="${esc(mail.fromName)}" placeholder="ПНЕВМОТЕХ"></label></div>
    <label class="ck"><input type="checkbox" id="mlBcc"${mail.bccSelf ? ' checked' : ''}> Копия каждого письма — на адрес отправителя (архив отправленных КП)</label>
    <p class="muted">Яндекс: smtp.yandex.ru, 465, SSL, пароль приложения (id.yandex.ru → Безопасность). Mail.ru: smtp.mail.ru, 465. Корпоративный сервер — у системного администратора.</p></div>`;
  }

  static _letter(mail) {
    return `<div class="st-card"><p class="sub">Письмо по умолчанию</p>
    <label class="f"><span>Тема</span><input type="text" id="mlSubj" value="${esc(mail.subject)}"></label>
    <label class="f"><span>Текст</span><textarea id="mlBody" rows="9">${esc(mail.body)}</textarea></label>
    <p class="muted">Подстановки: {номер}, {дата}, {клиент}, {поставщик} (имя отправителя), {менеджер}, {должность}, {телефон}, {e-mail}; {, контакт} — «, Иван Петрович» (если в КП указано контактное лицо); {: оборудование} — «: Винтовые компрессоры Remeza ВК10…» по заголовку титула. Менеджер может поправить текст перед отправкой.</p>
    <div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap"><button class="btn primary" type="button" id="mlSave" data-autosave>Сохранить</button>
      <input type="text" id="mlTestTo" placeholder="адрес для проверки" style="max-width:260px" autocomplete="off"><button class="btn" type="button" id="mlTest"${mail.on ? '' : ' disabled'}>Отправить проверочное письмо</button>
      ${mail.hasPassword ? '<button class="btn ghost" type="button" id="mlDel">Удалить пароль</button>' : ''}</div></div>`;
  }

  static _body() {
    const body = {
      host: $('#mlHost').value.trim(),
      port: $('#mlPort').value.trim(),
      security: $('#mlSec').value,
      login: $('#mlLogin').value.trim(),
      fromEmail: $('#mlFrom').value.trim(),
      fromName: $('#mlName').value.trim(),
      bccSelf: $('#mlBcc').checked,
      subject: $('#mlSubj').value,
      body: $('#mlBody').value,
    };
    const password = $('#mlPw').value;
    if (password) body.password = password;
    return body;
  }

  static async _do(main, work, done) {
    try {
      await work();
      this.render(main, { t: typeof done === 'function' ? done() : done });
    } catch (error) {
      this.render(main, { t: String(error.message || error), err: true });
    }
  }

  static _bind(main) {
    $('#mlSave').onclick = () => this._do(main, () => AdminApi.post('mail', this._body()), 'Сохранено');
    $('#mlTest').onclick = event => {
      event.target.disabled = true;
      event.target.textContent = 'Отправляю…';
      this._do(
        main,
        () => AdminApi.post('mail/test', { to: $('#mlTestTo').value }),
        () => `Проверочное письмо отправлено на ${$('#mlTestTo').value}`,
      );
    };
    if (!$('#mlDel')) return;
    $('#mlDel').onclick = async () => {
      if (
        !(await AdminDialog.confirm(
          'Удалить пароль почты?',
          'Отправка КП по почте перестанет работать, пока не зададите новый.',
          'Удалить',
        ))
      )
        return;
      this._do(main, () => AdminApi.post('mail', { clearPassword: true }), 'Пароль удалён');
    };
  }
}

/** Нейросеть в программе (DeepSeek): включение, ключ, модель, проверка, расход. */
export class AiTab {
  /**
   * Вкладка.
   * @param {HTMLElement} main
   * @param {{t: string, err?: boolean}} [note]
   */
  static async render(main, note) {
    const config = await AdminApi.get('ai');
    main.innerHTML = `${this._head(config, note)}
  ${this._connection(config)}
  ${this._usage(config)}`;
    this._bind(main);
  }

  static _tokens(count) {
    return Number(count || 0).toLocaleString('ru-RU');
  }

  static _head(config, note) {
    const text = config.enabled
      ? 'Менеджеры заполняют карточки оборудования и элементы станций одной кнопкой «✨ Заполнить автоматически» — без чата в браузере. Ручной способ (копировать запрос в любой ИИ-чат) остаётся запасным.'
      : 'Сейчас менеджеры заполняют карточки через любой ИИ-чат в браузере (копировать запрос → вставить ответ). Включите, чтобы программа сама отправляла запрос в DeepSeek.';
    return `<div class="st-card"><div class="row"><p class="sub" style="margin:0">Заполнение карточек нейросетью</p><span class="sp"></span>
      <label class="sw"><input type="checkbox" id="aiOn"${config.enabled ? ' checked' : ''}${config.hasKey ? '' : ' disabled'}><span>${config.enabled ? 'включена' : 'выключена'}</span></label></div>
    <p class="muted">${text}</p>
    ${config.hasKey ? '' : '<p class="msg warn" style="text-align:left">Сначала укажите ключ API DeepSeek ниже.</p>'}
    ${note ? `<p class="msg${note.err ? ' err' : ''}" style="text-align:left">${esc(note.t)}</p>` : ''}</div>`;
  }

  static _connection(config) {
    const models = config.models.map(model => `<option value="${esc(model.id)}">${esc(model.name)}</option>`).join('');
    return `<div class="st-card"><p class="sub">Подключение</p>
    <div class="grid g2"><label class="f"><span>Ключ API DeepSeek ${config.hasKey ? `<b class="ok-t">задан: ${esc(config.keyMask)}</b>` : ''}</span><input type="password" id="aiKey" placeholder="${config.hasKey ? 'Новый ключ — заменит текущий' : 'sk-…'}" autocomplete="off"></label>
      <label class="f"><span>Модель</span><input type="text" id="aiModel" list="aiModels" value="${esc(config.model)}" autocomplete="off"><datalist id="aiModels">${models}<option value="deepseek/deepseek-chat-v3-0324:free">OpenRouter — DeepSeek V3, бесплатная (с лимитами)</option></datalist></label></div>
    <details class="more"><summary>Другой сервис с таким же API</summary><label class="f" style="margin-top:8px"><span>Адрес API</span><input type="text" id="aiBase" value="${esc(config.base)}" placeholder="https://api.deepseek.com"></label>
      <p class="muted">Например OpenRouter — https://openrouter.ai/api/v1 (модели DeepSeek, в т. ч. бесплатные с лимитами; ключ — с openrouter.ai) или своя модель на сервере отдела (Ollama — http не подойдёт, нужен https). Название модели — в поле «Модель».</p></details>
    <div class="row" style="margin-top:10px"><button class="btn primary" type="button" id="aiSave" data-autosave>Сохранить</button><button class="btn" type="button" id="aiTest"${config.hasKey ? '' : ' disabled'}>Проверить связь</button>
      ${config.hasKey ? '<button class="btn ghost" type="button" id="aiDel">Удалить ключ</button>' : ''}</div>
    <p class="muted">Ключ — на platform.deepseek.com (раздел API keys), оплата — пополнением баланса там же. Ключ хранится только на компьютере-сервере и попадает в резервную копию ключей; менеджерам он не виден.</p></div>`;
  }

  static _usage(config) {
    const usage = config.usage || {};
    const tokens = count => this._tokens(count);
    const months =
      (config.usageAll || []).length > 1
        ? `<p class="muted">${config.usageAll
            .slice(1)
            .map(
              row =>
                `${esc(row.month)}: ${tokens(row.requests)} запр., ${tokens((row.tokensIn || 0) + (row.tokensOut || 0))} ток.`,
            )
            .join(' · ')}</p>`
        : '';
    return `<div class="st-card"><p class="sub">Расход</p>
    <p>За ${esc(config.usageMonth)}: запросов <b>${tokens(usage.requests)}</b>, токенов в запросах <b>${tokens(usage.tokensIn)}</b>, в ответах <b>${tokens(usage.tokensOut)}</b>.</p>
    ${months}
    <p class="muted">Одна карточка — обычно 3–15 тыс. токенов (больше, если вставлен длинный паспорт или ТЗ).</p></div>`;
  }

  static async _save(main, body, message) {
    try {
      await AdminApi.post('ai', body);
      await AiDirect.load();
      this.render(main, { t: message });
    } catch (error) {
      this.render(main, { t: String(error.message || error), err: true });
    }
  }

  static _bind(main) {
    $('#aiOn').onchange = event =>
      this._save(
        main,
        { enabled: event.target.checked },
        event.target.checked
          ? 'Нейросеть включена — у менеджеров появилась кнопка «✨ Заполнить автоматически»'
          : 'Нейросеть выключена — менеджеры заполняют через ИИ-чат',
      );
    $('#aiSave').onclick = () => {
      const body = { model: $('#aiModel').value, base: $('#aiBase').value };
      const key = $('#aiKey').value.trim();
      if (key) body.key = key;
      this._save(main, body, 'Сохранено');
    };
    if ($('#aiDel')) {
      $('#aiDel').onclick = async () => {
        if (
          !(await AdminDialog.confirm(
            'Удалить ключ DeepSeek?',
            'Нейросеть в программе выключится, менеджеры будут заполнять через ИИ-чат.',
            'Удалить',
          ))
        )
          return;
        this._save(main, { key: '' }, 'Ключ удалён, нейросеть выключена');
      };
    }
    $('#aiTest').onclick = event => this._test(main, event.target);
  }

  static async _test(main, button) {
    button.disabled = true;
    button.textContent = 'Проверяю…';
    try {
      const test = await AdminApi.post('ai/test', {});
      this.render(main, {
        t: `Связь есть: модель ${test.model}, ответ получен (${(test.usage && test.usage.total_tokens) || 0} токенов).`,
      });
    } catch (error) {
      this.render(main, { t: String(error.message || error), err: true });
    }
  }
}
