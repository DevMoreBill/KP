# -*- coding: utf-8 -*-
"""!important в стилях — только у правил, которые обязаны перекрыть всё: печать, разметка сторонней библиотеки показа Word,
правила для сенсорного экрана, курсор при перетаскивании, «меньше движения» в системе, скрытое атрибутом hidden. Окна
и компоненты держатся на весе селектора и слоях каскада (`@layer win, win-mode`): новое окно или правка раздела с
!important «чтобы победить» — ошибка проверки (п. 29 отчёта аудита 30.10, 3.243.0)."""
import glob
import os
import re
import unittest

from kit import APP

ALLOWED = {
    ('base.css', '*'): 'система просит меньше движения — анимаций нет нигде',
    ('mobile.css', 'input:not([type=checkbox]):not([type=radio]):not([type=range]),select,textarea'):
        'сенсорный экран: поле не мельче 16 px, иначе iOS увеличивает страницу при вводе',
    ('mobile.css', 'select'): 'сенсорный экран: справа у списка место под свою стрелку',
    ('settings.css', '.bk-form [hidden]'): 'скрытое атрибутом hidden — скрыто, какой бы display ни дал класс поля',
    ('cabinet.css', 'body.printing-deal>*:not(#dkPrint)'): 'печать карточки сделки — на листе только она',
    ('deal.css', 'body.dl-colresize,body.dl-colresize *'): 'курсор, пока тянут ширину столбца',
    ('template-designer.css', 'body.td-sorting,body.td-sorting *'): 'курсор, пока перетаскивают раздел шаблона',
}
# preview.css: стили библиотеки показа Word (.docx-wrapper, section.docx — её разметка и встроенные стили) и печать КП
PREVIEW = re.compile(r'(docx|^body\.printing-kp)')


class CssImportant(unittest.TestCase):
    def test_important_only_where_allowed(self):
        found = []
        for path in sorted(glob.glob(os.path.join(APP, 'web', 'css', '*.css'))):
            name = os.path.basename(path)
            with open(path, encoding='utf-8') as f:
                text = re.sub(r'/\*.*?\*/', '', f.read(), flags=re.S)
            for selector, body in re.findall(r'([^{};]+)\{([^{}]*)\}', text):
                if '!important' not in body:
                    continue
                selector = re.sub(r'\s+', ' ', selector).strip()
                if (name, selector) in ALLOWED or (name == 'preview.css' and PREVIEW.search(selector)):
                    continue
                found.append(f'{name}: {selector}')
        self.assertEqual(found, [], 'перебивать стили — весом селектора или слоем окна, а не !important')

    def test_allowed_still_used(self):
        texts = {}
        for name, selector in ALLOWED:
            if name not in texts:
                with open(os.path.join(APP, 'web', 'css', name), encoding='utf-8') as f:
                    texts[name] = re.sub(r'\s+', ' ', f.read())
            self.assertIn(selector + '{', texts[name].replace(' {', '{'), f'{name}: {selector} — лишняя строка в ALLOWED')


if __name__ == '__main__':
    unittest.main()
