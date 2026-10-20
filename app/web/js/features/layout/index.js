import { AirChain } from './air-chain.js';
import { AirCheck } from './air-check.js';
import { LayoutAccess } from './layout-access.js';
import { LayoutDgu } from './layout-dgu.js';
import { LayoutDigest } from './layout-digest.js';
import { LayoutExits } from './layout-exits.js';
import { LayoutGates } from './layout-gates.js';
import { LayoutItem } from './layout-item.js';
import { LayoutJoints } from './layout-joints.js';
import { LayoutMode } from './layout-mode.js';
import { LayoutNotes } from './layout-notes.js';
import { LayoutOpening } from './layout-opening.js';
import { LayoutParams } from './layout-params.js';
import { LayoutPipes } from './layout-pipes.js';
import { LayoutRoof } from './layout-roof.js';
import { LayoutRows } from './layout-rows.js';
import { LayoutSize } from './layout-size.js';
import { LayoutTank } from './layout-tank.js';
import { LayoutWalls } from './layout-walls.js';
import { Mm } from './mm.js';
import { Num } from './num.js';
import { PipeMaterial } from './pipe-material.js';
import { PressureVessel } from './pressure-vessel.js';
import { RalColor } from './ral-color.js';
import { ReceiverPlan } from './receiver-plan.js';
import { StWalls } from './st-walls.js';
import { StationClear } from './station-clear.js';
import { StationEquip } from './station-equip.js';
import { StationFire } from './station-fire.js';
import { StationGeo } from './station-geo.js';
import { StationHeat } from './station-heat.js';
import { StationJoints } from './station-joints.js';
import { StationLayout } from './station-layout.js';
import { StationLight } from './station-light.js';
import { StationMass } from './station-mass.js';
import { StationMatrix } from './station-matrix.js';
import { StationMods } from './station-mods.js';
import { StationNorms } from './station-norms.js';
import { StationPaint } from './station-paint.js';
import { StationPipe } from './station-pipe.js';
import { StationPower } from './station-power.js';
import { StationSockets } from './station-sockets.js';
import { StationTidy } from './station-tidy.js';
import { StationVent } from './station-vent.js';
import { TankSize } from './tank-size.js';
import { VentCalc } from './vent-calc.js';
import { VentGrille } from './vent-grille.js';
import { VentIntake } from './vent-intake.js';
import { VentPlan } from './vent-plan.js';

export const LAYOUT = {
  AirChain,
  AirCheck,
  LayoutAccess,
  LayoutDgu,
  LayoutDigest,
  LayoutExits,
  LayoutGates,
  LayoutItem,
  LayoutJoints,
  LayoutMode,
  LayoutNotes,
  LayoutOpening,
  LayoutParams,
  LayoutPipes,
  LayoutRoof,
  LayoutRows,
  LayoutSize,
  LayoutTank,
  LayoutWalls,
  Mm,
  Num,
  PipeMaterial,
  PressureVessel,
  RalColor,
  ReceiverPlan,
  StWalls,
  StationClear,
  StationEquip,
  StationFire,
  StationGeo,
  StationHeat,
  StationJoints,
  StationLayout,
  StationLight,
  StationMass,
  StationMatrix,
  StationMods,
  StationNorms,
  StationPaint,
  StationPipe,
  StationPower,
  StationSockets,
  StationTidy,
  StationVent,
  TankSize,
  VentCalc,
  VentGrille,
  VentIntake,
  VentPlan,
};

// мост для файлов интерфейса, ещё не переведённых в ES-модули
Object.assign(globalThis, LAYOUT);
