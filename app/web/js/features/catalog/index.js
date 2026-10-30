import { CatalogAnalogs } from './catalog-analogs.js';
import { AiChat, AiDirect, AiFileText, AiSource } from './ai-chat.js';
import { AiFill } from './ai-fill.js';
import { AiParse, SpecPaste } from './ai-parse.js';
import { AiPart } from './ai-part.js';
import { AiPrompt } from './ai-prompt.js';
import { AiTab } from './ai-tab.js';
import { AttrChoices, AttrsBlock, DimRow } from './attr-choices.js';
import { CatSections } from './cat-sections.js';
import { PriceAge } from './price-age.js';
import { CatalogActions } from './catalog-actions.js';
import { CatalogCache, CatalogSearch } from './catalog-cache.js';
import { CatalogCard } from './catalog-card.js';
import { CatalogClicks } from './catalog-clicks.js';
import { CatalogEditor, CatalogPrice } from './catalog-edit.js';
import { CatalogChanges, CatalogDrag, CatalogEvents } from './catalog-events.js';
import { CatalogBin, CatalogExportDlg, ClientsExportDlg } from './catalog-export.js';
import { CatalogFill, CatalogSync } from './catalog-fill.js';
import { CatalogFilter } from './catalog-filter.js';
import { CatalogIndex } from './catalog-index.js';
import { CatalogNav, CatalogTree } from './catalog-nav.js';
import { CatalogPanes } from './catalog-panes.js';
import { CatalogSorter } from './catalog-sorter.js';
import { Catalog, CatalogStore, CatFind } from './catalog-store.js';
import { CatalogWindow } from './catalog-window.js';
import { XlsId, XlsImport, XlsTable } from './excel-import.js';
import { FeedBadge } from './feed-badge.js';
import { ImageSlots, Logos } from './image-slots.js';
import { ImageFiles, ImgPrep } from './images.js';
import { ImageDrop, OptsBlock } from './item-blocks.js';
import { DescTab } from './item-desc.js';
import { EditorDrag, ItemEditor } from './item-editor.js';
import { ItemLinks } from './item-links.js';
import { ItemTabs } from './item-tabs.js';
import { MigrationNotice } from './migration-notice.js';
import { ModerationDiff } from './moderation-diff.js';
import { ModerationList, ModerationView } from './moderation.js';
import { NewTypeDialog } from './new-type.js';
import { PageImages } from './page-images.js';
import { Suppliers } from './suppliers.js';
import { GoodsTab, TrashTab } from './trash-tab.js';
import { TypeForm } from './type-form.js';
import { TypesEditor } from './types-editor.js';
import { LISTS } from '../../core/lists.js';
import { DefRegistry } from '../../core/defaults.js';
import { KpState } from '../../core/state.js';
import { AiOptions } from './ai-options.js';

export const CATALOG = {
  AiChat,
  AiDirect,
  AiFileText,
  AiFill,
  AiParse,
  AiPart,
  AiPrompt,
  AiSource,
  AiTab,
  AttrChoices,
  AttrsBlock,
  CatFind,
  CatSections,
  Catalog,
  CatalogActions,
  CatalogBin,
  CatalogCache,
  CatalogCard,
  CatalogChanges,
  CatalogClicks,
  CatalogDrag,
  CatalogEditor,
  CatalogEvents,
  CatalogExportDlg,
  CatalogFill,
  CatalogFilter,
  CatalogIndex,
  CatalogNav,
  CatalogPanes,
  CatalogPrice,
  CatalogSearch,
  CatalogSorter,
  CatalogStore,
  CatalogSync,
  CatalogTree,
  CatalogWindow,
  ClientsExportDlg,
  DescTab,
  DimRow,
  EditorDrag,
  FeedBadge,
  GoodsTab,
  ImageDrop,
  ImageFiles,
  ImageSlots,
  ImgPrep,
  ItemEditor,
  ItemLinks,
  ItemTabs,
  Logos,
  MigrationNotice,
  ModerationDiff,
  ModerationList,
  ModerationView,
  NewTypeDialog,
  OptsBlock,
  PageImages,
  SpecPaste,
  Suppliers,
  TrashTab,
  TypeForm,
  TypesEditor,
  XlsId,
  XlsImport,
  XlsTable,
};

// «Значения программы» — в прежнем порядке разделов
DefRegistry.add(...Catalog.DEFAULTS);
DefRegistry.add(...CatSections.DEFAULTS);
DefRegistry.add(...PriceAge.DEFAULTS);
DefRegistry.add(...CatalogAnalogs.DEFAULTS);
DefRegistry.add(...ImgPrep.DEFAULTS);
DefRegistry.add(...AiSource.DEFAULTS);

CatalogWindow.listen();
ClientsExportDlg.listen();
CatalogEditor.listen();
PageImages.listen();
ImageSlots.listen();
ItemEditor.listen();
AiSource.listen();
AiFill.listen();
AiOptions.listen();
// нейросети для автозаполнения — свои варианты администратора («Списки и выборы») подставляются после загрузки модуля
LISTS.ready(AiChat.LISTS);
// правка позиции каталога идёт в КП — черновик КП не пишется
KpState.paused = () => !!CatalogEditor.session;
