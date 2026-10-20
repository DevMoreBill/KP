import { LayoutEditor } from './layout-editor.js';
import { LayoutForm } from './layout-form.js';
import { RuleEdit } from './rule-edit.js';
import { RulesPanel } from './rules-panel.js';
import { StationRulesDoc } from './rules-doc.js';

export const RULES_DOC = { LayoutEditor, LayoutForm, RuleEdit, RulesPanel, StationRulesDoc };

// мост для файлов интерфейса, ещё не переведённых в ES-модули
Object.assign(globalThis, RULES_DOC);
