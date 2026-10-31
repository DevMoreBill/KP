/** Состояние окна «Настройки»: вкладка, выбор записей, журнал действий, график, вход администратора, открытая карточка. */
export class AdminState {
  static tab = 'home';
  static del = { type: 'kp', q: '', sel: new Set() };
  static audit = { page: 0, f: {} };
  static imp = null;
  static chart = 'day';
  static chartOpen = false;
  static status = null;
  static editing = null;
}
