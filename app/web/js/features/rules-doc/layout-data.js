import { MatrixDefaults } from '../layout/matrix-defaults.js';

/** Данные правил компоновки для редактора и формы: правило по номеру, копия значения, матрица поверх значений. */
export class LayoutData {
  /** Правило id из файла правил data. */
  static rule(data, id) {
    return (data?.rules || []).find(entry => entry.id === id);
  }

  /** Копия значения правила (правка не трогает исходное). */
  static copy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /** Матрица v поверх значений программы (недостающее — из MatrixDefaults.DEF). */
  static merge(value) {
    const defs = MatrixDefaults.DEF;
    const src = value && typeof value === 'object' ? value : {};
    const merged = {};
    for (const k of Object.keys(defs)) {
      merged[k] = LayoutData.copy(src[k] && typeof src[k] === 'object' ? { ...defs[k], ...src[k] } : defs[k]);
    }
    return merged;
  }
}
