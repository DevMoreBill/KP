import { EquipIcon } from './equip-icon.js';
import { EskdFont } from './eskd-font.js';
import { EskdFrame } from './eskd-frame.js';
import { EskdSheet } from './eskd-sheet.js';
import { HydroScheme } from './hydro-scheme.js';
import { IconAir } from './icon-air.js';
import { IconParts } from './icon-parts.js';
import { IconUnits } from './icon-units.js';
import { PneuSymbol } from './pneu-symbol.js';
import { SchemeLayout } from './scheme-layout.js';
import { SchemeUnits } from './scheme-units.js';
import { StationScheme } from './station-scheme.js';

export const ESKD = {
  EquipIcon,
  EskdFont,
  EskdFrame,
  EskdSheet,
  HydroScheme,
  IconAir,
  IconParts,
  IconUnits,
  PneuSymbol,
  SchemeLayout,
  SchemeUnits,
  StationScheme,
};

// мост для файлов интерфейса, ещё не переведённых в ES-модули
Object.assign(globalThis, ESKD);
