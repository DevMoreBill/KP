import { AdminApi, AdminDialog, AdminState, AuditLabels } from './admin-core.js';
import { AdminNav } from './admin-nav.js';
import { AdminSystem } from './admin-system.js';
import { BackupTab } from './backup-tab.js';
import { BitrixFlow, BitrixLink, BitrixSchedule, BitrixSend } from './bitrix-link.js';
import { BitrixPanel } from './bitrix-panel.js';
import { BitrixFields, BitrixLog, BitrixManagers, BitrixOld, BitrixStages } from './bitrix-tabs.js';
import { ChinaFreightTab } from './china-freight.js';
import { ChinaRateBook } from './china-rates.js';
import { CatFilterPane, DataTransfer, DbHealthCard, SupplierExport } from './data-transfer.js';
import { DefaultsTab } from './defaults-tab.js';
import { DirEditor, DocPath } from './dir-editor.js';
import { FeedDiscounts } from './feed-disc.js';
import { FeedActions, FeedFiles, FeedForm, FeedPanel } from './feed-panel.js';
import { FeedPurgeUi, FeedRulesUi } from './feed-rules.js';
import { FeedFmt, FeedState } from './feed-state.js';
import { FeedJob, FeedLog, FeedPreview } from './feed-view.js';
import { FeedsTab } from './feeds-tab.js';
import { FeaturesPanel, ListsPanel, TextsPanel } from './lists-panel.js';
import { DbMaint, MigrationsCard } from './maint-card.js';
import { MakerLogoPanel } from './maker-logos.js';
import { CatalogTool, RecordEdit, RecordsTab } from './records-tab.js';
import { AuditTab, ModerationTab, StatsTab } from './review-tabs.js';
import { AiTab, MailTab, TemplatesTab, TypesTab } from './service-tabs.js';
import { SettingsFileCard } from './settings-file.js';
import { AlertsCard, ChangedPanel, ConnectionsPanel, MirrorCard, SettingsHistoryPanel } from './settings-panels.js';
import { StDirty, StNav, StRefresh, StVal, SettingsSearch } from './settings-tools.js';
import { AdminLogin, SettingsWindow } from './settings-window.js';
import { AccessPanel, AdminsTab, SecurityTab } from './staff-tabs.js';

export const ADMIN_UI = {
  AdminApi,
  AdminDialog,
  AdminState,
  AuditLabels,
  AdminNav,
  AdminSystem,
  BackupTab,
  BitrixFlow,
  BitrixLink,
  BitrixSchedule,
  BitrixSend,
  BitrixPanel,
  BitrixFields,
  BitrixLog,
  BitrixManagers,
  BitrixOld,
  BitrixStages,
  ChinaFreightTab,
  ChinaRateBook,
  CatFilterPane,
  DataTransfer,
  DbHealthCard,
  SupplierExport,
  DefaultsTab,
  DirEditor,
  DocPath,
  FeedDiscounts,
  FeedActions,
  FeedFiles,
  FeedForm,
  FeedPanel,
  FeedPurgeUi,
  FeedRulesUi,
  FeedFmt,
  FeedState,
  FeedJob,
  FeedLog,
  FeedPreview,
  FeedsTab,
  FeaturesPanel,
  ListsPanel,
  TextsPanel,
  DbMaint,
  MigrationsCard,
  MakerLogoPanel,
  CatalogTool,
  RecordEdit,
  RecordsTab,
  AuditTab,
  ModerationTab,
  StatsTab,
  AiTab,
  MailTab,
  TemplatesTab,
  TypesTab,
  SettingsFileCard,
  AlertsCard,
  ChangedPanel,
  ConnectionsPanel,
  MirrorCard,
  SettingsHistoryPanel,
  StDirty,
  StNav,
  StRefresh,
  StVal,
  SettingsSearch,
  AdminLogin,
  SettingsWindow,
  AccessPanel,
  AdminsTab,
  SecurityTab,
};

// прежние имена для файлов, ещё не переведённых в ES-модули (вызываются только внутри их функций)
export const aapi = (path, opts) => AdminApi.get(path, opts);
export const ajson = (path, body) => AdminApi.post(path, body);
export const stConfirm = (title, text, ok) => AdminDialog.confirm(title, text, ok);
export const openSettings = tab => SettingsWindow.open(tab);
export const setDlg = () => SettingsWindow.dialog();
export const stCatalogTool = action => CatalogTool.run(action);
export const stVal = value => AuditLabels.value(value);
export const ENT = AuditLabels.ENT;

// мост для файлов интерфейса, ещё не переведённых в ES-модули
Object.assign(globalThis, ADMIN_UI, { aapi, ajson, stConfirm, openSettings, setDlg, stCatalogTool, stVal, ENT });

SettingsWindow.listen();
