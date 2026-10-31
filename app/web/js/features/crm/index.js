import { CrmStages, CrmData } from './crm-data.js';
import { CrmFunnel } from './crm-funnel.js';
import { CrmTask } from './crm-task.js';
import { Cabinet } from './cabinet.js';
import { CabToday } from './cab-today.js';
import { CabDeals } from './cab-deals.js';
import { CabGantt } from './cab-gantt.js';
import { CabClients } from './cab-clients.js';
import { CabTeam } from './cab-team.js';
import { CabGuide } from './cab-guide.js';
import { DealCard } from './deal-card.js';
import { DealNew } from './deal-new.js';
import { DealKp } from './deal-kp.js';
import { DealPick } from './deal-pick.js';
import { DealExec } from './deal-exec.js';
import { DealParts } from './deal-parts.js';
import { DealNow } from './deal-now.js';
import { DealClient } from './deal-client.js';
import { ClientSuggest } from './client-suggest.js';
import { DealFieldsView } from './deal-fields.js';
import { LostPick } from './lost-pick.js';
import { PhoneCall } from './phone-call.js';
import { CabState } from './cab-state.js';
import { CallResult } from './call-result.js';
import { LISTS } from '../../core/lists.js';
import { CrmFmt } from '../../core/crm-fmt.js';
import { CabinetLink } from '../../core/cabinet-link.js';

export const CRM = {
  CrmStages,
  CrmData,
  CrmFunnel,
  CrmTask,
  Cabinet,
  CabToday,
  CabDeals,
  CabGantt,
  CabClients,
  CabTeam,
  CabGuide,
  DealCard,
  DealNew,
  DealKp,
  DealPick,
  DealExec,
  DealParts,
  DealNow,
  DealClient,
  ClientSuggest,
  DealFieldsView,
  LostPick,
  PhoneCall,
};

LISTS.ready(CrmStages.LISTS);
PhoneCall.listen();
// КП просит кабинет (CabinetLink) — без import кабинета
CabinetLink.connect({
  open: tab => Cabinet.open(tab),
  openFreeDeals: () => {
    CabDeals.filter = 'free';
    return Cabinet.open('deals');
  },
  openDeal: id => DealCard.open(id),
  lastDeal: () => DealCard.last(),
  reloadDealOf: clientId => {
    if (DealCard.modal && DealCard.deal && DealCard.deal.clientId === clientId) DealCard.reload();
  },
  deals: () => CrmData.deals(),
  closed: deal => CrmFunnel.closed(deal),
  stageLabel: deal => CrmFunnel.label(deal),
});
document.addEventListener(CrmFmt.REDRAW, () => Cabinet.redraw());
// окно кабинета, «Итог звонка», карточка сделки и воронки доски — регистрацией (разделы кабинета, дела, КП сделки
// и воронки их не подключают — циклы import)
CabState.connect({
  dlg: () => Cabinet.dlg(),
  reload: () => Cabinet.reload(),
  render: () => Cabinet.render(),
  renderBody: () => Cabinet.renderBody(),
  show: tab => Cabinet.show(tab),
});
CrmTask.callResult = (taskId, dealId, after) => CallResult.ask(taskId, dealId, after);
DealKp.closeCard = () => DealCard.close();
CrmFunnel.boardFunnels = () => CrmData.board && CrmData.board.funnels;
