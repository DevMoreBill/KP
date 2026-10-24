import { ContextMenu } from './context-menu.js';

/**
 * Действия меню по правой кнопке для каждого места программы. Пункты — те же кнопки, что уже есть в строке, карточке или
 * окне (нажатие пункта нажимает кнопку), поэтому права, выключатели и проверки работают как обычно. Порядок — от частного
 * к общему: строка журнала раньше окна журнала.
 */
export class ContextSections {
  static _text(el, selector) {
    const node = selector ? el.querySelector(selector) : el;
    return node ? (node.value || node.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  // «Перейти: Клиент» — без номера шага и значка состояния («1», «✓», «!») перед названием
  static _go(items) {
    return items.map(item => ({ ...item, label: `Перейти: ${item.label.replace(/^[\d✓!✕\s]+/, '')}` }));
  }

  static _open(label, el) {
    return { label, act: () => el.click() };
  }

  static LIST = [
    {
      // позиция КП
      sel: '#form .item',
      title: el => ContextSections._text(el, '[data-p$=".name"]') || 'Позиция КП',
      items: el => [
        ...ContextMenu.harvest(el, '.ifoot button'),
        ...ContextMenu.harvest(el, '[data-a=toPrice]').map(item => ({ ...item, label: 'Цена позиции' })),
        ContextMenu.copyItem('Копировать название', ContextSections._text(el, '[data-p$=".name"]')),
      ],
      help: 'kp-equip',
    },
    {
      // строка каталога: сначала выбрать её — справа откроется карточка с её кнопками
      sel: '#cwList .cw-row',
      title: el => ContextSections._text(el, '.cw-n, b') || 'Позиция каталога',
      prepare: el => el.click(),
      items: el => {
        const card = ContextMenu.harvest(document.querySelector('#catdlg .pv-acts'), 'button');
        return card.length ? card : ContextMenu.harvest(el, '[data-add]');
      },
      help: 'kp-equip',
    },
    {
      sel: '#catdlg',
      title: () => 'Каталог',
      items: el =>
        ContextMenu.harvest(el, '.cw-h > button:not([data-cw=close]), .cw-reset, [data-cw=resetall], [data-cw=done]'),
      help: 'kp-equip',
    },
    {
      // строка журнала КП: «Открыть» и всё из меню «⋯»
      sel: '.jr:not(.jr-h)',
      title: el => ContextSections._text(el, '.jr-n .n') || 'КП',
      items: el => [
        ...ContextMenu.harvest(el, '.acts > button'),
        ...ContextMenu.harvest(el, '.jr-more .menu-l > button, .jr-more .menu-l > a', { hidden: true }),
        ContextMenu.copyItem('Копировать номер КП', ContextSections._text(el, '.jr-n .n').replace(/^№\s*/, '')),
        ContextMenu.copyItem('Копировать клиента', ContextSections._text(el, '.jr-m b')),
      ],
      help: 'journal',
    },
    {
      // карточка сделки (окно)
      sel: 'dialog.deal-dlg',
      title: el => ContextSections._text(el, '.dk-no') || 'Сделка',
      items: el => [
        ...ContextMenu.harvest(el, '.dk-chev button').map(item => ({ ...item, label: `Стадия: ${item.label}` })),
        ...ContextMenu.harvest(el, 'button.dk-won, button.dk-lost, [data-feedmode]'),
        ...ContextMenu.harvest(el, '.dk-acts button'),
      ],
      help: 'deal-card',
    },
    {
      // сделка на доске или строка списка сделок
      sel: '#cabWin article.dc, #cabWin .cab-lr[data-deal]',
      title: el => ContextSections._text(el, 'b, .dc-t') || 'Сделка',
      items: el => [ContextSections._open('Открыть сделку', el), ...ContextMenu.harvest(el, 'button')],
      help: 'deals',
    },
    {
      // дело в списке «Что сделать»
      sel: '#cabWin .tk[data-task]',
      title: el => ContextSections._text(el, 'b') || 'Дело',
      items: el => {
        const done = el.querySelector('[data-tdone]');
        const mark =
          done && !done.disabled
            ? [{ label: done.checked ? 'Вернуть в работу' : 'Отметить сделанным', act: () => done.click() }]
            : [];
        return [...mark, ...ContextMenu.harvest(el, 'button')];
      },
      help: 'today',
    },
    {
      sel: '#cabWin .cab-cl',
      title: el => ContextSections._text(el, 'b, h4') || 'Клиент',
      items: el => ContextMenu.harvest(el, 'button'),
      help: 'today',
    },
    {
      sel: '#cabWin',
      title: () => 'Кабинет',
      items: el => [
        ...ContextSections._go(ContextMenu.harvest(el, '.cab-tabs [data-ctab]')),
        ...ContextMenu.harvest(el, '.cab-newm > button', { hidden: true }),
      ],
      help: 'today',
    },
    {
      // экономика сделки: вкладки и выгрузка
      sel: '#dealdlg',
      title: () => 'Экономика сделки',
      items: el => [
        ...ContextSections._go(ContextMenu.harvest(el, '.dl-tabs [data-dlx=step]')),
        ContextMenu.press('Excel для согласования', '[data-dlx=xlsx]', el),
        ContextMenu.press('Закрыть экономику', '[data-dlx=close]', el),
      ],
      help: 'econ',
    },
    {
      sel: '.jrnwin',
      title: () => 'Журнал КП',
      items: el => ContextMenu.harvest(el, '#jQk [data-jq]'),
      help: 'journal',
    },
    {
      // вкладка сверху
      sel: '#appTabs .apt-t',
      title: el => ContextSections._text(el, 'span'),
      items: el => [
        ContextSections._open('Перейти', el),
        ...ContextMenu.harvest(el, '[data-tabx], [data-kpx]', { hidden: true }),
      ],
      help: 'start',
    },
    {
      sel: 'nav.stepper',
      title: () => 'Шаги КП',
      items: el => ContextSections._go(ContextMenu.harvest(el, 'button')),
      help: 'kp-client',
    },
    {
      // страница КП
      sel: 'main.wrap',
      title: () => 'КП',
      items: () => [
        ContextMenu.press('Сохранить КП', '#side [data-a=download]'),
        ContextMenu.press('Предпросмотр КП', '#side [data-a=kpPreview]'),
        ContextMenu.press('Экономика сделки', '#form button.dl-cta, #side button.dl-cta'),
        ContextMenu.press('Добавить из каталога', '#form [data-a=openCatalog]'),
        ContextMenu.press('Новое оборудование', '#form [data-a=addItem]'),
        ContextMenu.press('Станция в контейнере', '#form [data-a=addStation]'),
      ],
      help: 'kp-client',
    },
  ];

  /** Зарегистрировать разделы в меню. */
  static register() {
    this.LIST.forEach(section => ContextMenu.register(section));
  }
}
