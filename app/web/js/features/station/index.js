import { ExpertFix } from './expert-fix.js';
import { IssueSpot } from './issue-spot.js';
import { LayoutTab } from './layout-tab.js';
import { StationImages } from './station-images.js';
import { StationModsUi } from './station-mods-ui.js';
import { StationQuick } from './station-quick.js';
import { StationSteps } from './station-steps.js';
import { StationUi } from './station-ui.js';
import { Spoiler } from '../../core/spoiler.js';
import { StationLink } from '../../core/station-link.js';
import { StationDesign } from '../kit/station-design.js';
import { StationBrief } from './station-brief.js';
import { StationDoc } from '../kit/station-doc.js';
import { StationParams } from '../kit/station-params.js';
import { StationSize } from '../kit/station-size.js';
import { KitView } from '../kit/kit-view.js';

export const STATION = {
  ExpertFix,
  IssueSpot,
  LayoutTab,
  StationBrief,
  StationDesign,
  StationDoc,
  StationImages,
  StationModsUi,
  StationParams,
  StationQuick,
  StationSize,
  StationSteps,
  StationUi,
};

Spoiler.listen();
StationQuick.listen();
StationSteps.listen();
StationBrief.listen();
StationUi.listen();
StationImages.listen();
// быстрый подбор под составом станции — раздел подбора подключает себя (состав не подключает подбор)
KitView.stationQuick = (item, index) => StationQuick.html(item, index);
// каталог (карточка позиции) просит подбор станции (StationLink) — без import подбора
StationLink.connect({
  layoutTab: (item, i) => StationUi.tab(item, i),
  layoutBadge: item => StationUi.badge(item),
  syncImages: () => StationImages.syncAll(),
  soonImages: item => StationImages.soon(item),
  brief: (item, i) => StationBrief.html(item, i),
});
