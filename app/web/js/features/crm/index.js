import { CrmFmt, DateChips } from './crm-fmt.js';
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
import { DealFieldsView } from './deal-fields.js';
import { LostPick } from './lost-pick.js';
import { MirrorPanel } from './mirror-panel.js';

export const CRM = {
  CrmFmt,
  DateChips,
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
  DealFieldsView,
  LostPick,
  MirrorPanel,
};

// мост для файлов интерфейса, ещё не переведённых в ES-модули
Object.assign(globalThis, CRM);
LISTS.ready(CrmStages.LISTS);
