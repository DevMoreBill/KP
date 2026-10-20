import { ContainerKind } from './container-kind.js';
import { ContainerPart, StationModsText } from './container-part.js';
import { Kit } from './kit.js';
import { DrawPic } from './draw-pic.js';
import { KitActions } from './kit-actions.js';
import { KitContainer } from './kit-container.js';
import { KitDoc } from './kit-doc.js';
import { KitCabinet, KitPipe } from './kit-fields.js';
import { KitNeed } from './kit-need.js';
import { CatFeatures, KitPart } from './kit-part.js';
import { KitPick, PickFilter, PickFind } from './kit-pick.js';
import { KitScope } from './kit-scope.js';
import { KitView } from './kit-view.js';
import { NeedPick } from './need-pick.js';
import { PaintView } from './paint-view.js';
import { StationAuto, StationAutoVal, StationName } from './station-auto.js';
import { StationDefaults } from './station-defaults.js';
import { StationPurpose, StationSpec } from './station-spec.js';
import { SupplyDocs } from './supply-docs.js';

export const KIT = {
  CatFeatures,
  ContainerKind,
  ContainerPart,
  DrawPic,
  Kit,
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

// мост для файлов интерфейса, ещё не переведённых в ES-модули
Object.assign(globalThis, KIT);

KitActions.listen();
// списки контейнеров и состава — свои варианты администратора («Списки и выборы») подставляются после загрузки модуля
if (typeof LISTS !== 'undefined') LISTS.ready([...ContainerKind.LISTS, ...Kit.LISTS]);
