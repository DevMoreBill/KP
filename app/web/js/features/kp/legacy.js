// Прежние имена для ещё не переписанных обычных скриптов (настройки, каталог, сделка, документ, ui/, core/, main.js):
// они вызывают их только внутри функций. Переписанный файл обращается к классам напрямую, а имя отсюда убирается,
// когда его не вызывает ни один обычный скрипт.
import { Auth } from './auth.js';
import { CbrRates, PricingBlock } from './cbr-rates.js';
import { ClientsImport } from './clients-import.js';
import { ClientFields, ClientStore, Inn, PartyFind } from './client-store.js';
import { Currency, Discount } from './currency.js';
import { HelpWindow } from './help-window.js';
import { Journal } from './journal.js';
import { ShortName } from './journal-row.js';
import { KpTrack } from './kp-track.js';
import { Managers } from './managers.js';
import { KpEconomics, PriceCalc } from './price-calc.js';
import { PriceHints } from './price-hints.js';
import { UiTexts } from './ui-texts.js';

export const AUTH = Auth.state;
export const authLoad = () => Auth.load();
export const can = perm => Auth.can(perm);
export const cannot = perm => Auth.cannot(perm);

export const MGR_KEYS = Managers.KEYS;
export const meId = () => Managers.meId();
export const meName = () => Managers.meName();
export const loadManagers = () => Managers.load();
// docx/build.js: свежие контакты менеджера — в справочник перед записью КП, без сообщений
export const saveManager = () => Managers.saveQuiet();

export const KP_STATUS = KpTrack.STATUS;
export const PURPOSES = ClientFields.PURPOSES;
export const jShort = name => ShortName.of(name);
export const openJournal = () => Journal.open();
export const openClientsImport = () => ClientsImport.open();
export const validInn = value => Inn.valid(value);
export const loadClients = () => ClientStore.load();
export const clientsKeep = list => ClientStore.keep(list);
export const clientById = id => ClientStore.byId(id);
export const curClient = () => ClientStore.current();
// docx/build.js: клиент сохранённого КП — в справочник (контакты накапливаются)
export const saveClient = () => ClientStore.saveUsed();
export const partyFind = () => PartyFind.run();

export const CUR_LIST = Currency.LIST;
export const curSh = code => Currency.short(code);
export const kpCur = () => Currency.current();
export const rateOf = code => Currency.rate(code);
export const kpSetCur = code => Currency.setKp(code);
export const discType = item => Discount.type(item);
export const discText = item => Discount.text(item);
export const setDisc = (item, text) => Discount.set(item, text);
export const roundTo = kopecks => PriceCalc.round(kopecks);
export const applyCalc = item => PriceCalc.apply(item);
export const kpEconomics = state => KpEconomics.of(state);
export const priceHint = item => PriceHints.of(item);
export const liveMargin = index => PriceHints.live(index);
export const autoRates = () => CbrRates.auto();
export const loadCBR = emptyOnly => (emptyOnly ? CbrRates.fillEmpty() : CbrRates.load());
export const pricingBlock = () => PricingBlock.html();

export const UIT = UiTexts.state;
export const uitNorm = text => UiTexts.norm(text);
export const uitLoad = () => UiTexts.load();
export const uitIndex = () => UiTexts.index();
export const uitApply = (root, map) => UiTexts.apply(root, map);
export const uitToggle = edit => {
  if (edit == null) UiTexts.toggle();
  else if (edit) UiTexts.startEdit();
  else UiTexts.stopEdit();
};

export const openHelp = section => HelpWindow.open(section);
export const loadAppVersion = () => HelpWindow.loadVersion();
