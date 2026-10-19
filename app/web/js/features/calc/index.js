import { AirDemand } from './air-demand.js';
import { CalcInput } from './calc-input.js';
import { CalcNote } from './calc-note.js';
import { DryerSizing } from './dryer-sizing.js';
import { ElectricLoad } from './electric-load.js';
import { FilterSizing } from './filter-sizing.js';
import { GensetSizing } from './genset-sizing.js';
import { PressureBudget } from './pressure-budget.js';
import { PumpSizing } from './pump-sizing.js';
import { ReceiverSizing } from './receiver-sizing.js';
import { StationCalc } from './station-calc.js';
import { VentSizing } from './vent-sizing.js';

export const CALC = {
  AirDemand,
  CalcInput,
  CalcNote,
  DryerSizing,
  ElectricLoad,
  FilterSizing,
  GensetSizing,
  PressureBudget,
  PumpSizing,
  ReceiverSizing,
  StationCalc,
  VentSizing,
};

// мост для файлов интерфейса, ещё не переведённых в ES-модули
Object.assign(globalThis, CALC);
