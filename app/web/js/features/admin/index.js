import { AdminState } from './admin-state.js';
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
import { StDirty, StNav, StRefresh, StVal } from './settings-tools.js';
import { SettingsSearch } from './settings-search.js';
import { AdminLogin, SettingsWindow } from './settings-window.js';
import { AccessPanel, AdminsTab, SecurityTab } from './staff-tabs.js';
import { GoodsTab, TrashTab } from './trash-tab.js';
import { MirrorPanel } from './mirror-panel.js';
import { ApiKeys } from './api-keys.js';
import { CarrierApis } from './carrier-apis.js';
import { KeyBackup } from './key-backup.js';
import { AdminApi } from '../../core/admin-api.js';
import { AuthScreen } from '../kp/auth-screen.js';
import { BitrixViews, BitrixMirror } from './bitrix-views.js';
import { BackupKit } from './backup-kit.js';

export const ADMIN_UI = {
  AdminState,
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
  GoodsTab,
  TrashTab,
  MirrorPanel,
  ApiKeys,
  CarrierApis,
  KeyBackup,
  BitrixViews,
  BitrixMirror,
  BackupKit,
};

SettingsWindow.listen();
StDirty.listen();
// «Настройки» — верхний раздел (КП, каталог, сделка и кабинет их не подключают): вход администратора с экрана входа
// и форма входа после истёкшей сессии подключаются здесь
AdminApi.onExpired = () => SettingsWindow.render();
AuthScreen.openSettings = () => SettingsWindow.open();
// окно «Настроек», вкладки раздела «Битрикс24», вкладка фидов и вкладка «База и копии» — регистрацией (вкладки и панели
// их не подключают — циклы import)
AdminState.connect({
  dialog: () => SettingsWindow.dialog(),
  show: opts => SettingsWindow.tab(opts),
  route: key => AdminNav.route(key),
  tabKey: key => AdminNav.key(key),
});
BitrixPanel.views = () => BitrixViews.of();
FeedState.redraw = main => FeedsTab.render(main);
BackupKit.connect({
  summary: () => BackupTab.summary(),
  redirect: (kind, file) => BackupTab.redirect(kind, file),
});
