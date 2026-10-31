import { AuthMenu, AuthScreen } from './auth-screen.js';
import { CbrRates, PricingBlock } from './cbr-rates.js';
import { ClientCard } from './client-card.js';
import { ClientFind, ClientMatchText } from './client-find.js';
import { ClientFields, ClientStore, Inn, OrgName, PartyFind } from './client-store.js';
import { ClientsImport } from './clients-import.js';
import { Discount } from './currency.js';
import { Drafts } from './drafts.js';
import { HelpWindow } from './help-window.js';
import { Journal, KpVersions } from './journal.js';
import { JournalEcon, JournalRow } from './journal-row.js';
import { KpFilesPanel } from './kp-files.js';
import { KpDiff, KpReport } from './kp-report.js';
import { KpReportView } from './kp-report-view.js';
import { KpRepeat } from './kp-repeat.js';
import { KpTrack } from './kp-track.js';
import { LoginForm } from './login-form.js';
import { MailDlg } from './mail-dlg.js';
import { Managers } from './managers.js';
import { MgrBar } from './mgr-bar.js';
import { MyDay } from './my-day.js';
import { MyPrefs } from './my-prefs.js';
import { NewKp } from './new-kp.js';
import { PartyCheck } from './party-check.js';
import { Presets } from './presets.js';
import { KpEconomics, PriceCalc } from './price-calc.js';
import { CatPrice, PriceHints, PriceHist } from './price-hints.js';
import { QuickSearch, RecentModels } from './quick-search.js';
import { KpLoader, Reminders } from './reminders.js';
import { UiTexts } from './ui-texts.js';
import { LISTS } from '../../core/lists.js';
import { Api } from '../../core/net.js';
import { MailTemplates } from './mail-templates.js';
import { DefRegistry } from '../../core/defaults.js';
import { KpGuard } from './kp-guard.js';
import { OptionCost } from './option-cost.js';
import { OptionSale } from './option-sale.js';
import { BackGuard } from '../../core/back-guard.js';
import { Currency } from '../../core/currency.js';
import { ShortName } from './short-name.js';
import { MgrLock } from './mgr-lock.js';

export const KP_PARTS = {
  OptionCost,
  OptionSale,
  AuthMenu,
  AuthScreen,
  CbrRates,
  PricingBlock,
  ClientCard,
  ClientFind,
  ClientMatchText,
  ClientFields,
  ClientStore,
  Inn,
  OrgName,
  PartyFind,
  ClientsImport,
  Currency,
  Discount,
  Drafts,
  HelpWindow,
  Journal,
  KpVersions,
  JournalEcon,
  JournalRow,
  ShortName,
  KpFilesPanel,
  KpDiff,
  KpReport,
  KpReportView,
  KpRepeat,
  KpTrack,
  LoginForm,
  MailDlg,
  Managers,
  MgrLock,
  MgrBar,
  MyDay,
  MyPrefs,
  NewKp,
  PartyCheck,
  Presets,
  KpEconomics,
  PriceCalc,
  CatPrice,
  PriceHints,
  PriceHist,
  QuickSearch,
  RecentModels,
  KpLoader,
  Reminders,
  UiTexts,
};

LISTS.ready({ ...ClientFields.LISTS, ...KpTrack.LISTS, ...MailTemplates.LISTS });
// подпись запросов — кто работает на этом устройстве
Api.who = () => Managers.who();
// «Мои настройки» менеджера — поверх «Значений программы»
DefRegistry.personal = key => MyPrefs.def(key);

UiTexts.listen();
KpGuard.listen();
OptionCost.listen();
OptionSale.listen();
BackGuard.listen(() => !!Drafts.pending());
MgrBar.listen();
ClientFind.listen();
ClientsImport.listen();
ClientCard.listen();
KpFilesPanel.listen();
QuickSearch.listen();
Reminders.listen();
MyDay.listen();
MyPrefs.listen();
AuthScreen.listen();
// личные настройки стоят на менеджерах — смена менеджера зовёт их портом
Managers.changed = () => MyPrefs.load();
// «Мои настройки» открываются во вкладке кабинета — кабинет стоит на настройках
MyPrefs.day = { enabled: () => MyDay.enabled(), open: tab => MyDay.open(tab) };
// курсы ЦБ: валюты опций и пересчёт их цен — регистрацией (опции стоят на курсах)
CbrRates.uses = items => [...OptionCost.currencies(items), ...OptionSale.currencies(items)];
CbrRates.synced = () => OptionSale.syncAll();
// напоминания стоят на отметках по КП — сохранённая отметка зовёт их портом
KpTrack.saved = () => Reminders.load();
// закрепление менеджера входом стоит на справочнике — загрузка справочника зовёт его портом
Managers.pin = () => MgrLock.apply();
