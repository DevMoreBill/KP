# -*- coding: utf-8 -*-
"""Номер версии во всех местах и проверка записей о версии (навык /vypusk).

python .claude/skills/vypusk/vypusk.py 3.104.1   — проставить версию (app/version.py, APP_VERSION в help.js) и проверить
python .claude/skills/vypusk/vypusk.py --check   — только проверить текущую версию
Проверяется: первая запись APP_VERSIONS в help.js, раздел «**X — …**» в README.md, строка «- **X**» в docs/context/app-map.md.
Тексты записей пишет Claude по сути изменений — скрипт их не сочиняет. Код выхода 1 — чего-то не хватает.
"""
import os
import re
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))


class Release:
    VERSION_PY = ('app', 'version.py')
    HELP_JS = ('app', 'web', 'js', 'features', 'help.js')

    def _path(self, parts):
        return os.path.join(REPO, *parts)

    def _read(self, parts):
        with open(self._path(parts), encoding='utf-8') as f:
            return f.read()

    def _write(self, parts, text):
        with open(self._path(parts), 'w', encoding='utf-8', newline='\n') as f:
            f.write(text)

    def current(self):
        return re.search(r"VERSION = '([\d.]+)'", self._read(self.VERSION_PY)).group(1)

    @staticmethod
    def valid(v):
        return re.fullmatch(r'\d+\.\d+\.\d+', v or '') is not None

    def set(self, v):
        old = self.current()
        if tuple(map(int, v.split('.'))) <= tuple(map(int, old.split('.'))):
            raise ValueError('Новая версия %s должна быть больше текущей %s (обновление ставится только поверх старой).' % (v, old))
        self._write(self.VERSION_PY, re.sub(r"VERSION = '[\d.]+'", "VERSION = '%s'" % v, self._read(self.VERSION_PY), count=1))
        self._write(self.HELP_JS, re.sub(r"const APP_VERSION = '[\d.]+'", "const APP_VERSION = '%s'" % v, self._read(self.HELP_JS), count=1))
        return old

    def missing(self, v):
        out = []
        first = re.search(r"const APP_VERSIONS = \[\s*\['([\d.]+)'", self._read(self.HELP_JS))
        if not first or first.group(1) != v:
            out.append("help.js: первая запись APP_VERSIONS — ['%s', 'ДД.ММ.ГГГГ', [ …пункты для менеджера… ]]" % v)
        if "const APP_VERSION = '%s'" % v not in self._read(self.HELP_JS):
            out.append("help.js: export const APP_VERSION = '%s'" % v)
        if '**%s ' % v not in self._read(('README.md',)):
            out.append('README.md: раздел «**%s — что сделано:**» со списком (перед прежней версией)' % v)
        if '- **%s**' % v not in self._read(('docs', 'context', 'app-map.md')):
            out.append('docs/context/app-map.md: строка «- **%s** (ДД.ММ) — …» в этапах по версиям (классы, данные)' % v)
        return out


if __name__ == '__main__':
    r = Release()
    arg = sys.argv[1] if len(sys.argv) > 1 else '--check'
    if arg != '--check':
        if not Release.valid(arg):
            sys.exit('Версия — три числа через точку, например 3.104.1')
        try:
            print('Версия: %s → %s (app/version.py, help.js)' % (r.set(arg), arg))
        except ValueError as e:
            sys.exit(str(e))
    v = r.current()
    miss = r.missing(v)
    print('Версия %s: %s' % (v, 'все записи на месте' if not miss else 'не хватает:'))
    for m in miss:
        print('  - ' + m)
    sys.exit(1 if miss else 0)
