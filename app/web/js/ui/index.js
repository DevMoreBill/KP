import { AdminGearClicks } from './admin-gear.js';
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
import { UiKit } from './ui-kit.js';

export const UI_PARTS = {
  AdminGearClicks,
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
  UiKit,
};

Steps.restore();
Mobile.watch();

// порядок обработчиков — как у прежних обычных скриптов (адрес, меню, быстрый поиск, условия, форма, телефон, даты)
GeoInput.listen();
Popups.listen();
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
