// Прежние имена общих помощников — для обычных скриптов (ui/, docx/) и ещё не переписанных мест: вызываются только внутри
// функций. Переписанный код обращается к классам напрямую; имя убирается, когда его больше никто не вызывает.
import { FileSave } from './files.js';
import { EquipTypes } from './equip-types.js';
import { Attrs, ItemParse } from './item-attrs.js';
import { ItemSpec } from './item-spec.js';
import { Morph } from './morph.js';
import { AdminSession, Api, RemoteResult, Srv } from './net.js';
import { SpecValues } from './spec-values.js';
import { ObjPath, Price, Str } from './str.js';
import { Toast } from './toast.js';

export const { money, totals, plural, CURS } = KPGen;
export const SRV = Srv;
export const ADMIN = AdminSession;

export const api = (path, opts) => Api.request(path, opts);
export const remoteResult = reply => RemoteResult.show(reply);
export const toast = (text, delay) => Toast.show(text, delay);
export const morph = (el, html) => Morph.apply(el, html);
export const saveFileA = (name, blob) => FileSave.download(name, blob);

export const norm = text => Str.norm(text);
export const numOf = value => Str.num(value);
export const getPath = (obj, key) => ObjPath.get(obj, key);
export const setPath = (obj, key, value) => ObjPath.set(obj, key, value);
export const parsePrice = text => Price.parse(text);
export const fmtPrice = kop => Price.text(kop);
export const words = (kop, cur) => Price.words(kop, cur);

export const typeById = id => EquipTypes.byId(id);
export const loadTypes = () => EquipTypes.load();
export const typeOptionsHtml = selected => EquipTypes.optionsHtml(selected);
export const allPresets = () => EquipTypes.allPresets();
export const presetsFor = item => EquipTypes.presetsFor(item);
export const newOpt = (item, preset) => EquipTypes.newOpt(item, preset);
export const attrsOf = item => Attrs.of(item);
export const extractAttrs = item => ItemParse.extract(item);
export const brand = text => ItemParse.brand(text);
export const attrsFromSpec = (item, type) => SpecValues.fromSpec(item, type);
export const fmtField = (field, value) => SpecValues.show(field, value);
export const mainLine = (item, max) => ItemSpec.mainLine(item, max);
export const groupsFromAttrs = item => ItemSpec.groups(item);
export const applySpecTemplate = item => ItemSpec.applyTemplate(item);
export const imgPlace = (item, kind, img) => ItemSpec.imgPlace(item, kind, img);
