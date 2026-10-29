# -*- coding: utf-8 -*-
"""Прайс-склад Tide Power (genset_tide.TideBook): блоки «В открытом исполнении» / «В кожухе», разные альтернаторы одной модели —
разные строки, «НОВЫЕ ЦЕНЫ» важнее прайс-листа, наличие и ожидаемое по месяцам — с листа «В наличии и В пути», брони вычитаются,
пока не истекли; карточка ↔ строки по модели, исполнению и альтернатору; книга не путается с HERTZ. Вымышленные данные."""
import unittest
from datetime import date

from test_feed_genset import Book  # подключает kit — путь к app/
import feed_files  # noqa: E402
from genset_sheets import GensetBook  # noqa: E402
from genset_tide import TideBook  # noqa: E402

GROUP = {2: 'ОСНОВНЫЕ ПАРАМЕТРЫ', 3: 'ОСНОВНЫЕ ПАРАМЕТРЫ', 4: 'ОСНОВНЫЕ ПАРАМЕТРЫ', 5: 'ОСНОВНЫЕ ПАРАМЕТРЫ',
         6: 'ОСНОВНЫЕ ПАРАМЕТРЫ', 7: 'В ОТКРЫТОМ ИСПОЛНЕНИИ', 8: 'В ОТКРЫТОМ ИСПОЛНЕНИИ', 9: 'В ОТКРЫТОМ ИСПОЛНЕНИИ',
         10: 'В ОТКРЫТОМ ИСПОЛНЕНИИ', 11: 'В ОТКРЫТОМ ИСПОЛНЕНИИ', 12: 'В ОТКРЫТОМ ИСПОЛНЕНИИ', 13: 'В КОЖУХЕ', 14: 'В КОЖУХЕ',
         15: 'В КОЖУХЕ', 16: 'В КОЖУХЕ', 17: 'В КОЖУХЕ', 18: 'В КОЖУХЕ'}
FIELD = {2: 'МОЩНОСТЬ НОМИНАЛ', 3: 'ДВИГАТЕЛЬ', 4: 'ДВИГАТЕЛЬ', 5: 'АЛЬТЕРНАТОР', 6: 'АЛЬТЕРНАТОР', 7: 'ЦЕНА С НДС', 8: 'ЦЕНА С НДС',
         9: 'НА СКЛАДЕ', 10: 'ОЖИДАЕТСЯ шт', 11: 'ОЖИДАЕТСЯ шт', 12: 'ОЖИДАЕТСЯ шт', 13: 'ЦЕНА С НДС', 14: 'ЦЕНА С НДС',
         15: 'НА СКЛАДЕ', 16: 'ОЖИДАЕТСЯ шт', 17: 'ОЖИДАЕТСЯ шт', 18: 'ОЖИДАЕТСЯ шт'}
SUB = {0: 'БРЕНД ДГУ', 1: 'МОДЕЛЬ ДГУ', 2: 'кВт', 3: 'БРЕНД', 4: 'МОДЕЛЬ', 5: 'БРЕНД', 6: 'МОДЕЛЬ', 7: 'РРЦ', 8: 'ДИЛЕР', 9: 'шт',
       10: 'ОКТ', 11: 'НОЯБ', 12: 'ДЕК', 13: 'РРЦ', 14: 'ДИЛЕР', 15: 'шт', 16: 'ОКТ', 17: 'НОЯБ', 18: 'ДЕК'}


def model_row(model, alt_brand, alt_model, prices, open_stock, can_stock):
    """prices — (РРЦ откр., дилер откр., РРЦ кожух, дилер кожух); *_stock — (на складе, окт, нояб, дек)."""
    return ['Tide Power', model, 64, 'Cummins', '4BTA3.9-G11', alt_brand, alt_model, prices[0], prices[1], *open_stock,
            prices[2], prices[3], *can_stock]


def book(today_serial, stock_open=(0, 0, 0, 3)):
    rows = [
        model_row('FC80-C', 'Tide Power', 'FPA22-648', (97000, 73000, 112000, 84000), (0, 0, 0, 1), (0, 0, 0, 1)),
        model_row('FC80-C', 'Leroy-Somer', 'TAL-A44-C', (102000, 77000, 117000, 88000), (0, 0, 0, 0), (0, 0, 0, 0)),
        model_row('PDC125-C', 'Tide Power', 'FPA27-1205', (0, 0, 135000, 101000), (0, 0, 0, 0), (1, 0, 0, 6)),
    ]
    stock = [GROUP, FIELD, SUB,
             model_row('FC80-C', 'Tide Power', 'FPA22-648', (97000, 73000, 112000, 84000), stock_open, stock_open)
             + [1, 'Борис', 'Энергопроф', today_serial + 5, 2, 'Зыков', 'Хайтед', today_serial - 3],
             model_row('PDC125-C', 'Tide Power', 'FPA27-1205', (0, 0, 135000, 101000), (0, 0, 0, 0), (1, 0, 0, 6))
             + [1, 'Борис', 'Энерготека', today_serial + 1]]
    stock[0] = GROUP | {19: 'РЕЗЕРВИРОВАНИЕ', 20: 'РЕЗЕРВИРОВАНИЕ', 21: 'РЕЗЕРВИРОВАНИЕ', 22: 'РЕЗЕРВИРОВАНИЕ',
                              23: 'РЕЗЕРВИРОВАНИЕ', 24: 'РЕЗЕРВИРОВАНИЕ', 25: 'РЕЗЕРВИРОВАНИЕ', 26: 'РЕЗЕРВИРОВАНИЕ'}
    stock[1] = FIELD | {19: 'БРОНЬ 1 очереди', 20: 'БРОНЬ 1 очереди', 21: 'БРОНЬ 1 очереди', 22: 'БРОНЬ 1 очереди',
                              23: 'БРОНЬ 2 очереди', 24: 'БРОНЬ 2 очереди', 25: 'БРОНЬ 2 очереди', 26: 'БРОНЬ 2 очереди'}
    stock[2] = SUB | {19: 'Кол-во', 20: 'Менеджер', 21: 'Компания', 22: 'до какого числа', 23: 'Кол-во',
                            24: 'Менеджер', 25: 'Компания', 26: 'до какого числа'}
    new = [{0: 'МОДЕЛЬ', 1: 'СЕРИЯ', 2: 'ГЕНЕРАТОР', 3: 'ГЕНЕРАТОР', 4: 'В КОЖУХЕ', 5: 'В КОЖУХЕ', 6: 'В КОЖУХЕ', 7: 'В КОЖУХЕ'},
           {0: 'МОДЕЛЬ', 2: 'ГЕНЕРАТОР', 3: 'ГЕНЕРАТОР', 4: 'Старая РРЦ', 5: 'Старая дилерская', 6: 'Новая РРЦ', 7: 'Новая дилерская'},
           ['FC80-C', 'PANDA', 'TIDE POWER', 'FPA22-648', 112000, 84000, 110000, 82500]]
    return Book.xlsx([('Прайс-лист', [GROUP, FIELD, SUB, *rows]), ('НОВЫЕ ЦЕНЫ', new), ('В наличии и В пути', stock)])


class TideBookTest(unittest.TestCase):
    TODAY = date(2026, 10, 29)
    SERIAL = (TODAY - date(1899, 12, 30)).days

    def rows(self, **kw):
        sheets = feed_files.read_xlsx(book(self.SERIAL, **kw))
        self.assertTrue(TideBook.applies(sheets))
        rows, summary = TideBook.price_rows(sheets, self.TODAY)
        return {(row['short'], row['genset']['exec'], row['genset']['alt']): row for row in rows}, summary

    def test_prices_new_over_list(self):
        rows, summary = self.rows()
        can = rows[('FC80-C', 'can', 'tide')]
        self.assertEqual((can['price'], can['dealer'], can['cur']), (110000, 82500, 'CNY'), 'НОВЫЕ ЦЕНЫ')
        self.assertEqual(rows[('FC80-C', 'open', 'tide')]['price'], 97000, 'нет в «НОВЫХ ЦЕНАХ» — прайс-лист')
        self.assertEqual(rows[('FC80-C', 'can', 'leroy')]['price'], 117000, 'другой альтернатор — своя строка')
        self.assertNotIn(('PDC125-C', 'open', 'tide'), rows, '0 в прайсе — исполнения нет')
        self.assertEqual(summary[0]['name'], 'Прайс-лист')

    def test_stock_from_stock_sheet_with_reserves(self):
        rows, _ = self.rows(stock_open=(4, 0, 2, 0))
        state = rows[('FC80-C', 'open', 'tide')]['stockInfo']
        self.assertEqual((state['qty'], state['reserve']), (3, 1), 'на складе 4 минус бронь 1; бронь 2 истекла')
        self.assertEqual((state['transit'], state['eta']), (2, 'ноябрь — 2'), 'ожидаемое — с листа наличия')
        pdc = rows[('PDC125-C', 'can', 'tide')]['stockInfo']
        self.assertEqual((pdc['qty'], pdc['reserve'], pdc['transit'], pdc['eta']), (0, 1, 6, 'декабрь — 6'))
        self.assertTrue(rows[('FC80-C', 'can', 'leroy')]['stockInfo']['order'], 'нет на складе и в пути — под заказ')

    def test_card_match_and_parse_price(self):
        rows, _ = feed_files.parse_price(book(self.SERIAL, stock_open=(4, 0, 2, 0)))
        got, why = feed_files.match_card('ДГУ Tide Power FC80-C в кожухе', 'FC80-C', {'execution': 'В кожухе', 'alternator': 'Tide Power'}, rows)
        self.assertEqual((why, got[0]['price']), ('', 110000))
        both, _ = feed_files.match_card('ДГУ FC80-C', 'FC80-C', {'execution': 'Открытое'}, rows)
        self.assertEqual(feed_files.GensetMatch.stock(both)['qty'], 3, 'карточка без альтернатора — наличие по всем')

    def test_hertz_like_head_does_not_crash(self):
        """Лист серии Tide Power без цен (шапка «Модель / Наличие / РРЦ» — как у листа машин HERTZ) ронял разбор HERTZ."""
        sheet = [{1: 'МАРКА', 2: 'МОДЕЛЬ', 3: 'НАЛИЧИЕ', 4: 'ДВИГАТЕЛЬ', 6: 'НОМИН. МОЩН.', 12: 'РРЦ с НДС ОТКРЫТАЯ'},
                 {6: 'кВт', 7: 'кВА'},
                 {1: 'Tide Power', 2: 'PDC10-SA', 3: 'под заказ', 4: 'Lister Petter', 6: 8, 7: 10, 12: 0}]
        GensetBook.price_rows(feed_files.read_xlsx(Book.xlsx([('Lister Panda', sheet)])))


if __name__ == '__main__':
    unittest.main()
