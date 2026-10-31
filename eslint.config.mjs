// ESLint для интерфейса программы (app/web/js). Запуск из корня репозитория: npx eslint@10.1.0 --max-warnings 0 app/web/js
//
// Интерфейс — ES-модули без сборщика: каждый файл подключает нужные классы import. Общих имён между файлами нет, кроме
// встроенного в браузер и подключённых библиотек (список ниже), поэтому no-undef ловит забытый import, опечатку в имени
// или удалённый класс, который ещё вызывают, — ошибка проверки, а не сбой у пользователя. Обычные скрипты — только
// boot.js (тема до отрисовки) и docx/kpgen.js (общий с проверками в Node и скелетом шаблона КП).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const JS_DIR = path.join(ROOT, 'app', 'web', 'js');
const ESM = /^(?:import|export)\s/m;

// встроенное в браузер, что использует интерфейс (окно, документ, сеть, хранилища, события), подключённые библиотеки
// (vendor: JSZip, docx), KPGen (docx/kpgen.js объявляет его через window.KPGen) и module (расчёты экспортируются и для
// проверок в Node: if (typeof module !== 'undefined') module.exports = …)
const BROWSER = `window document navigator location history localStorage sessionStorage console fetch Headers Request Response
  addEventListener removeEventListener dispatchEvent createImageBitmap
  FormData URL URLSearchParams Blob File FileReader Image Event CustomEvent KeyboardEvent MouseEvent DragEvent ClipboardEvent
  Node Element HTMLElement HTMLInputElement HTMLSelectElement HTMLTextAreaElement HTMLCanvasElement HTMLImageElement DocumentFragment
  setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame queueMicrotask requestIdleCallback
  alert confirm prompt getComputedStyle matchMedia getSelection scrollTo print open
  MutationObserver ResizeObserver IntersectionObserver DOMParser XMLSerializer TextEncoder TextDecoder AbortController
  crypto performance structuredClone atob btoa indexedDB caches BroadcastChannel ClipboardItem CSS innerWidth innerHeight
  devicePixelRatio screen scrollX scrollY visualViewport NodeFilter Range Selection DOMRect FontFace
  JSZip docx KPGen module`.split(/\s+/).filter(Boolean);

const files = dir =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? files(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []);

// у открытого метода класса (не «_метод») — JSDoc /** … */ перед ним
const jsdoc = {
  meta: { type: 'suggestion', schema: [], messages: { need: 'У открытого метода «{{name}}» нет описания /** … */' } },
  create(context) {
    const src = context.sourceCode;
    const check = (node, name) => {
      if (!name || name.startsWith('_') || name === 'constructor') return;
      const before = src.getCommentsBefore(node).at(-1);
      if (!before || before.type !== 'Block' || !before.value.startsWith('*')) context.report({ node, messageId: 'need', data: { name } });
    };
    return {
      MethodDefinition(node) { check(node, node.key.name || node.key.value); },
      PropertyDefinition(node) { if (node.value && /FunctionExpression$/.test(node.value.type)) check(node, node.key.name); },
    };
  },
};

// innerHTML / outerHTML / insertAdjacentHTML с шаблоном: каждое ${…} — esc(…), число или разметка из таких же частей;
// вызов другого метода (готовая разметка) правило не видит насквозь — такие места сводкой, решение по каждому — человеку
const NUMERIC = new Set(['-', '*', '/', '%', '**', '<', '>', '<=', '>=', '===', '!==', '==', '!=', '&', '|', '^', '<<', '>>']);
const NUMBER_CALLS = /^(Number|parseInt|parseFloat|Math\.\w+|KPGen\.money|\w+\.toFixed|\w+\.length)$/;
const safeHtml = node => {
  if (!node) return true;
  switch (node.type) {
    case 'Literal': return true;
    case 'TemplateLiteral': return node.expressions.every(safeHtml);
    case 'ConditionalExpression': return safeHtml(node.consequent) && safeHtml(node.alternate);
    case 'LogicalExpression': return node.operator === '&&' ? safeHtml(node.right) : safeHtml(node.left) && safeHtml(node.right);
    case 'BinaryExpression': return NUMERIC.has(node.operator) || (safeHtml(node.left) && safeHtml(node.right));
    case 'UnaryExpression': case 'UpdateExpression': return true;
    case 'MemberExpression': return !node.computed && node.property.name === 'length';
    case 'CallExpression': {
      const callee = node.callee.type === 'MemberExpression' && !node.callee.computed
        ? `${node.callee.object.type === 'Identifier' ? node.callee.object.name : 'x'}.${node.callee.property.name}` : node.callee.name;
      if (callee === 'esc' || NUMBER_CALLS.test(callee || '')) return true;
      // список.map(x => `…`).join('') — по разметке внутри
      if (node.callee.type === 'MemberExpression' && node.callee.property.name === 'join' && node.callee.object.type === 'CallExpression') {
        const mapped = node.callee.object;
        const body = mapped.callee.type === 'MemberExpression' && mapped.callee.property.name === 'map' && mapped.arguments[0];
        return Boolean(body && /ArrowFunctionExpression/.test(body.type) && body.expression && safeHtml(body.body));
      }
      return false;
    }
    default: return false;
  }
};
const escHtml = {
  meta: { type: 'problem', schema: [], messages: { raw: 'В разметку без esc(): ${{{text}}}' } },
  create(context) {
    const src = context.sourceCode;
    const check = tpl => {
      if (!tpl || tpl.type !== 'TemplateLiteral') return;
      for (const expr of tpl.expressions) {
        if (!safeHtml(expr)) context.report({ node: expr, messageId: 'raw', data: { text: src.getText(expr).slice(0, 60) } });
      }
    };
    return {
      AssignmentExpression(node) {
        if (node.left.type === 'MemberExpression' && ['innerHTML', 'outerHTML'].includes(node.left.property.name)) check(node.right);
      },
      CallExpression(node) {
        if (node.callee.type === 'MemberExpression' && node.callee.property.name === 'insertAdjacentHTML') check(node.arguments[1]);
      },
    };
  },
};

const KP = { rules: { jsdoc, 'esc-html': escHtml } };

// папки, где уже наведён «чистый код» (решение владельца 20.10): говорящие имена и JSDoc у открытых методов
const CLEAN = ['tz', 'tz-out', 'calc', 'rules', 'rules-doc', 'eskd', 'draw', 'view', 'layout', 'station', 'kit', 'req', 'wizard', 'crm', 'admin', 'doc', 'kp', 'deal', 'catalog'].map(d => `app/web/js/features/${d}/*.js`).concat('app/web/js/core/*.js', 'app/web/js/main.js', 'app/web/js/ui/*.js');
const NAMES = { min: 3, properties: 'never', exceptions: ['i', 'j', 'k', 'x', 'y', 'z', 'x0', 'x1', 'x2', 'y0', 'y1', 'y2', 'z0', 'z1', 'z2', 'dx', 'dy', 'dz', 'id', 'ok', 'kw', 'el', 'gl', 'db', 'of', 'ox', 'oy', 'Li', 'Wi', 'Hi', 'Le', 'We', 'He', 'Mm', 'u', 'v', 'u0', 'u1', 'v0', 'v1', 'du', 'dv', '_'] };

// строгие правила переписанного кода (ES-модули): без вложенных «?:» и длинных цепочек условий, короткие методы
const MODULES = files(JS_DIR).filter(f => ESM.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(ROOT, f).split(path.sep).join('/'));
const STRICT = {
  'no-unused-vars': ['error', { args: 'after-used', caughtErrors: 'none' }],
  'prefer-const': 'error', 'no-var': 'error', eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-nested-ternary': 'error', 'no-else-return': ['error', { allowElseIf: false }], 'no-lonely-if': 'error',
  'no-unneeded-ternary': 'error', 'object-shorthand': 'error', 'prefer-template': 'error', 'prefer-arrow-callback': 'error',
  'arrow-body-style': ['error', 'as-needed'], 'no-useless-return': 'error', 'no-useless-concat': 'error', 'dot-notation': 'error',
  'prefer-spread': 'error', 'prefer-rest-params': 'error', 'no-param-reassign': 'off', yoda: 'error', 'consistent-return': 'error',
  complexity: ['error', 12], 'max-depth': ['error', 3], 'max-params': ['error', 5], 'max-nested-callbacks': ['error', 3],
  'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }], 'max-lines': ['error', { max: 700, skipBlankLines: true, skipComments: true }],
};

// слои интерфейса (циклы import): запреты разделов — общие; правило для части разделов заменяет общее и повторяет их
const LAYERS = {
  ui: { group: ['../../ui/**', '../ui/**'], message: 'разделы не подключают форму (ui/): KpForm, PhoneLayout и общие виджеты — в core/' },
  admin: { group: ['../admin/**'], message: '«Настройки» — верхний раздел: окна подтверждения — AdminDialog, запросы /api/admin — AdminApi, подписи журнала — AuditLabels (core/)' },
};
// сведения, не отказ (tests/run_all.py и CI — отдельным шагом с KP_ESLINT_REPORT=1): разметка без esc(); сложность и длина
// функций обычных скриптов (у ES-модулей это уже ошибки STRICT). esc-html — «error», когда все места разобраны
const REPORT = process.env.KP_ESLINT_REPORT === '1' ? [{
  files: ['app/web/js/**/*.js'],
  plugins: { kp: KP },
  rules: { 'kp/esc-html': 'warn' },
}, {
  files: ['app/web/js/boot.js', 'app/web/js/docx/kpgen.js'],
  rules: { complexity: ['warn', 12], 'max-lines-per-function': ['warn', { max: 50, skipBlankLines: true, skipComments: true }] },
}] : [];

export default [{
  files: ['app/web/js/**/*.js'],
  languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: Object.fromEntries(BROWSER.map(n => [n, 'readonly'])) },
  plugins: { kp: KP },
  rules: {
    'no-undef': ['error', { typeof: false }],
    'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }],
    'no-dupe-keys': 'error',
    'no-unreachable': 'error',
    'no-redeclare': 'error',
    'no-dupe-class-members': 'error',
    // аудит 30.10: исполнение строки как кода и нестрогое сравнение — нигде (null — можно: «== null» — нет значения)
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    eqeqeq: ['error', 'always', { null: 'ignore' }],
  },
}, {
  // скелет шаблона КП — код из папки шаблона: меняет только главный администратор (admin_rights, FE-001)
  files: ['app/web/js/docx/kpgen.js'],
  rules: { 'no-new-func': 'off' },
}, ...(MODULES.length ? [{
  files: MODULES,
  languageOptions: { sourceType: 'module' },
  rules: STRICT,
}] : []), {
  // данные: журнал версий и руководство, описания «Значений программы» — длинные, но без логики
  files: ['app/web/js/features/help.js', 'app/web/js/features/help-versions.js', 'app/web/js/core/defaults-srv.js', 'app/web/js/core/defaults-kp.js'],
  rules: { 'max-lines': 'off' },
}, {
  // нижний слой интерфейса не подключает разделы и форму (циклы import): разделы подписываются на события
  // (kp:features, kp:theme, kp:saved, kp:password, kp:unauthorized) и подключаются в своём index.js
  files: ['app/web/js/core/*.js'],
  rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['../features/**', '../ui/**'], message: 'core/ — нижний слой: раздел подключается событием или регистрацией в своём index.js' }] }] },
}, {
  // разделы не подключают форму КП (ui/ выше разделов — циклы import): перерисовать форму, шаг, боковая панель — KpForm
  // (core/kp-form.js, форму подключает ui/index.js), телефонная раскладка — PhoneLayout, общие виджеты — core/
  // «Настройки» (admin) — верхний раздел: разделы их не подключают; вход администратора с экрана входа и форма входа после
  // истёкшей сессии — регистрацией в admin/index.js (AuthScreen.openSettings, AdminApi.onExpired)
  files: ['app/web/js/features/**/*.js'],
  rules: { 'no-restricted-imports': ['error', { patterns: [
    LAYERS.ui,
    LAYERS.admin,
  ] }] },
}, {
  // КП — основа: другие разделы построены поверх него и подключают себя портами core/ — кабинет (CabinetLink),
  // экономика сделки (DealLink), документ (DocLink), каталог (CatalogLink); переключение вкладок КП — события kp:leave,
  // kp:enter; правило заменяет общее для этих файлов — запреты ui/ и admin/ повторены
  files: ['app/web/js/features/kp/**/*.js'],
  rules: { 'no-restricted-imports': ['error', { patterns: [
    LAYERS.ui,
    LAYERS.admin,
    { group: ['../*/**', '!../../**'], message: 'КП — основа: другие разделы не подключает — кабинет, экономика сделки, документ и каталог КП просит через CabinetLink, DealLink, DocLink, CatalogLink (core/)' },
  ] }] },
}, {
  // каталог — над КП, под составом станции, подбором, мастером и документом КП: они подключают себя портами core/ —
  // StationLink (вкладки «Состав станции» и «Компоновка», картинки и описание станции, чертёж), WizardLink («Добавить
  // оборудование»); имя латиницей — Translit (core/)
  files: ['app/web/js/features/catalog/**/*.js'],
  rules: { 'no-restricted-imports': ['error', { patterns: [
    LAYERS.ui,
    LAYERS.admin,
    { group: ['../*/**', '!../kp/**', '!../../**'], message: 'каталог подключает только КП и core/: станции — StationLink, мастер — WizardLink, имя латиницей — Translit (core/)' },
  ] }] },
}, {
  // состав станции (kit) не подключает подбор станции (station): расчёт компоновки позиции — StationPlan (kit), быстрый
  // подбор под составом — KitView.stationQuick (подключает station/index.js); компоновка (layout) не подключает 3D-вид
  // (view): оттенок по фото — StationEquip.photoTint (подключает view/index.js); оба — экономику сделки (deal): DealLink
  files: ['app/web/js/features/kit/**/*.js'],
  rules: { 'no-restricted-imports': ['error', { patterns: [
    LAYERS.ui,
    LAYERS.admin,
    { group: ['../station/**'], message: 'состав станции не подключает подбор: StationPlan, KitView.stationQuick' },
    { group: ['../deal/**'], message: 'состав станции и компоновка не подключают экономику сделки: DealLink (core/deal-link.js), груз из характеристик — LgCargo (core/)' },
  ] }] },
}, {
  files: ['app/web/js/features/layout/**/*.js'],
  rules: { 'no-restricted-imports': ['error', { patterns: [
    LAYERS.ui,
    LAYERS.admin,
    { group: ['../view/**'], message: 'компоновка не подключает 3D-вид: StationEquip.photoTint' },
    { group: ['../deal/**'], message: 'состав станции и компоновка не подключают экономику сделки: DealLink (core/deal-link.js), груз из характеристик — LgCargo (core/)' },
  ] }] },
}, {
  // требования к станции (req) — модель под расчётом, составом, ТЗ и подбором: производительность по требованиям —
  // AirDemand.required (calc), шкафы АВР и АСУ ТП — StationDefaults.ensureParts, проверки состава — ReqChecks (kit), форма
  // требований — ReqForm (station); расчёт компоновки позиции StationPlan — в req
  files: ['app/web/js/features/req/**/*.js'],
  rules: { 'no-restricted-imports': ['error', { patterns: [
    LAYERS.ui,
    LAYERS.admin,
    { group: ['../calc/**', '../kit/**', '../tz/**', '../station/**', '../wizard/**', '../doc/**'], message: 'требования к станции — модель: расчёт, состав, ТЗ, подбор, мастер и документ подключают её сами (AirDemand.required, StationDefaults.ensureParts, ReqChecks, ReqForm)' },
  ] }] },
}, {
  // расчёт станции (calc) — над требованиями, под составом, подбором, мастером и документом: расчёт компоновки позиции —
  // StationPlan (req/), виды контейнеров — ContainerKind (layout/)
  files: ['app/web/js/features/calc/**/*.js'],
  rules: { 'no-restricted-imports': ['error', { patterns: [
    LAYERS.ui,
    LAYERS.admin,
    { group: ['../kit/**', '../station/**', '../wizard/**', '../doc/**'], message: 'расчёт станции не подключает состав, подбор, мастер и документ: StationPlan (req/), ContainerKind (layout/)' },
  ] }] },
}, {
  files: CLEAN,
  plugins: { kp: KP },
  rules: { 'id-length': ['error', NAMES], 'kp/jsdoc': 'error' },
}, ...REPORT];
