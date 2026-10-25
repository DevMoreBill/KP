# -*- coding: utf-8 -*-
"""Имена стилей разных разделов не совпадают: один класс, объявленный «голым» селектором в двух CSS-файлах, — стили
одного раздела перебивают другой (3.212.1 — таблица состава станции и список КП на телефоне, 3.213.1 — строка обмена
Битрикс24 и шаги мастера). Правки для телефона (mobile.css, compact.css) и намеренные общие классы — разрешены."""
import collections
import glob
import os
import re
import unittest

from kit import APP

OVERRIDES = ('mobile.css', 'compact.css')
# общие классы, которые раздел намеренно уточняет (сетка, журнал, шапка, тост, карточка клиента в сделке)
SHARED = {'g2', 'g3', 'g4', 'jbar', 'jr', 'jr-a', 'jr-e', 'top', 'toast', 'wrap', 'dk-ce'}


class CssNames(unittest.TestCase):
    def test_no_bare_class_in_two_section_files(self):
        where = collections.defaultdict(set)
        for path in glob.glob(os.path.join(APP, 'web', 'css', '*.css')):
            name = os.path.basename(path)
            if name in OVERRIDES:
                continue
            with open(path, encoding='utf-8') as f:
                text = re.sub(r'/\*.*?\*/', '', f.read(), flags=re.S)
            for selectors in re.findall(r'([^{}]+)\{[^{}]*\}', text):
                for one in selectors.split(','):
                    bare = re.fullmatch(r'\s*\.([\w-]+)\s*', one)
                    if bare:
                        where[bare.group(1)].add(name)
        clash = {cls: sorted(files) for cls, files in where.items() if len(files) > 1 and cls not in SHARED}
        self.assertEqual(clash, {}, 'один класс в разных разделах — дайте классу приставку своего раздела')


if __name__ == '__main__':
    unittest.main()
