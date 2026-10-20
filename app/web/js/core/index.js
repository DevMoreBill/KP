// Общие классы программы — первым ES-модулем страницы: остальные модули и обычные скрипты (внутри функций) видят их в globalThis.
import { DimInput } from './dim-input.js';
import { EquipTypes } from './equip-types.js';
import { FeatureRegistry, FEAT } from './features.js';
import { CopyText, FileSave } from './files.js';
import { Debounce } from './debounce.js';
import { Attrs, CatAttrs, ItemAttrs, ItemParse } from './item-attrs.js';
import { CoverHint, ItemSpec } from './item-spec.js';
import { ImgMiss, LazyJs } from './lazy-js.js';
import * as LEGACY from './legacy.js';
import { DblClickGuard, Modal } from './modal.js';
import { Money } from './money.js';
import { Morph } from './morph.js';
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

Object.assign(globalThis, CORE, LEGACY);

DblClickGuard.listen();
ImgMiss.listen();
DimInput.listen();
