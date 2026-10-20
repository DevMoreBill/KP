// Прежние имена для ещё не переписанных обычных скриптов и других разделов (они вызывают их только внутри функций) и для
// прогона интерфейса (tests/ui/progon.py). Переписанный файл обращается к классам напрямую, а имя отсюда убирается,
// когда его никто не вызывает.
import { FormView } from './form-view.js';
import { Mobile } from './mobile.js';
import { Problems, SidePanel } from './side-panel.js';
import { CondMemory } from './step-conds.js';
import { CoverSync } from './step-cover.js';
import { QuickFind } from './step-equipment.js';
import { Steps } from './steps.js';
import { Tender } from './tender.js';
import { UiKit } from './ui-kit.js';

export const tip = html => UiKit.tip(html);
export const field = (label, path, opts) => UiKit.field(label, path, opts);
export const renderForm = () => FormView.render();
export const goStep = (id, target) => Steps.open(id, target);
export const problems = () => Problems.list();
export const updateLive = () => SidePanel.updateLive();
export const isMob = () => Mobile.isPhone();
export const tenderNo = () => Tender.number();
export const tenderUrl = () => Tender.url();
export const quickMatches = query => QuickFind.matches(query);
export const addFromCatalog = card => QuickFind.add(card);
export const coverSync = () => CoverSync.run();
export const rememberConds = () => CondMemory.remember();
