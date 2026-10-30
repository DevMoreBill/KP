# -*- coding: utf-8 -*-
"""Хуки Claude Code проекта (.claude/hooks): запрет записи баз, выгрузок, ключей и папки рабочих данных (guard.py),
проверка файла сразу после правки (lint.py), номер версии во всех местах (.claude/skills/vypusk/vypusk.py)."""
import contextlib
import importlib.util
import io
import os
import shutil
import tempfile
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(*parts):
    spec = importlib.util.spec_from_file_location(parts[-1][:-3], os.path.join(REPO, *parts))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


guard = load('.claude', 'hooks', 'guard.py')
lint = load('.claude', 'hooks', 'lint.py')
vypusk = load('.claude', 'skills', 'vypusk', 'vypusk.py')


class GuardTest(unittest.TestCase):
    def verdict(self, tool, **inp):
        return guard.Guard({'tool_name': tool, 'tool_input': inp, 'cwd': REPO}).verdict()

    def test_files_blocked(self):
        for p in ('app/data/kp.sqlite3', 'app/data/settings.json', 'kp-2026-10-18.zip', 'kp.sqlite3', 'base.db', '.env',
                  '.env.local', 'secrets/update.key', 'cert.pem', os.path.join(REPO, 'x.sqlite3-wal'), 'id_ed25519'):
            self.assertTrue(self.verdict('Write', file_path=p), p)
        self.assertTrue(self.verdict('NotebookEdit', notebook_path='app/data/x.ipynb'))

    def test_files_allowed(self):
        for p in ('app/storage.py', 'tests/kit.py', 'README.md', 'app/web/js/core/util.js', 'templates/x.docx',
                  '/tmp/kp-copy/final.sqlite3', '../outside.sqlite3', 'docs/kp-zip-format.md'):
            self.assertIsNone(self.verdict('Edit', file_path=p), p)

    def test_bash(self):
        blocked = ('rm -f app/data/kp.sqlite3', 'cp new.sqlite3 app/data/kp.sqlite3', 'sqlite3 app/data/kp.sqlite3 "DELETE FROM kv"',
                   'echo x > app/data/settings.json', 'mv app/data /tmp/', 'git add -f base.sqlite3', 'git add --force kp-backup.zip',
                   'dd if=/dev/zero of=app/data/kp.sqlite3')
        for c in blocked:
            self.assertTrue(self.verdict('Bash', command=c), c)
        allowed = ('python3 tests/run_all.py --changed', 'ls app/data/', 'grep -rn "app/data/" app > /tmp/out.txt',
                   'cp /tmp/a.sqlite3 /tmp/b.sqlite3', 'git add -A', 'git add -f tests/ui/check.js', 'cat app/data/README')
        for c in allowed:
            self.assertIsNone(self.verdict('Bash', command=c), c)

    def test_other_tools(self):
        self.assertIsNone(self.verdict('Read', file_path='app/data/kp.sqlite3'), 'читать можно')

    def test_danger(self):
        """Опасные приёмы, которые правка добавляет: голый except, eval/exec, pickle, shell=True, SQL f-строкой, var,
        new Function — запрет; уже имеющиеся в файле и безопасные похожие записи — можно."""
        def edit(path, new, old='x = 1'):
            return self.verdict('Edit', file_path=path, old_string=old, new_string=new)
        blocked = ('try:\n    x = 1\nexcept:\n    pass', 'y = eval(text)', 'state = pickle.loads(raw)',
                   "subprocess.run(cmd, shell=True)", "conn.execute(f'SELECT * FROM t WHERE id={cid}')")
        for new in blocked:
            self.assertTrue(edit('app/crm.py', new), new)
        for new in ('var x = 1;', 'const run = new Function("return 1");'):
            self.assertTrue(edit('app/web/js/core/util.js', new, 'const x = 1;'), new)
        self.assertTrue(self.verdict('Write', file_path='app/zz_audit_new_module.py', content='y = eval(x)\n'), 'новый файл')
        self.assertTrue(self.verdict('MultiEdit', file_path='app/web/js/core/util.js',
                                     edits=[{'old_string': 'const a = 1;', 'new_string': 'const a = 1;'},
                                            {'old_string': 'let b = 2;', 'new_string': 'var b = 2;'}]), 'MultiEdit с var')
        allowed = (('app/crm.py', 'try:\n    x = 1\nexcept OSError:\n    pass', 'x = 1'),
                   ('app/crm_exec.py', "self.book.put_exec(did, state, author, {'step': key})", 'x = 1'),
                   ('app/storage.py', "conn.execute('SELECT 1 FROM t WHERE id=?', (i,))", 'x = 1'),
                   ('app/web/js/core/util.js', 'const x = 1;', 'let x = 1;'),
                   ('app/web/js/core/util.js', "box.style.color = 'var(--ink)';", 'const x = 1;'),
                   ('app/web/js/core/util.js', 'box.innerHTML = `<b>${esc(name)}</b>`;', 'const x = 1;'),
                   ('app/web/js/boot.js', 'var theme = 2;', 'var theme = 1;'),
                   ('app/web/css/base.css', 'a { color: var(--ink); }', 'a {}'),
                   ('.claude/hooks/guard.py', 'y = eval(x)', 'x = 1'))
        for path, new, old in allowed:
            self.assertIsNone(edit(path, new, old), (path, new))

    def test_danger_rewrite_same(self):
        """Перезапись любого имеющегося файла .py/.js его же текстом не запрещается (уже имеющееся — дело аудита)."""
        paths = [os.path.join(dirpath, name) for top in ('app', 'tests', '.claude', '.github')
                 for dirpath, _, names in os.walk(os.path.join(REPO, top)) for name in names
                 if name.endswith(('.py', '.js', '.mjs')) and '__pycache__' not in dirpath]
        self.assertGreater(len(paths), 500)
        for path in paths:
            with open(path, encoding='utf-8') as f:
                text = f.read()
            self.assertIsNone(self.verdict('Write', file_path=path, content=text), path)


class LintTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix='kp-lint-')
        self.addCleanup(shutil.rmtree, self.dir, True)
        os.makedirs(os.path.join(self.dir, 'tests'))
        shutil.copy(os.path.join(REPO, 'tests', 'run_all.py'), os.path.join(self.dir, 'tests'))

    def put(self, rel, text):
        p = os.path.join(self.dir, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w', encoding='utf-8') as f:
            f.write(text)
        return lint.Lint({'tool_name': 'Write', 'tool_input': {'file_path': p}, 'cwd': self.dir})

    def test_commands(self):
        self.assertEqual(self.put('app/a.py', 'x = 1\n').command('app/a.py')[-1], 'app/a.py')
        self.assertIsNone(self.put('app/web/css/a.css', 'a{}').command('app/web/css/a.css'), 'стили не проверяются')
        self.assertIsNone(self.put('docs/a.md', '# a').command('docs/a.md'))
        self.assertEqual(self.put('x.py', '').target(), 'x.py')
        self.assertIsNone(lint.Lint({'tool_input': {'file_path': '/etc/hosts'}, 'cwd': self.dir}).target(), 'вне проекта — не проверяется')

    @unittest.skipUnless(importlib.util.find_spec('pyflakes'), 'нет pyflakes')
    def test_pyflakes(self):
        os.environ.pop('CLAUDE_PROJECT_DIR', None)
        self.assertEqual(self.put('app/ok.py', 'import os\nprint(os.sep)\n').run(), 0)
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.assertEqual(self.put('app/bad.py', 'import os\n').run(), 2, 'неиспользуемый импорт — Claude должен увидеть')
        self.assertIn("'os' imported but unused", err.getvalue())

    def test_eslint_version(self):
        self.assertTrue(self.put('a.py', '').eslint().startswith('eslint@'))


class VypuskTest(unittest.TestCase):
    def test_current_version_complete(self):
        r = vypusk.Release()
        self.assertTrue(vypusk.Release.valid(r.current()))
        self.assertEqual(r.missing(r.current()), [], 'записи о текущей версии — везде')
        self.assertTrue(r.missing('99.0.0'), 'чужая версия — не на месте')

    def test_not_lower(self):
        r = vypusk.Release()
        with self.assertRaises(ValueError):
            r.set('0.0.1')


if __name__ == '__main__':
    unittest.main(verbosity=2)
