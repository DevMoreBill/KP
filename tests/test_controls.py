# -*- coding: utf-8 -*-
"""Кнопки, галочки, списки и поля интерфейса: у каждого признака data-* на элементе управления есть код, который его
читает (селектор «[data-…]», dataset или разбор data.…). Нет — кнопка ничего не делает: так находятся «мёртвые» элементы."""
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / 'app' / 'web'


class ControlsTest(unittest.TestCase):
    TAG = re.compile(r'<(button|input|select|textarea|a|label|details|summary)\b([^>]*)>', re.S)
    ATTR = re.compile(r'\bdata-([a-z][a-z0-9-]*)')
    # признаки только для оформления, вида или проверок прогона — без своего обработчика
    PASSIVE = frozenset({'nodirty', 'v', 'i', 'j', 'k'})

    @staticmethod
    def camel(name: str) -> str:
        head, *rest = name.split('-')
        return head + ''.join(part.capitalize() for part in rest)

    def sources(self) -> dict:
        found = {path: path.read_text(encoding='utf-8') for path in (WEB / 'js').rglob('*.js')}
        found[WEB / 'index.html'] = (WEB / 'index.html').read_text(encoding='utf-8')
        return found

    def test_every_control_has_reader(self):
        sources = self.sources()
        text = '\n'.join(sources.values())
        used: dict = {}
        for path, source in sources.items():
            for match in self.TAG.finditer(source):
                for name in self.ATTR.findall(match.group(2)):
                    used.setdefault(name, path.relative_to(ROOT).as_posix())
        dead = []
        for name, where in sorted(used.items()):
            if name in self.PASSIVE:
                continue
            key = self.camel(name)
            readers = (f'[data-{name}', f'data-{name}]', f"'data-{name}'", f'dataset.{key}', f'data.{key}', f'{key}:', f"'{key}'")
            if not any(reader in text for reader in readers):
                dead.append(f'data-{name} ({where})')
        self.assertEqual(dead, [], 'элементы без обработчика')


if __name__ == '__main__':
    unittest.main()
