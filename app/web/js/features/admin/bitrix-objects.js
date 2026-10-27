import { AdminApi } from './admin-core.js';
import { BitrixPanel } from './bitrix-panel.js';
import { esc } from '../../core/util.js';

/** Направление вида данных (сделки, компании, дела) поверх общего — первой настройкой пункта. */
class BitrixKindDir {
  static WHAT = {
    both: 'туда и обратно',
    in: 'только из Битрикс24 в программу',
    out: 'только из программы в Битрикс24',
    off: 'не передаются',
  };

  /**
   * Поле направления с описанием.
   * @param {string} kind
   * @param {{label: string, what: string, example: string}} text
   * @returns {string}
   */
  static html(kind, text) {
    const panel = BitrixPanel;
    const rules = panel.rules();
    const general = (panel.DIR[rules.mode] || '').toLowerCase();
    const control = panel.sel(
      `data-bxkind="${kind}"`,
      panel.dirOpts(['both', 'in', 'out', 'off'], `как общее: ${general}`),
      (rules.flow || {})[kind] || '',
      text.label,
    );
    return panel.opt({ control, ...text });
  }

  /**
   * Выбранное направление для сохранения.
   * @param {string} kind
   * @returns {object} flow целиком
   */
  static value(kind) {
    const select = BitrixPanel.one(`[data-bxkind="${kind}"]`);
    return BitrixPanel.flowWith(kind, select ? select.value : '');
  }
}

/** «Сделки → Общие правила»: направление, новые сделки из Битрикс24, удалённые в Битрикс24. */
export class BitrixDeals {
  static GONE = {
    unlink: 'снять связь и больше не отправлять (рекомендуется)',
    recreate: 'создать сделку в Битрикс24 заново',
    keep: 'ничего не делать — ошибка в «Не отправлено»',
  };

  /**
   * Вкладка.
   * @returns {string}
   */
  static html() {
    const panel = BitrixPanel;
    const rules = panel.rules();
    const deals = rules.deals || {};
    const fallback = [
      ['', 'загружать без ответственного'],
      ['skip', 'не загружать'],
      ...(panel.state.managers || []).map(manager => [manager.id, `отдать: ${manager.name}`]),
    ];
    return `<div class="st-card"><p class="sub">Направление</p>
      ${BitrixKindDir.html('deal', {
        label: 'Сделки передаются',
        what: 'Название, этап, ожидаемая дата, ответственный, сумма, экономика, товары и файлы КП. «В обе стороны» — сделки программы появляются в Битрикс24, а изменения в Битрикс24 и новые сделки приходят в программу.',
        example:
          '«Только из программы в Битрикс24» — Битрикс24 остаётся витриной для руководства: всё ведётся в программе, правки в Битрикс24 в программу не возвращаются.',
      })}</div>
    <div class="st-card"><p class="sub">Новые сделки из Битрикс24</p>
      <p class="muted bx-note">Приходят сами при каждом обмене, если сделки передаются «из Битрикс24». Загружаются только сделки воронок обмена («Воронки и этапы») и только созданные после включения обмена; более ранние — «Старые сделки». Ответственный сопоставлен с менеджером («Менеджеры») — сделка появляется в его кабинете.</p>
      ${panel.opt({
        control: panel.sel('id="bxFb"', fallback, rules.fallback || '', 'Без сопоставленного ответственного'),
        label: 'Ответственный не сопоставлен',
        what: 'Что делать с новой сделкой, если её ответственный в Битрикс24 не найден среди менеджеров программы (новый сотрудник, бот, заявка с сайта).',
        example:
          '«Без ответственного» — сделка видна руководителю во «Весь отдел», он назначает менеджера сам; «отдать: Иванова» — сразу ей; «не загружать» — сделка остаётся только в Битрикс24.',
      })}
      ${panel.opt({
        control: panel.toggle('id="bxNewFlag"', deals.newFlag !== false, 'Отмечать новые'),
        label: 'Отмечать «новая из Битрикс24»',
        what: 'Новая сделка получает метку на доске, попадает в блок «Новые сделки из Битрикс24» на «Сегодня» и в счётчик вкладки — пока ответственный её не откроет. Через сутки без внимания — «ждёт больше суток».',
        off: 'сделка просто появляется на доске в своей стадии, без метки и напоминаний.',
      })}</div>
    <div class="st-card"><p class="sub">Сделку удалили в Битрикс24</p>
      ${panel.opt({
        control: panel.sel('id="bxGone"', Object.entries(this.GONE), deals.gone || 'unlink', 'Удалённая в Битрикс24'),
        label: 'При следующей отправке такой сделки',
        what: 'Программа узнаёт об удалении, когда отправляет в Битрикс24 изменения этой сделки. В самой программе сделка не удаляется никогда. Запись о случившемся — в «Журнал и проверка».',
        example:
          'Дубль удалили в Битрикс24 намеренно — «снять связь»: сделка остаётся в программе и больше не уходит в Битрикс24. Удалили по ошибке — «создать заново»: появится новая сделка Битрикс24 со всеми данными программы (прежние дела и комментарии Битрикс24 не восстанавливаются).',
      })}
      <div class="row" style="margin-top:12px"><button class="btn primary" type="button" id="bxSaveDeals" data-autosave>Сохранить</button></div></div>`;
  }

  /** События вкладки. */
  static bind() {
    const panel = BitrixPanel;
    panel.one('#bxSaveDeals').onclick = () =>
      panel.save({
        flow: BitrixKindDir.value('deal'),
        fallback: panel.one('#bxFb').value,
        deals: { newFlag: panel.one('#bxNewFlag').checked, gone: panel.one('#bxGone').value },
      });
  }
}

/** «Клиенты → Компании»: поиск без дублей, создание, что дописывается, проверка удалённых, в справочник клиентов. */
export class BitrixCompanies {
  /**
   * Вкладка.
   * @returns {string}
   */
  static html() {
    const panel = BitrixPanel;
    const company = panel.rules().company || {};
    return `<div class="st-card"><p class="sub">Направление</p>
      ${BitrixKindDir.html('company', {
        label: 'Компании передаются',
        what: '«В Битрикс24» — у сделки программы в Битрикс24 стоит компания клиента (найденная или созданная). «Из Битрикс24» — компании сделок Битрикс24 попадают в справочник клиентов программы. Контакты зависят и от этого направления, и от своего («Контакты»).',
        example:
          '«Только из Битрикс24 в программу» — программа не создаёт и не правит компании в Битрикс24, а только забирает их в справочник клиентов.',
      })}</div>
    ${this._out(company)}${this._in(company)}`;
  }

  static _flag(company, key, label) {
    return BitrixPanel.toggle(`data-bxco="${key}"`, company[key] !== false, label);
  }

  static _out(company) {
    const panel = BitrixPanel;
    const flag = (key, label) => this._flag(company, key, label);
    return `<div class="st-card"><p class="sub">Сделка программы → компания в Битрикс24</p>
      <p class="muted bx-note">Найденная компания запоминается за клиентом и дальше не ищется. Поиск идёт по порядку: ИНН → телефон и почта компании → название; первое подтверждённое совпадение — компания клиента.</p>
      ${panel.opt({
        control: panel.sel('id="bxFind"', Object.entries(panel.FIND), company.find || 'inn_name', 'Поиск компании'),
        label: 'Искать по ИНН и названию',
        what: 'По ИНН — среди реквизитов компаний Битрикс24. По названию — без формы собственности и кавычек («ООО «Ромашка»» = «Ромашка ООО»), только если такая компания одна и её ИНН не другой.',
        example: 'У клиентов всегда есть ИНН — «только по ИНН»: две разные «Ромашки» точно не перепутаются.',
      })}
      ${panel.opt({
        control: flag('byComm', 'Искать по телефону и почте'),
        label: 'Искать по телефону и почте компании',
        what: 'Телефон и почта самой компании клиента (не контактных лиц — они бывают общими у нескольких компаний). Компания считается той же, только если она одна, её ИНН не другой и в названиях есть общее слово. Так программа находит компанию, заведённую в Битрикс24 без реквизитов, и не создаёт дубль, который удалил бы контроль дублей Битрикс24.',
        off: 'компания ищется только по ИНН и названию; при расхождении названий может появиться дубль.',
      })}
      ${panel.opt({
        control: flag('create', 'Создавать компанию'),
        label: 'Не нашлась — создать компанию',
        what: 'Новая компания: название клиента, ответственный — менеджер сделки, телефон и почта — только не занятые другой компанией Битрикс24.',
        off: 'сделка уходит в Битрикс24 без компании; компанию к ней привяжет сам менеджер в Битрикс24.',
      })}
      ${panel.opt({
        control: flag('reqs', 'С реквизитами'),
        label: 'С реквизитами',
        what: 'В новую компанию — реквизиты из справочника программы: ИНН, КПП, ОГРН, краткое и полное наименование, руководитель, юридический адрес.',
        off: 'компания создаётся только с названием, телефоном и почтой.',
      })}
      ${panel.opt({
        control: flag('fill', 'Дописывать телефон и почту'),
        label: 'Дописывать телефон и почту в компанию',
        what: 'Появились в карточке клиента программы новые телефон или почта компании — они дописываются в компанию Битрикс24. Только добавляются (прежние не меняются) и только если не записаны у другой компании.',
        off: 'компания в Битрикс24 после создания программой не меняется.',
      })}
      ${panel.opt({
        control: flag('check', 'Проверять удалённые'),
        label: 'Раз в сутки проверять, не удалены ли компании',
        what: 'Компанию, связанную со сделками, могли удалить в Битрикс24 (вручную или контролем дублей). Тогда связь забывается, а сделки этого клиента отправляются заново — компания будет найдена (оригинал, а не дубль). Запись — в журнале обмена.',
        off: 'сделки продолжают уходить к удалённой компании (в Битрикс24 — без компании).',
      })}
      ${BitrixMyCompany.html(company)}</div>`;
  }

  static _in(company) {
    const panel = BitrixPanel;
    return `<div class="st-card"><p class="sub">Компания Битрикс24 → клиент программы</p>
      <p class="muted bx-note">С ИНН — к клиенту программы с тем же ИНН (нет такого — новый клиент); реквизиты остаются из программы (они сверены с ФНС), из Битрикс24 дописываются только контакты.</p>
      ${panel.opt({
        control: this._flag(company, 'byPeople', 'Узнавать по контактам'),
        label: 'Компания без ИНН — узнавать клиента по контактам',
        what: 'Ищется клиент программы с тем же телефоном, почтой или ФИО контакта. Одно совпадение и общее слово в названии — тот же клиент; несколько — менеджер выбирает клиента в карточке сделки; ни одного — новый клиент с пометкой «без ИНН».',
        off: 'каждая компания Битрикс24 без ИНН становится отдельным клиентом «без ИНН» (возможны повторы в справочнике).',
      })}
      <div class="row" style="margin-top:12px"><button class="btn primary" type="button" id="bxSaveCo" data-autosave>Сохранить</button></div></div>`;
  }

  /** События вкладки. */
  static bind() {
    const panel = BitrixPanel;
    BitrixMyCompany.bind();
    panel.one('#bxSaveCo').onclick = () => {
      const company = { find: panel.one('#bxFind').value, my: panel.one('#bxMy').value };
      panel.all('[data-bxco]').forEach(box => {
        company[box.dataset.bxco] = box.checked;
      });
      panel.save({ flow: BitrixKindDir.value('company'), company });
    };
  }
}

/** Наша компания — реквизиты продавца в сделке Битрикс24 (MYCOMPANY_ID). */
class BitrixMyCompany {
  /**
   * Поле с описанием.
   * @param {object} company
   * @returns {string}
   */
  static html(company) {
    const panel = BitrixPanel;
    const list = panel.state.myCompanies || [];
    const prefer = list.find(row => /пневмотех/i.test(row.title));
    const auto = prefer ? `Автоматически — ${prefer.title}` : 'Как в Битрикс24 (компания портала по умолчанию)';
    const control = `${panel.sel('id="bxMy"', [['', auto], ...list.map(row => [row.id, row.title])], company.my || '', 'Наша компания')}
      <button class="btn ghost sm" type="button" id="bxMyLoad">Обновить список</button>`;
    return panel.opt({
      control,
      label: 'Наша компания в сделке',
      what: `Чьи реквизиты стоят в сделке Битрикс24 («Реквизиты вашей компании»). Новая сделка программы получает эту компанию; менеджер может выбрать другую в карточке сделки («Наша компания»). Список — компании портала с отметкой «моя компания»${list.length ? '' : ' (ещё не загружен — «Обновить список»)'}.`,
    });
  }

  /** Кнопка «Обновить список». */
  static bind() {
    BitrixPanel.one('#bxMyLoad').onclick = () =>
      BitrixPanel.run(
        () => AdminApi.post('bitrix/my', {}),
        reply => `Наших компаний на портале: ${(reply.myCompanies || []).length}`,
      );
  }
}

/** «Клиенты → Контакты»: контактные лица клиента в Битрикс24 и обратно. */
export class BitrixContacts {
  static MAX = 10;
  static DEF_MAX = 3;

  /**
   * Вкладка.
   * @returns {string}
   */
  static html() {
    const panel = BitrixPanel;
    const people = panel.rules().contacts || {};
    return `<div class="st-card"><p class="sub">Направление</p>
      ${panel.opt({
        control: panel.sel(
          'id="bxCtDir"',
          panel.dirOpts(['both', 'in', 'out', 'off']),
          people.dir || 'both',
          'Контакты',
        ),
        label: 'Контакты передаются',
        what: '«В Битрикс24» — контактные лица из карточки клиента программы становятся контактами компании Битрикс24. «Из Битрикс24» — контакты компании и сделки Битрикс24 дописываются в карточку клиента программы. Работает вместе с компаниями: если компании не передаются, контакты тоже.',
        example:
          '«Только из Битрикс24 в программу» — контакты ведут в Битрикс24, программа их только забирает и ничего не создаёт в Битрикс24.',
      })}
      <p class="muted bx-note">Удаление контакта в программе (✕ в карточке клиента) — только в программе: в Битрикс24 ничего не удаляется, а обмен этот контакт обратно не добавляет (пока менеджер не впишет его сам).</p></div>
    ${this._out(people)}${this._in(people)}`;
  }

  static _flag(people, key, label) {
    return BitrixPanel.toggle(`data-bxct="${key}"`, people[key] !== false, label);
  }

  static _out(people) {
    const panel = BitrixPanel;
    const flag = (key, label) => this._flag(people, key, label);
    const counts = Array.from({ length: this.MAX }, (_unused, i) => [String(i + 1), String(i + 1)]);
    return `<div class="st-card"><p class="sub">Программа → Битрикс24</p>
      <p class="muted bx-note">Один и тот же человек — по ФИО: совпадают хотя бы два слова (или всё имя, если в одном из ФИО одно слово). Контакт ищется в Битрикс24 по телефону и почте; найден человек с тем же ФИО — он и привязывается. Телефон или почта у другого человека — контакт не создаётся, чужая карточка не меняется, в журнале — предупреждение.</p>
      ${panel.opt({
        control: flag('create', 'Создавать контакты'),
        label: 'Не нашёлся — создать контакт',
        what: 'Новый контакт: фамилия, имя, должность, телефон, почта, ответственный — менеджер сделки; привязан к компании клиента.',
        off: 'привязываются только контакты, которые уже есть в Битрикс24 (найдены по телефону или почте с тем же ФИО); новых программа не создаёт.',
      })}
      ${panel.opt({
        control: panel.sel('id="bxCtMax"', counts, String(people.max || this.DEF_MAX), 'Сколько контактов'),
        label: 'Сколько контактов клиента передавать',
        what: 'Первые по списку в карточке клиента (новые — сверху). Остальные остаются только в программе.',
        example: '3 — руководитель, снабженец и главный инженер; секретари и бухгалтерия в Битрикс24 не попадают.',
      })}
      ${panel.opt({
        control: flag('deal', 'Привязывать к сделке'),
        label: 'Привязывать первый контакт к сделке',
        what: 'Первый контакт клиента становится основным контактом сделки Битрикс24 (его проверяют регламент и роботы Битрикс24).',
        off: 'контакты привязываются только к компании; контакт сделки выбирают в Битрикс24 вручную.',
      })}
      ${panel.opt({
        control: flag('fill', 'Дописывать телефон и почту'),
        label: 'Дописывать телефон и почту в контакт',
        what: 'Менеджер дописал в программе телефон или почту уже отправленного контакта — они дописываются в контакт Битрикс24. Только добавляются и только если не записаны у другого человека.',
        off: 'контакт в Битрикс24 после первой отправки не меняется.',
      })}</div>`;
  }

  static _in(people) {
    const panel = BitrixPanel;
    const flag = (key, label) => this._flag(people, key, label);
    return `<div class="st-card"><p class="sub">Битрикс24 → программа</p>
      <p class="muted bx-note">Тот же человек в карточке клиента — по телефону, почте или полному ФИО: у него дописываются пустые поля, повтор не появляется.</p>
      ${panel.opt({
        control: flag('bare', 'Без телефона и почты'),
        label: 'Загружать контакты без телефона и почты',
        what: 'Контакт Битрикс24, у которого есть только ФИО (и, может быть, должность).',
        off: 'в карточку клиента попадают только контакты, по которым можно связаться.',
      })}
      ${panel.opt({
        control: flag('junk', 'Не загружать пустые'),
        label: 'Не загружать пустые контакты',
        what: 'Контакты Битрикс24 без букв в имени и без телефона и почты («1», «-», «.»). Такие уже накопившиеся в карточках клиентов убираются при следующем обмене с этой компанией.',
        off: 'такие контакты загружаются и показываются в карточке клиента как есть.',
      })}
      <div class="row" style="margin-top:12px"><button class="btn primary" type="button" id="bxSaveCt" data-autosave>Сохранить</button></div></div>`;
  }

  /** События вкладки. */
  static bind() {
    const panel = BitrixPanel;
    panel.one('#bxSaveCt').onclick = () => {
      const contacts = { dir: panel.one('#bxCtDir').value, max: panel.one('#bxCtMax').value };
      panel.all('[data-bxct]').forEach(box => {
        contacts[box.dataset.bxct] = box.checked;
      });
      panel.save({ contacts });
    };
  }
}

/** «Дела»: дело программы → дело Битрикс24 и какие дела Битрикс24 загружать. */
export class BitrixTasks {
  static KINDS = [
    ['call', 'Звонок'],
    ['meet', 'Встреча'],
    ['mail', 'Письмо'],
    ['task', 'Задача'],
  ];

  /**
   * Вкладка.
   * @returns {string}
   */
  static html() {
    const panel = BitrixPanel;
    const tasks = panel.rules().tasks || {};
    return `<div class="st-card"><p class="sub">Направление</p>
      ${BitrixKindDir.html('task', {
        label: 'Дела передаются',
        what: 'Дела по сделкам, связанным с Битрикс24: звонки, встречи, письма, задачи — с крайним сроком, отметкой «сделано», переносом и отменой. Дела без сделки не передаются.',
        example:
          '«Только из программы в Битрикс24» — руководитель видит план менеджеров в Битрикс24, а дела, заведённые в Битрикс24, в кабинет не приходят.',
      })}</div>
    ${this._out(tasks)}${this._in(tasks)}`;
  }

  static _out(tasks) {
    const panel = BitrixPanel;
    const kinds = this.KINDS.map(([key, label]) =>
      panel.opt({
        control: panel.sel(
          `data-bxtask="${key}"`,
          Object.entries(panel.TASK_AS),
          (tasks.kinds || {})[key] || 'todo',
          label,
        ),
        label: `${label} программы → в Битрикс24`,
        what: `В Битрикс24 — «${esc(label)}: тема», срок и время, описание, ответственный.`,
      }),
    ).join('');
    return `<div class="st-card"><p class="sub">Программа → Битрикс24</p>
      <p class="muted bx-note">«Дело (универсальное)» — дело Битрикс24 с крайним сроком (в новых версиях Битрикс24); «звонок» и «встреча» — дела этих видов (в старых версиях); «не передавать» — дело остаётся только в программе и не загружается из Битрикс24.</p>
      ${kinds}
      ${panel.opt({
        control: panel.toggle('id="bxCancel"', tasks.cancel !== false, 'Передавать отмену'),
        label: 'Передавать отмену дела',
        what: 'Отменённое в программе дело закрывается в Битрикс24 с темой «Отменено — …»; такое же дело из Битрикс24 отменяется в программе.',
        off: 'отмена остаётся только в программе; в Битрикс24 дело висит открытым, пока его не закроют там.',
      })}</div>`;
  }

  static _in(tasks) {
    const panel = BitrixPanel;
    const load = tasks.in || {};
    const into = this.KINDS.map(([key, label]) =>
      panel.chk(`data-bxin="${key}"`, load[key] !== false, esc(label)),
    ).join('');
    return `<div class="st-card"><p class="sub">Битрикс24 → программа</p>
      <p class="muted bx-note">Загружаются дела по связанным сделкам: новые — в кабинет ответственного (или менеджера сделки), изменения (перенос, «сделано») — в дела программы. Дела, отправленные программой, всегда принимают изменения из Битрикс24 — эти настройки касаются только новых дел.</p>
      ${panel.opt({
        control: `<div class="bx-chips">${into}</div>`,
        label: 'Какие новые дела загружать',
        what: 'Вид дела Битрикс24: звонок, встреча, письмо; остальное — «задача».',
        example:
          'Звонки телефонии Битрикс24 создают десятки дел-звонков — снимите «Звонок», и в кабинете останутся только встречи, письма и задачи (сами звонки по-прежнему видны в ленте сделки).',
      })}
      ${panel.opt({
        control: panel.toggle('id="bxDoneIn"', tasks.done !== false, 'Загружать выполненные'),
        label: 'Загружать уже выполненные дела',
        what: 'Дело, которое в Битрикс24 уже отмечено сделанным, попадает в программу с отметкой «сделано» — история сделки полная.',
        off: 'загружаются только открытые дела — в кабинете только то, что ещё нужно сделать.',
      })}
      ${panel.opt({
        control: panel.toggle('id="bxOther"', tasks.other !== false, 'Дела, заведённые вручную'),
        label: 'Загружать дела, заведённые в Битрикс24 вручную',
        what: 'Не только дела, созданные программой, но и заведённые сотрудниками или роботами в Битрикс24.',
        off: 'из Битрикс24 приходят только изменения дел, которые создала программа.',
      })}
      <div class="row" style="margin-top:12px"><button class="btn primary" type="button" id="bxSaveTasks" data-autosave>Сохранить</button></div></div>`;
  }

  /** События вкладки. */
  static bind() {
    const panel = BitrixPanel;
    panel.one('#bxSaveTasks').onclick = () => {
      const kinds = {};
      panel.all('[data-bxtask]').forEach(select => {
        kinds[select.dataset.bxtask] = select.value;
      });
      const load = {};
      panel.all('[data-bxin]').forEach(box => {
        load[box.dataset.bxin] = box.checked;
      });
      panel.save({
        flow: BitrixKindDir.value('task'),
        tasks: {
          kinds,
          in: load,
          cancel: panel.one('#bxCancel').checked,
          done: panel.one('#bxDoneIn').checked,
          other: panel.one('#bxOther').checked,
        },
      });
    };
  }
}
