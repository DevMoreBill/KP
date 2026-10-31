import { AdminGearClicks } from './admin-gear.js';
import { HelpLinkClicks } from './help-link.js';
import { ContextMenu } from './context-menu.js';
import { ContextSections } from './context-sections.js';
import { AppKeys, TopBar } from './app-keys.js';
import { FieldEvents } from './field-events.js';
import { FormView, Popups } from './form-view.js';
import { GeoInput, GeoParse } from './geo-input.js';
import { ItemActions } from './item-actions.js';
import { ItemOrder } from './item-order.js';
import { Mobile } from './mobile.js';
import { ProblemReport } from './problem-report.js';
import { Problems, SidePanel } from './side-panel.js';
import { ClientPrev, ClientStep } from './step-client.js';
import { CondsStep } from './step-conds.js';
import { CoverStep } from './step-cover.js';
import { EquipStep, QuickAdd } from './step-equipment.js';
import { ManagerStep } from './step-manager.js';
import { PriceStep } from './step-price.js';
import { Steps } from './steps.js';
import { TenderBlock } from './tender.js';
import { Tour } from './tour.js';
import { BigMode } from './big-mode.js';
import { PicView } from './pic-view.js';
import { KpState } from '../core/state.js';
import { DatePicker } from '../core/date-picker.js';
import { UiKit } from '../core/ui-kit.js';
import { KpForm } from '../core/kp-form.js';
import { DealLogistics } from '../features/deal/deal-logistics.js';
import { CoverSync } from '../features/catalog/cover-sync.js';

export const UI_PARTS = {
  AdminGearClicks,
  HelpLinkClicks,
  ContextMenu,
  ContextSections,
  AppKeys,
  TopBar,
  FieldEvents,
  FormView,
  Popups,
  GeoInput,
  GeoParse,
  ItemActions,
  ItemOrder,
  Mobile,
  ProblemReport,
  Problems,
  SidePanel,
  ClientPrev,
  ClientStep,
  CondsStep,
  CoverStep,
  EquipStep,
  QuickAdd,
  ManagerStep,
  PriceStep,
  Steps,
  TenderBlock,
  Tour,
  BigMode,
  PicView,
};

// разделы просят форму (KpForm) — без import формы
KpForm.connect({
  render: () => FormView.render(),
  step: () => Steps.current,
  select: id => {
    Steps.current = id;
  },
  open: (id, target) => Steps.open(id, target),
  side: () => SidePanel.render(),
  live: () => SidePanel.updateLive(),
  problems: () => Problems.list(),
});
// склады поставщиков сделки — в подсказках адреса (поле «Откуда»)
GeoInput.extra.wh = input => DealLogistics.warehouses(input);
Steps.restore();
Mobile.watch();
// титул КП — по оборудованию, перед записью черновика
KpState.onPersist(() => CoverSync.run());

// порядок обработчиков — как у прежних обычных скриптов (адрес, меню, быстрый поиск, условия, форма, телефон, даты)
GeoInput.listen();
Popups.listen();
FormView.listen();
QuickAdd.listen();
CondsStep.listen();
FieldEvents.listen();
ItemActions.listen();
TopBar.listen();
AppKeys.listen();
Mobile.listen();
DatePicker.listen();
UiKit.listenTips();
Steps.listen();
ItemOrder.listen();
ProblemReport.listen();
AdminGearClicks.listen();
HelpLinkClicks.listen();
ContextSections.register();
ContextMenu.listen();
PicView.listen();
Tour.later();
