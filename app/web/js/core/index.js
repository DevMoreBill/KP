// Общие классы программы — первым ES-модулем страницы. Порядок: «Значения программы» и КП (state.js подключает
// defaults-srv.js и defaults-kp.js — порядок групп в «Настройках»), затем «Списки и выборы».
import './state.js';
import './lists.js';
import { DimInput } from './dim-input.js';
import { EquipTypes } from './equip-types.js';
import { FeatureRegistry, FEAT } from './features.js';
import { CopyText, FileSave } from './files.js';
import { Debounce } from './debounce.js';
import { Attrs, CatAttrs, ItemAttrs, ItemParse } from './item-attrs.js';
import { CoverHint, ItemSpec } from './item-spec.js';
import { ImgMiss, LazyJs } from './lazy-js.js';
import { DblClickGuard, Modal } from './modal.js';
import { Money } from './money.js';
import { Morph } from './morph.js';
import { Phone } from './phone.js';
import { AdminSession, Api, ImgUpload, RemoteResult, Srv } from './net.js';
import { SpecValues } from './spec-values.js';
import { Fmt, ObjPath, Price, Str } from './str.js';
import { Toast } from './toast.js';
import { XlsxBook, XlsxSheet } from './xlsx.js';
import { XlsxStyles } from './xlsx-styles.js';

export const CORE = {
  AdminSession,
  Api,
  Attrs,
  CatAttrs,
  CopyText,
  CoverHint,
  DblClickGuard,
  Debounce,
  DimInput,
  EquipTypes,
  FEAT,
  FeatureRegistry,
  FileSave,
  Fmt,
  ImgMiss,
  ImgUpload,
  ItemAttrs,
  ItemParse,
  ItemSpec,
  LazyJs,
  Modal,
  Money,
  Morph,
  ObjPath,
  Phone,
  Price,
  RemoteResult,
  SpecValues,
  Srv,
  Str,
  Toast,
  XlsxBook,
  XlsxSheet,
  XlsxStyles,
};

DblClickGuard.listen();
ImgMiss.listen();
DimInput.listen();
Phone.listen();
