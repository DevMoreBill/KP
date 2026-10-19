import { AirChain } from './air-chain.js';
import { AirCheck } from './air-check.js';
import { LayoutDigest } from './layout-digest.js';
import { LayoutItem } from './layout-item.js';
import { LayoutParams } from './layout-params.js';
import { LayoutPipes } from './layout-pipes.js';
import { Mm } from './mm.js';
import { PipeMaterial } from './pipe-material.js';
import { PressureVessel } from './pressure-vessel.js';
import { RalColor } from './ral-color.js';
import { ReceiverPlan } from './receiver-plan.js';
import { StationClear } from './station-clear.js';
import { StationEquip } from './station-equip.js';
import { StationGeo } from './station-geo.js';
import { StationHeat } from './station-heat.js';
import { StationMatrix } from './station-matrix.js';
import { StationMods } from './station-mods.js';
import { StationNorms } from './station-norms.js';
import { StationPaint } from './station-paint.js';
import { StationTidy } from './station-tidy.js';
import { TankSize } from './tank-size.js';

export const LAYOUT = {
  AirChain,
  AirCheck,
  LayoutDigest,
  LayoutItem,
  LayoutParams,
  LayoutPipes,
  Mm,
  PipeMaterial,
  PressureVessel,
  RalColor,
  ReceiverPlan,
  StationClear,
  StationEquip,
  StationGeo,
  StationHeat,
  StationMatrix,
  StationMods,
  StationNorms,
  StationPaint,
  StationTidy,
  TankSize,
};

// мост для файлов интерфейса, ещё не переведённых в ES-модули
Object.assign(globalThis, LAYOUT);
