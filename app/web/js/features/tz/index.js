import { StationSup } from './station-sup.js';
import { TzImport } from './tz-import.js';
import { TzPick } from './tz-pick.js';
import { TzQuestions } from './tz-questions.js';

export const TZ = { StationSup, TzImport, TzPick, TzQuestions };

// мост для файлов интерфейса, ещё не переведённых в ES-модули
Object.assign(globalThis, TZ);
