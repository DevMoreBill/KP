import { AdminGearClicks } from './admin-gear.js';
import { HelpLinkClicks } from './help-link.js';
import { ContextMenu } from './context-menu.js';
import { ContextSections } from './context-sections.js';
import { AppKeys, TopBar } from './app-keys.js';
import { DatePicker, WorkCalendar } from './date-picker.js';
import { FieldEvents } from './field-events.js';
import { FormView, Popups } from './form-view.js';
import { GeoInput, GeoParse } from './geo-input.js';
import { ItemActions } from './item-actions.js';
import { ItemOrder } from './item-order.js';
import { Mobile } from './mobile.js';
import { ProblemReport } from './problem-report.js';
import { Problems, SidePanel } from './side-panel.js';
import { ClientPrev, ClientStep } from './step-client.js';
import { CondMemory, CondsStep } from './step-conds.js';
import { CoverStep, CoverSync } from './step-cover.js';
import { EquipStep, QuickFind } from './step-equipment.js';
import { ManagerStep } from './step-manager.js';
import { PriceStep } from './step-price.js';
import { Steps } from './steps.js';
import { Tender, TenderBlock } from './tender.js';
import { Tour } from './tour.js';
import { BigMode } from './big-mode.js';
import { PicView } from './pic-view.js';
import { UiKit } from './ui-kit.js';
import { KpState } from '../core/state.js';

export const UI_PARTS = {
  AdminGearClicks,
  HelpLinkClicks,
  ContextMenu,
  ContextSections,
  AppKeys,
  TopBar,
  DatePicker,
  WorkCalendar,
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
  CondMemory,
  CondsStep,
  CoverStep,
  CoverSync,
  EquipStep,
  QuickFind,
  ManagerStep,
  PriceStep,
  Steps,
  Tender,
  TenderBlock,
  Tour,
  BigMode,
  PicView,
  UiKit,
};

Steps.restore();
Mobile.watch();
// титул КП — по оборудованию, перед записью черновика
KpState.onPersist(() => CoverSync.run());

// порядок обработчиков — как у прежних обычных скриптов (адрес, меню, быстрый поиск, условия, форма, телефон, даты)
GeoInput.listen();
Popups.listen();
FormView.listen();
QuickFind.listen();
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
