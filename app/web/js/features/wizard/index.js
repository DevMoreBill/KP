import { EquipWizard } from './equip-wizard.js';
import { NewStation } from './new-station.js';
import { WizardLink } from '../../core/wizard-link.js';
import { WizardState } from './wizard-state.js';

export const WIZARD = { EquipWizard, NewStation };

EquipWizard.listen();
// каталог и состав станции просят «Добавить оборудование» (WizardLink) — без import мастера
WizardLink.connect({ open: (target, type, from) => EquipWizard.open(target, type, from) });
// шаг «Новая станция» зовёт окно мастера портом (окно подключает шаг)
WizardState.connect({
  state: () => EquipWizard.state,
  draw: () => EquipWizard.draw(),
  finish: (item, kind, after) => EquipWizard.finish(item, kind, after),
});
