// ESLint для интерфейса программы (app/web/js). Запуск из корня репозитория: npx eslint@10.1.0 --max-warnings 0 app/web/js
//
// Интерфейс — обычные скрипты без сборщика: функции, классы и переменные верхнего уровня одного файла видны в других
// (index.html подключает все файлы по порядку). Правило kp/no-undef — как встроенное no-undef, но имена верхнего уровня
// собирает из всех файлов app/web/js (их разбирает тот же парсер, что и ESLint): опечатка в имени, переменная, которую
// забыли объявить, или функция, которую удалили, а вызов остался, — ошибка проверки, а не сбой у пользователя.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const JS_DIR = path.join(ROOT, 'app', 'web', 'js');
const PARSE = { ecmaVersion: 2022, sourceType: 'script', range: false, loc: false };
const ESM = /^(?:import|export)\s/m;   // ES-модуль (переписанный код) — строгие правила и Prettier

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

class SharedNames {
  // имена верхнего уровня всех файлов интерфейса (один раз за запуск ESLint)
  static names = null;

  static of(parser) {
    if (!SharedNames.names) {
      SharedNames.names = new Set();
      for (const f of SharedNames.files(JS_DIR)) {
        let ast;
        const text = fs.readFileSync(f, 'utf8');
        try { ast = parser.parse(text, { ...PARSE, sourceType: ESM.test(text) ? 'module' : 'script' }); } catch { continue; }   // ошибку разбора покажет сам ESLint
        for (const n of ast.body) SharedNames.declared(n).forEach(x => SharedNames.names.add(x));
      }
    }
    return SharedNames.names;
  }

  static files(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
      ? SharedNames.files(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []);
  }

  static declared(n) {
    if (n.type === 'ExportNamedDeclaration' && n.declaration) return SharedNames.declared(n.declaration);   // ES-модуль: мост в globalThis
    if ((n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') && n.id) return [n.id.name];
    if (n.type === 'VariableDeclaration') return n.declarations.flatMap(d => SharedNames.pattern(d.id));
    return [];
  }

  static pattern(p) {
    if (!p) return [];
    if (p.type === 'Identifier') return [p.name];
    if (p.type === 'ObjectPattern') return p.properties.flatMap(x => SharedNames.pattern(x.type === 'RestElement' ? x.argument : x.value));
    if (p.type === 'ArrayPattern') return p.elements.flatMap(x => SharedNames.pattern(x));
    if (p.type === 'AssignmentPattern') return SharedNames.pattern(p.left);
    if (p.type === 'RestElement') return SharedNames.pattern(p.argument);
    return [];
  }
}

const noUndef = {
  meta: { type: 'problem', schema: [], messages: { undef: '«{{name}}» не объявлено ни в одном файле интерфейса (app/web/js) и не встроено в браузер' } },
  create(context) {
    const shared = SharedNames.of(context.languageOptions.parser);
    return {
      'Program:exit'(node) {
        for (const ref of context.sourceCode.getScope(node).through) {
          const id = ref.identifier, up = id.parent;
          if (up && up.type === 'UnaryExpression' && up.operator === 'typeof') continue;    // typeof x — проверка наличия
          if (!shared.has(id.name)) context.report({ node: id, messageId: 'undef', data: { name: id.name } });
        }
      },
    };
  },
};

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

const KP = { rules: { 'no-undef': noUndef, jsdoc } };

// папки, где уже наведён «чистый код» (решение владельца 20.10): говорящие имена и JSDoc у открытых методов
const CLEAN = ['tz', 'tz-out', 'calc', 'rules', 'rules-doc', 'eskd', 'draw', 'view', 'layout', 'station', 'kit', 'crm'].map(d => `app/web/js/features/${d}/*.js`);
const NAMES = { min: 3, properties: 'never', exceptions: ['i', 'j', 'k', 'x', 'y', 'z', 'x0', 'x1', 'x2', 'y0', 'y1', 'y2', 'z0', 'z1', 'z2', 'dx', 'dy', 'dz', 'id', 'ok', 'kw', 'el', 'gl', 'db', 'of', 'ox', 'oy', 'Li', 'Wi', 'Hi', 'Le', 'We', 'He', 'Mm', 'u', 'v', 'u0', 'u1', 'v0', 'v1', 'du', 'dv', '_'] };

// строгие правила переписанного кода (ES-модули): без вложенных «?:» и длинных цепочек условий, короткие методы
const MODULES = SharedNames.files(JS_DIR).filter(f => ESM.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(ROOT, f).split(path.sep).join('/'));
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

export default [{
  files: ['app/web/js/**/*.js'],
  languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: Object.fromEntries(BROWSER.map(n => [n, 'readonly'])) },
  plugins: { kp: KP },
  rules: {
    'kp/no-undef': 'error',
    'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }],
    'no-dupe-keys': 'error',
    'no-unreachable': 'error',
    'no-redeclare': 'error',
  },
}, ...(MODULES.length ? [{
  files: MODULES,
  languageOptions: { sourceType: 'module' },
  rules: STRICT,
}] : []), {
  files: CLEAN,
  plugins: { kp: KP },
  rules: { 'id-length': ['error', NAMES], 'kp/jsdoc': 'error' },
}];
