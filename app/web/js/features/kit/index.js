import { AsmActions } from './asm-actions.js';
import { AsmAi } from './asm-ai.js';
import { AsmBuilder } from './asm-builder.js';
import { AsmCatalog } from './asm-catalog.js';
import { AsmFacts } from './asm-facts.js';
import { AsmItem } from './asm-item.js';
import { AsmTab } from './asm-tab.js';
import { ContainerKind } from './container-kind.js';
import { ContainerPart, StationModsText } from './container-part.js';
import { DrawPic } from './draw-pic.js';
import { KitActions } from './kit-actions.js';
import { KitContainer } from './kit-container.js';
import { KitDoc } from './kit-doc.js';
import { KitCabinet, KitPipe } from './kit-fields.js';
import { KitNeed } from './kit-need.js';
import { KitPart } from './kit-part.js';
import { KitPick, PickFilter, PickFind } from './kit-pick.js';
import { KitScope } from './kit-scope.js';
import { KitView } from './kit-view.js';
import { NeedPick } from './need-pick.js';
import { PaintView } from './paint-view.js';
import { StationAuto, StationAutoVal, StationName } from './station-auto.js';
import { StationDefaults } from './station-defaults.js';
import { StationPurpose, StationSpec } from './station-spec.js';
import { SupplyDocs } from './supply-docs.js';
import { LISTS } from '../../core/lists.js';
import { DefRegistry } from '../../core/defaults.js';
import { KpState } from '../../core/state.js';
import { StationPlan } from './station-plan.js';
import { StationLink } from '../../core/station-link.js';
import { Kit } from '../../core/kit.js';

export const KIT = {
  AsmActions,
  AsmAi,
  AsmBuilder,
  AsmCatalog,
  AsmFacts,
  AsmItem,
  AsmTab,
  ContainerKind,
  ContainerPart,
  DrawPic,
  KitActions,
  KitCabinet,
  KitContainer,
  KitDoc,
  KitNeed,
  KitPart,
  KitPick,
  KitPipe,
  KitScope,
  KitView,
  NeedPick,
  PaintView,
  PickFilter,
  PickFind,
  StationAuto,
  StationAutoVal,
  StationDefaults,
  StationModsText,
  StationName,
  StationPurpose,
  StationSpec,
  SupplyDocs,
};

KitActions.listen();
AsmBuilder.listen();
AsmActions.listen();
// списки контейнеров и состава — свои варианты администратора («Списки и выборы») подставляются после загрузки модуля
LISTS.ready({ ...ContainerKind.LISTS, ...Kit.LISTS });
DefRegistry.options(ContainerKind.DEF_OPTS);
// закупка сборки — по текущим курсам; параметры станции — по составу (перед записью черновика КП)
KpState.onItem(item => {
  Kit.sync(item);
  StationAuto.fill(item);
  StationName.apply(item);
});
// каталог (карточка позиции, заполнение с ИИ) просит состав станции (StationLink) — без import состава
StationLink.connect({
  enabled: item => StationPlan.enabled(item),
  kitTab: (item, i) => (Kit.simple(item) ? AsmTab.html(item, i) : KitView.render(item, i)),
  kitLabel: (item, label) => AsmTab.label(item, label),
  drawHtml: (item, i) => DrawPic.forItem(item, i),
  uploadDraw: (draw, doc) => DrawPic.upload(draw, doc),
  autoFill: item => StationAuto.fill(item),
  container: kind => ContainerPart.create(kind),
});
