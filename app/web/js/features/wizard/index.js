import { EquipWizard } from './equip-wizard.js';
import { NewStation } from './new-station.js';
import { WizardLink } from '../../core/wizard-link.js';

export const WIZARD = { EquipWizard, NewStation };

EquipWizard.listen();
// каталог просит «Добавить оборудование» (WizardLink) — без import мастера
WizardLink.connect({ open: (target, type) => EquipWizard.open(target, type) });
