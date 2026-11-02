# -*- coding: utf-8 -*-
"""Разбор числа на сервере (app/num.py, 3.247.0): одно правило вместо 10 копий — фиды и прайсы, страницы поставщиков,
ДГУ, контрагенты, логистика, перевозка из Китая, ТЗ, перенос каталога, итоги журнала. Таблица редких вводов — что было
у копий и что стало (README, 3.247.0)."""
import math
import os
import sys
import unittest
from decimal import Decimal

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app'))

from num import Num  # noqa: E402


class ParseTest(unittest.TestCase):
    """Num.parse: число или None."""

    NUMBERS = (
        ('1 234,5', 1234.5),
        ('1\xa0234,5', 1234.5),  # неразрывный пробел
        ('1 234', 1234.0),  # узкий неразрывный (так разряды пишет Excel и сайты)
        ('12\t5', 125.0),
        (' 7 ', 7.0),
        ('-3,5', -3.5),
        ('+5', 5.0),
        ('.5', 0.5),
        ('5.', 5.0),
        ('1e5', 100000.0),
        ('1E-5', 1e-05),  # так Excel хранит малые числа в ячейке
        ('0', 0.0),
        (5, 5.0),
        (2.5, 2.5),
        (Decimal('1.5'), 1.5),
    )
    NOT_NUMBERS = (
        None,
        '',
        '   ',
        'inf',
        '-inf',
        'Infinity',
        'nan',
        '1e400',  # бесконечность
        '1_000',  # float() принял бы — не число в тексте менеджера
        '١٢',  # цифры другой письменности — float() принял бы
        '12,5 %',
        '1.234,5',
        '1,2,3',
        'abc',
        '−5',  # «минус» из типографики — не дефис
        True,
        False,
        math.nan,
        math.inf,
        10**400,  # целое больше float
    )

    def test_numbers(self):
        for value, want in self.NUMBERS:
            with self.subTest(value=value):
                self.assertEqual(Num.parse(value), want)

    def test_not_numbers(self):
        for value in self.NOT_NUMBERS:
            with self.subTest(value=value):
                self.assertIsNone(Num.parse(value))

    def test_of(self):
        self.assertEqual(Num.of('12,5'), 12.5)
        self.assertEqual(Num.of('1 000'), 1000.0)
        for bad in ('abc', '', None, 'inf'):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                Num.of(bad)


class OtherDigitsTest(unittest.TestCase):
    """Цифры других алфавитов («３００», «٣٠٠») в тексте ТЗ и фидов: регулярки с \\d их находят, а Num.parse читает только
    0–9 — разбор ТЗ отвечал 500 на весь документ, «Что загрузится…» фида — 422 (с 3.247.0; повторная проверка 02.11)."""

    def test_ascii_digits(self):
        self.assertEqual(Num.ascii_digits('Ресивер ３００ л, ٣٠٠ бар, ९'), 'Ресивер 300 л, 300 бар, 9')
        self.assertEqual(Num.ascii_digits('1 234,5 кВт'), '1 234,5 кВт')
        self.assertIsNone(Num.parse('３００'), 'само правило Num — только 0–9 (README 3.247.0)')

    def test_tz(self):
        from tz_parse import TzParse

        req = TzParse.parse('Компрессорная станция. Ресивер ３００ л. Производительность １０ м³/мин, давление ８ бар.')['req']
        self.assertEqual((req.get('flow'), req.get('pressure'), req.get('recvVol')), (10.0, 8.0, 300))

    def test_feeds(self):
        import catalog_migrate
        import feeds

        self.assertEqual(catalog_migrate.parse_num('８００ л/мин', 'м³/мин'), 0.8)
        self.assertEqual(feeds._sum_txt('Мощность', '５,５+５,５', 'кВт'), '11 кВт (5,5+5,5)')
        attrs: dict = {}
        catalog_migrate.fill_from_name({'name': 'Ресивер ９００ л /１０ бар'}, 'receiver', attrs)
        self.assertEqual((attrs.get('volume'), attrs.get('pressure')), (900, 10))


class CallersTest(unittest.TestCase):
    """Места, где были копии, — тот же разбор."""

    def test_journal_totals(self):
        import admin_access

        rub, profit = admin_access.econ_rub({'sum': '1 234,5', 'econ': None})
        self.assertEqual(rub, 1234.5)
        self.assertIsNone(profit)
        self.assertEqual(admin_access.econ_rub({'sum': 'nan'})[0], 0)

    def test_price_file_cells(self):
        import feed_xlsx

        self.assertFalse(hasattr(feed_xlsx, '_num'), 'ячейки прайса — Num.parse')

    def test_tz_numbers(self):
        from tz_parse import TzParse

        self.assertFalse(hasattr(TzParse, 'num'))


if __name__ == '__main__':
    unittest.main()
