import { CrmFunnel } from './crm-funnel.js';
import { DealFieldsView } from './deal-fields.js';
import { LostPick } from './lost-pick.js';
import { MirrorPanel } from './mirror-panel.js';

export const CRM = { CrmFunnel, DealFieldsView, LostPick, MirrorPanel };

// мост для файлов интерфейса, ещё не переведённых в ES-модули
Object.assign(globalThis, CRM);
