import { DealBind, DealClicks } from './deal-bind.js';
import { DealDrag } from './deal-drag.js';
import { DealCal } from './deal-cal.js';
import { DealCalcBase } from './deal-calc-base.js';
import { DealCalculator } from './deal-calculator.js';
import { DealCombo } from './deal-combo.js';
import { DealConds, DealLeadTime } from './deal-conds.js';
import { DealCosts } from './deal-costs.js';
import { DealCustoms } from './deal-customs.js';
import { DealDefaults, DealMoneyRate } from './deal-defaults.js';
import { DealFmt } from './deal-fmt.js';
import { DealHs, DealHsDir } from './deal-hs.js';
import { DealLogistics } from './deal-logistics.js';
import { DealMoney } from './deal-money.js';
import { DealOverview } from './deal-overview.js';
import { DealPay } from './deal-pay.js';
import { DealPresets } from './deal-presets.js';
import { DealPrice } from './deal-price.js';
import { DealPurchase, DealSupplierCard } from './deal-purchase.js';
import { DealResult } from './deal-result.js';
import { DealRows } from './deal-rows.js';
import { DealSchedule } from './deal-schedule.js';
import { DealScheduleView } from './deal-schedule-view.js';
import { DealPlan, DealSide, KpLines } from './deal-side.js';
import { DealState } from './deal-state.js';
import { DealSteps } from './deal-steps.js';
import { DealSuppliers } from './deal-suppliers.js';
import { DealTerms } from './deal-terms.js';
import { DealTimeline } from './deal-timeline.js';
import { DealUi } from './deal-ui.js';
import { DealValues } from './deal-values.js';
import { DealWin } from './deal-win.js';
import { DealXlsx } from './deal-xlsx.js';
import { DealXlsxCalc, DealXlsxSupplier } from './deal-xlsx-calc.js';
import { DealXlsxCustoms } from './deal-xlsx-customs.js';
import { DealXlsxGraph, DealXlsxResult } from './deal-xlsx-graph.js';
import { DealXlsxSummary } from './deal-xlsx-summary.js';
import { DealXlsxSummaryTables } from './deal-xlsx-tables.js';
import { Freight } from './freight.js';
import { FreightFacts } from './freight-facts.js';
import { FreightFields } from './freight-fields.js';
import { FreightFit } from './freight-fit.js';
import { FreightSettings, FreightSettingsView } from './freight-settings.js';
import { FreightTariffs } from './freight-tariffs.js';
import { LgBind } from './lg-bind.js';
import { LgCargoIn } from './lg-cargo-in.js';
import { LgCarrier } from './lg-carrier.js';
import { LgCities } from './lg-cities.js';
import { LgFmt } from './lg-fmt.js';
import { LgGeo } from './lg-geo.js';
import { LgMoney } from './lg-money.js';
import { LgOffers, LgOutlier } from './lg-offers.js';
import { LgState } from './lg-state.js';
import { LgTariffFile } from './lg-tariff-file.js';
import { LgValues } from './lg-values.js';
import { LgCard, LgView } from './lg-view.js';
import { SupplierCalc } from './supplier-calc.js';
import { TnVed } from './tn-ved.js';
import { LISTS } from '../../core/lists.js';
import { DefRegistry } from '../../core/defaults.js';
import { DealLink } from '../../core/deal-link.js';
import { DealDays } from './deal-days.js';
import { DealHsEdit } from './deal-hs-edit.js';
import { DealSupEdit } from './deal-sup-edit.js';
import { DealXlsxCell } from './deal-xlsx-cell.js';
import { LgAsk } from './lg-ask.js';

export const DEAL = {
  DealBind,
  DealCal,
  DealCalcBase,
  DealCalculator,
  DealClicks,
  DealCombo,
  DealConds,
  DealCosts,
  DealCustoms,
  DealDays,
  DealDefaults,
  DealDrag,
  DealFmt,
  DealHs,
  DealHsDir,
  DealHsEdit,
  DealLeadTime,
  DealLogistics,
  DealMoney,
  DealMoneyRate,
  DealOverview,
  DealPay,
  DealPlan,
  DealPresets,
  DealPrice,
  DealPurchase,
  DealResult,
  DealRows,
  DealSchedule,
  DealScheduleView,
  DealSide,
  DealState,
  DealSteps,
  DealSupEdit,
  DealSupplierCard,
  DealSuppliers,
  DealTerms,
  DealTimeline,
  DealUi,
  DealValues,
  DealWin,
  DealXlsx,
  DealXlsxCalc,
  DealXlsxCell,
  DealXlsxCustoms,
  DealXlsxGraph,
  DealXlsxResult,
  DealXlsxSummary,
  DealXlsxSummaryTables,
  DealXlsxSupplier,
  Freight,
  FreightFacts,
  FreightFields,
  FreightFit,
  FreightSettings,
  FreightSettingsView,
  FreightTariffs,
  KpLines,
  LgAsk,
  LgBind,
  LgCard,
  LgCargoIn,
  LgCarrier,
  LgCities,
  LgFmt,
  LgGeo,
  LgMoney,
  LgOffers,
  LgOutlier,
  LgState,
  LgTariffFile,
  LgValues,
  LgView,
  SupplierCalc,
  TnVed,
};

DealValues.register();
LgValues.register();
if (typeof document !== 'undefined' && document.addEventListener) DealRows.listen();
// страны поставщиков — свои варианты администратора («Списки и выборы») подставляются после загрузки модуля
LISTS.ready(DealTerms.LISTS);
DefRegistry.options(DealPresets.DEF_OPTS);
// КП и состав станции просят экономику сделки (DealLink) — без import экономики
DealLink.connect({
  render: () => DealWin.render(),
  open: () => DealWin.open(),
  summary: () => DealState.summary(),
  suppliers: () => DealUi.sups,
});
