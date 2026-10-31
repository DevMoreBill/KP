import { AsmActions } from './asm-actions.js';
import { AsmAi } from './asm-ai.js';
import { AsmBuilder } from './asm-builder.js';
import { AsmCatalog } from './asm-catalog.js';
import { AsmFacts } from './asm-facts.js';
import { AsmItem } from './asm-item.js';
import { AsmTab } from './asm-tab.js';
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
import { ReqChecks } from './req-checks.js';
import { StationAuto, StationAutoVal, StationName } from './station-auto.js';
import { StationDefaults } from './station-defaults.js';
import { StationPurpose, StationSpec } from './station-spec.js';
import { StationSup } from './station-sup.js';
import { StationWays } from './station-ways.js';
import { SupplyDocs } from './supply-docs.js';
import { TzFit } from './tz-fit.js';
import { TzPick } from './tz-pick.js';
import { EquipIcon } from '../eskd/equip-icon.js';
import { LISTS } from '../../core/lists.js';
import { KpState } from '../../core/state.js';
import { StationLink } from '../../core/station-link.js';
import { Kit } from '../../core/kit.js';
import { StationPlan } from '../req/station-plan.js';

export const KIT = {
  AsmActions,
  AsmAi,
  AsmBuilder,
  AsmCatalog,
  AsmFacts,
  AsmItem,
  AsmTab,
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
  ReqChecks,
  StationAuto,
  StationAutoVal,
  StationDefaults,
  StationModsText,
  StationName,
  StationPurpose,
  StationSpec,
  StationSup,
  StationWays,
  SupplyDocs,
  TzFit,
  TzPick,
};

KitActions.listen();
AsmBuilder.listen();
AsmActions.listen();
// списки состава — свои варианты администратора («Списки и выборы») подставляются после загрузки модуля
LISTS.ready(Kit.LISTS);
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
// листы ЕСКД берут картинку модели из кэша загруженных (DrawPic) — без import состава
EquipIcon.picture = src => DrawPic.data(src);
