import { ExpertFix } from './expert-fix.js';
import { IssueSpot } from './issue-spot.js';
import { LayoutTab } from './layout-tab.js';
import { Spoiler } from './spoiler.js';
import { StationDesign } from './station-design.js';
import { StationBrief, StationDoc } from './station-doc.js';
import { StationImages } from './station-images.js';
import { StationModsUi } from './station-mods-ui.js';
import { StationParams } from './station-params.js';
import { StationQuick } from './station-quick.js';
import { StationSize } from './station-size.js';
import { StationUi } from './station-ui.js';

export const STATION = {
  ExpertFix,
  IssueSpot,
  LayoutTab,
  Spoiler,
  StationBrief,
  StationDesign,
  StationDoc,
  StationImages,
  StationModsUi,
  StationParams,
  StationQuick,
  StationSize,
  StationUi,
};

// мост для файлов интерфейса, ещё не переведённых в ES-модули
Object.assign(globalThis, STATION);

Spoiler.listen();
StationQuick.listen();
StationBrief.listen();
StationUi.listen();
