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
        try { ast = parser.parse(fs.readFileSync(f, 'utf8'), PARSE); } catch { continue; }   // ошибку разбора покажет сам ESLint
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

export default [{
  files: ['app/web/js/**/*.js'],
  languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: Object.fromEntries(BROWSER.map(n => [n, 'readonly'])) },
  plugins: { kp: { rules: { 'no-undef': noUndef } } },
  rules: {
    'kp/no-undef': 'error',
    'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }],
    'no-dupe-keys': 'error',
    'no-unreachable': 'error',
    'no-redeclare': 'error',
  },
}];
