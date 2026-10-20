import { StationRules } from './station-rules.js';

export const RULES = { StationRules };

// мост для файлов интерфейса, ещё не переведённых в ES-модули
Object.assign(globalThis, RULES);

// «Инженерные правила и источники (DOCX)» в расчёте станции: документ — модулем по первому нажатию
globalThis.document?.addEventListener('click', event => {
  if (!event.target.closest?.('[data-rulesdoc]')) return;
  LazyJs.load('rules-doc/index.js')
    .then(() => StationRulesDoc.download())
    .catch(err => toast(err.message));
});
