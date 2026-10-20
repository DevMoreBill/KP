import { ContainerKind } from './container-kind.js';
import { ContainerPart, StationModsText } from './container-part.js';
import { Kit } from './kit.js';
import { KitActions } from './kit-actions.js';
import { KitDoc } from './kit-doc.js';
import { KitCabinet, KitPipe } from './kit-fields.js';
import { CatFeatures, KitPart } from './kit-part.js';
import { KitPick, PickFilter, PickFind } from './kit-pick.js';
import { StationAuto, StationAutoVal, StationName } from './station-auto.js';
import { StationDefaults } from './station-defaults.js';
import { StationPurpose, StationSpec } from './station-spec.js';

export const KIT = {
  CatFeatures,
  ContainerKind,
  ContainerPart,
  Kit,
  KitActions,
  KitCabinet,
  KitDoc,
  KitPart,
  KitPick,
  KitPipe,
  PickFilter,
  PickFind,
  StationAuto,
  StationAutoVal,
  StationDefaults,
  StationModsText,
  StationName,
  StationPurpose,
  StationSpec,
};

// мост для файлов интерфейса, ещё не переведённых в ES-модули
Object.assign(globalThis, KIT);

KitActions.listen();
// списки контейнеров и состава — свои варианты администратора («Списки и выборы») подставляются после загрузки модуля
if (typeof LISTS !== 'undefined') LISTS.ready([...ContainerKind.LISTS, ...Kit.LISTS]);
