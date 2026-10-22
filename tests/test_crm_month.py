# -*- coding: utf-8 -*-
"""«Отчёт за месяц» (app/crm_month.py, /api/crm/month): книга Excel — итоги, по менеджерам, КП, сделки. Вымышленные данные."""
import io
import unittest
import zipfile
from datetime import date

from kit import SampleData, Stand, TempStore


class MonthReportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stand = Stand(sample=SampleData(items=3, clients=1, kps=2))
        cls.stand.start()

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def _get(self, query=''):
        return self.stand.http.req('GET', '/api/crm/month' + query, headers=Stand.as_manager(SampleData.MANAGERS[0]), raw=True)

    def test_book(self):
        status, body, _ = self._get()
        self.assertEqual(status, 200)
        book = zipfile.ZipFile(io.BytesIO(body))
        workbook = book.read('xl/workbook.xml').decode('utf-8')
        for name in ('Итоги', 'По менеджерам', 'КП', 'Сделки'):
            self.assertIn(f'name="{name}"', workbook)
        totals = book.read('xl/worksheets/sheet1.xml').decode('utf-8')
        self.assertIn('КП выпущено', totals)

    def test_month_checked(self):
        status, _body, _ = self._get('?m=2026-13')
        self.assertEqual(status, 400)



class MonthClassTest(unittest.TestCase):
    def test_deals_of_month(self):
        from crm import DealBook
        from crm_month import MonthReport
        store = TempStore(self).store
        DealBook(store).create({'title': 'Месяц', 'client': 'ООО «Тест»'}, 'm1', 'Иванова', 'тест')
        report = MonthReport(store, date.today().isoformat()[:7])
        self.assertEqual([deal['title'] for deal in report._deals()], ['Месяц'])
        self.assertEqual(MonthReport(store, '2001-01')._deals(), [])
        self.assertTrue(report.file_name().endswith('.xlsx'))
        with self.assertRaises(ValueError):
            MonthReport(store, '../x')


if __name__ == '__main__':
    unittest.main()
