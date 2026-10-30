# -*- coding: utf-8 -*-
"""Аудит 30.10: распаковка PDF в пределах бюджета документа, размер карточки клиента, запросы сервера — только http(s);
отметка «из Битрикс24 — обратно не отправлять» не снимается вложенным вызовом."""
import json
import os
import sys
import unittest
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app'))

import pdf_text  # noqa: E402
from bitrix import BitrixQueue  # noqa: E402
from counterparty import Counterparties  # noqa: E402
from kit import TempStore  # noqa: E402
from net import Net  # noqa: E402
from pdf_text import Doc, PdfText  # noqa: E402


def pdf(content_refs, streams):
    """PDF из одной страницы: /Contents — ссылки content_refs, потоки streams — [(номер, байты без сжатия)]."""
    contents = ' '.join(f'{num} 0 R' for num in content_refs)
    objs = {
        1: b'<< /Type /Catalog /Pages 2 0 R >>',
        2: b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        3: f'<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents [{contents}] >>'.encode(),
        4: b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    }
    for num, raw in streams:
        body = zlib.compress(raw, 9)
        objs[num] = f'<< /Length {len(body)} /Filter /FlateDecode >>\nstream\n'.encode() + body + b'\nendstream'
    out = b'%PDF-1.4\n'
    for num in sorted(objs):
        out += f'{num} 0 obj\n'.encode() + objs[num] + b'\nendobj\n'
    return out + b'trailer\n<< /Root 1 0 R >>\n%%EOF'


class PdfBudget(unittest.TestCase):
    TEXT = b'BT /F1 12 Tf 72 700 Td (Kompressornaya stanciya v konteinere) Tj ET'

    def test_text_as_before(self):
        res = PdfText.read(pdf([5, 6], [(5, self.TEXT), (6, b'BT /F1 12 Tf 72 680 Td (vtoraya stroka) Tj ET')]))
        self.assertIn('Kompressornaya stanciya v konteinere', res['text'])
        self.assertIn('vtoraya stroka', res['text'])
        self.assertEqual(res['pages'], 1)

    def test_repeated_stream_stops_at_budget(self):
        """Один сжатый поток, на который страница ссылается 40 раз, распаковывается не больше, чем позволяет бюджет."""
        calls = []
        real = pdf_text._decode_stream

        def counted(dic, raw):
            calls.append(1)
            return real(dic, raw)

        self.addCleanup(setattr, pdf_text, '_decode_stream', real)
        pdf_text._decode_stream = counted
        self.addCleanup(setattr, Doc, 'UNPACK_MIN', Doc.UNPACK_MIN)
        Doc.UNPACK_MIN = 4 * 1024 * 1024
        filler = b' ' * (1024 * 1024)
        res = PdfText.read(pdf([5] * 40, [(5, filler)]))
        self.assertLessEqual(len(calls), 5, 'сверх бюджета потоки не распаковываются')
        self.assertEqual(res['pages'], 1)


class ClientCard(unittest.TestCase):
    def test_huge_card_refused(self):
        """Общий справочник клиентов: карточка не больше 512 КБ, как у поставщика (раньше — до предела тела запроса)."""
        book = Counterparties(TempStore(self).store)
        with self.assertRaises(ValueError):
            book.save_client('c1', json.dumps({'name': 'x' * (600 * 1024)}).encode('utf-8'))
        book.save_client('c1', json.dumps({'name': 'ООО «Ромашка»'}, ensure_ascii=False).encode('utf-8'))
        self.assertEqual(book.store.client_get('c1')['name'], 'ООО «Ромашка»')


class ServiceUrl(unittest.TestCase):
    def test_only_http(self):
        """Адрес сервиса из «Настроек» вида file:// — отказ до запроса (urllib прочитал бы файл сервера)."""
        for url in ('file:///C:/KP/data/kp.sqlite3', 'ftp://example.com/x', 'api.example.com/v1'):
            with self.assertRaises(ValueError):
                Net.request(url)


class BitrixQuiet(unittest.TestCase):
    def test_nested_keeps_outer(self):
        """Пачка сделок из Битрикс24: вложенная правка не снимает отметку — остальные сделки пачки обратно не уходят."""
        with BitrixQueue.quietly():
            with BitrixQueue.quietly():
                self.assertTrue(BitrixQueue.quiet())
            self.assertTrue(BitrixQueue.quiet(), 'вложенный вызов не снимает отметку внешнего')
        self.assertFalse(BitrixQueue.quiet())


if __name__ == '__main__':
    unittest.main()
