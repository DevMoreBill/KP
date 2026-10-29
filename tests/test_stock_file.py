# -*- coding: utf-8 -*-
"""Файл остатков поставщика (feed_files.StockFile): одна модель несколькими строками — складывается (разные коды партий),
общее название запчасти у разных артикулов — разные товары; склады отдельными столбцами (и под общей шапкой «Остатки по
складам»), «Итого» не удваивает, свободный остаток важнее общего, резерв не считается; «в пути» и дата поступления (текстом
и числом Excel); прежние виды файлов — как раньше. Вымышленные данные."""
import unittest

from test_feed_genset import Book  # подключает kit — путь к app/
import feed_files  # noqa: E402


def parse(rows):
    return {row['name']: row for row in feed_files.parse_stock(Book.xlsx([('Остатки', rows)]))}


class StockFileTest(unittest.TestCase):
    def test_same_model_several_rows(self):
        got = parse([['Артикул', 'Номенклатура', 'Остаток'],
                     ['00-001', 'Компрессор TIDY 10-10 (O)', 2],
                     ['00-002', 'Компрессор TIDY 10-10 (O)', 3],
                     ['F-1', 'Фильтр масляный', 4],
                     ['F-2', 'Фильтр масляный', 1]])
        tidy = got['Компрессор TIDY 10-10 (O)']
        self.assertEqual((tidy['qty'], tidy['skus']), (5, ['00-001', '00-002']))
        rows = feed_files.parse_stock(Book.xlsx([('Остатки', [['Артикул', 'Номенклатура', 'Остаток'], ['F-1', 'Фильтр масляный', 4],
                                                               ['F-2', 'Фильтр масляный', 1]])]))
        self.assertEqual(sorted(row['qty'] for row in rows), [1, 4], 'общее название без кода — разные артикулы не складываются')

    def test_merged_row_found_by_any_code(self):
        stock = feed_files.parse_stock(Book.xlsx([('Остатки', [['Артикул', 'Номенклатура', 'Остаток'],
                                                               ['00-001', 'Компрессор TIDY 10-10 (O)', 2],
                                                               ['00-002', 'Компрессор TIDY 10-10 (O)', 3]])]))
        self.assertEqual(feed_files.stock_row(stock, '00-002', '')['qty'], 5)

    def test_warehouse_columns(self):
        got = parse([['Артикул', 'Номенклатура', 'Склад Москва', 'Склад Екатеринбург', 'Итого'],
                     ['A-1', 'Осушитель DK 20', 2, 3, 5],
                     ['A-2', 'Осушитель DK 30', '', 1, 1]])
        dk20 = got['Осушитель DK 20']
        self.assertEqual((dk20['qty'], dk20['wh']), (5, {'Склад Москва': 2, 'Склад Екатеринбург': 3}))
        self.assertEqual(got['Осушитель DK 30']['wh'], {'Склад Екатеринбург': 1})
        info = feed_files.stock_info(dk20)
        self.assertEqual(info['wh'], [['Склад Екатеринбург', 3], ['Склад Москва', 2]])

    def test_two_row_head_transit_and_dates(self):
        got = parse([['Артикул', 'Номенклатура', 'Остатки по складам', 'Остатки по складам', 'В пути', 'Дата поступления'],
                     ['', '', 'Москва', 'Новосибирск', '', ''],
                     ['B-1', 'Компрессор GON 50-8', 1, 0, 2, '15.11.2026'],
                     ['B-2', 'Компрессор GON 75-8', 0, 0, 4, 46353]])
        gon50, gon75 = got['Компрессор GON 50-8'], got['Компрессор GON 75-8']
        self.assertEqual((gon50['qty'], gon50['wh'], gon50['transit'], gon50['eta']), (1, {'Москва': 1}, 2, '15.11'))
        self.assertEqual((gon75['qty'], gon75['transit'], gon75['eta']), (0, 4, '27.11'), 'дата числом Excel (27.11.2026)')
        self.assertNotIn('Москва', got, 'вторая строка шапки — не товар')

    def test_free_over_total_and_reserve(self):
        got = parse([['Код', 'Наименование', 'Остаток', 'Резерв', 'Свободный остаток'],
                     ['C-1', 'Ресивер РВ-500', 5, 2, 3]])
        self.assertEqual(got['Ресивер РВ-500']['qty'], 3)

    def test_old_kinds(self):
        got = parse([['Артикул', 'Номенклатура', 'Количество', 'Склад'],
                     ['D-1', 'Фильтр GON 100', 4, 'НЭК (Москва)'],
                     ['D-2', 'Фильтр GON 200', 1, 'НЭК']])
        self.assertEqual(got['Фильтр GON 100']['wh'], {'НЭК (Москва)': 4})
        self.assertEqual(got['Фильтр GON 200']['wh'], {'НЭК (Москва)': 1}, 'короткое название склада — к полному')
        unnamed = parse([['Артикул', 'Номенклатура', ''], ['E-1', 'Сепаратор S-1', 7]])
        self.assertEqual(unnamed['Сепаратор S-1']['qty'], 7, 'количество без подписи — столбец с числами')

    def test_stock_text_with_date(self):
        import feeds
        self.assertEqual(feeds._stock_txt({'qty': 0, 'transit': 2, 'eta': '15.11'}), 'нет в наличии; в пути 2 (до 15.11)')


if __name__ == '__main__':
    unittest.main()
