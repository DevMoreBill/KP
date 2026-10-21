import { StationRules } from './station-rules.js';
import { Toast } from '../../core/toast.js';
import { LazyJs } from '../../core/lazy-js.js';

export const RULES = { StationRules };

// «Инженерные правила и источники (DOCX)» в расчёте станции: документ — модулем по первому нажатию
if (typeof document !== 'undefined')
  document.addEventListener('click', event => {
    if (!event.target.closest?.('[data-rulesdoc]')) return;
    LazyJs.load('rules-doc/index.js')
      .then(({ StationRulesDoc }) => StationRulesDoc.download())
      .catch(err => Toast.show(err.message));
  });
