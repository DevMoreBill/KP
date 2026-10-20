import { EquipWizard } from './equip-wizard.js';
import { NewStation } from './new-station.js';

export const WIZARD = { EquipWizard, NewStation };

// мост для файлов интерфейса, ещё не переведённых в ES-модули
Object.assign(globalThis, WIZARD);

EquipWizard.listen();
