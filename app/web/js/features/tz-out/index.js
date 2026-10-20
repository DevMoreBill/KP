import { TzContainer } from './tz-container.js';
import { TzDoors } from './tz-doors.js';
import { TzOut } from './tz-out.js';
import { TzSystems } from './tz-systems.js';
import { TzText } from './tz-text.js';

export const TZ_OUT = { TzContainer, TzDoors, TzOut, TzSystems, TzText };

// мост для файлов интерфейса, ещё не переведённых в ES-модули
Object.assign(globalThis, TZ_OUT);
