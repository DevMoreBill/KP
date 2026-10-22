import { AppTabs } from '../core/app-tabs.js';
import { Srv } from '../core/net.js';
import { S } from '../core/state.js';
import { Cabinet } from '../features/crm/cabinet.js';
import { CatalogWindow } from '../features/catalog/catalog-window.js';
import { Journal } from '../features/kp/journal.js';
import { MyDay } from '../features/kp/my-day.js';
import { DealState } from '../features/deal/deal-state.js';
import { SettingsWindow } from '../features/admin/settings-window.js';
import { Mobile } from './mobile.js';

/** Разделы программы во вкладках: постоянные (КП, Кабинет, Каталог, Журнал) и открытые «по месту». */
export class AppSections {
  /** Зарегистрировать разделы (после ответа сервера: каталог и журнал есть только с ним). */
  static register() {
    document.body.classList.add('has-tabs');
    const server = () => Srv.on;
    AppTabs.register(AppTabs.HOME, {
      label: () => (S.number ? `КП № ${S.number}` : 'КП'),
      short: 'КП',
      icon: '▤',
      fixed: true,
    });
    AppTabs.register('cab', {
      label: 'Кабинет',
      icon: '◫',
      fixed: true,
      open: () => Cabinet.open(),
      shown: () => MyDay.enabled(),
    });
    AppTabs.register('cat', {
      label: 'Каталог',
      icon: '▦',
      fixed: true,
      open: () => CatalogWindow.open({}),
      shown: server,
    });
    AppTabs.register('jrn', { label: 'Журнал КП', icon: '☰', fixed: true, open: () => Journal.open(), shown: server });
    AppTabs.register('deal', { label: 'Экономика', icon: '₽', open: () => DealState.open() });
    AppTabs.register('item', { label: 'Позиция', icon: '✎' });
    AppTabs.register('set', { label: 'Настройки', icon: '⚙', open: () => SettingsWindow.open() });
    AppTabs.register('more', {
      label: 'Ещё',
      icon: '⋯',
      fixed: true,
      open: () => Mobile.openMenu(),
      shown: () => Mobile.isPhone(),
    });
  }
}
