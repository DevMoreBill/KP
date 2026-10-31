/** Состояние редактора шаблона КП: шаблон, форма, правка, вкладка, ошибка (редактор и его поля). */
export class TemplateState {
  static state = { id: '', pack: null, form: null, work: null, dirty: false, tab: '', err: '', note: '' };
}
