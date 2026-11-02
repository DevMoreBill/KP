"""Проверка КП в Word после сохранения 3.271.0 (word_layout.WordLayout, POST /api/kp/<id>/layout, функция wordCheck):
разбор ответа Word, сценарий Word только читает файл, без Word на сервере — «нет проверки», выключенная функция закрыта.
Стенд с вымышленными данными, рабочая база не используется; Word на стенде не нужен (его ответ подменяется)."""

import io
import json
import os
import subprocess
import sys
import unittest
import zipfile
from unittest import mock

from kit import REPO, Stand

sys.path.insert(0, os.path.join(REPO, 'app'))
import pdf_convert
from word_layout import WordLayout


def docx() -> bytes:
    """Минимальный документ Word (проходит проверку DocxCheck)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        z.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types><Override PartName="/word/document.xml" '
                   'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        z.writestr('word/document.xml', '<?xml version="1.0"?><w:document><w:body><w:p/></w:body></w:document>')
    return buf.getvalue()


class ParseTest(unittest.TestCase):
    def test_line(self):
        out = WordLayout.parse('шум\r\nKPLAYOUT 10 2 100,6,60,80,32,95,85,76,90,54\r\n')
        self.assertEqual(out, {'available': True, 'pages': 10, 'cover': 2, 'fill': [100, 6, 60, 80, 32, 95, 85, 76, 90, 54]})
        self.assertEqual(WordLayout.parse('KPLAYOUT 1 0 140')['fill'], [100], 'больше 100 % не бывает')
        self.assertEqual(WordLayout.parse('KPLAYOUT 3 1 100,-1,40\n')['fill'], [100, -1, 40], 'лист без положения строк')
        self.assertEqual(WordLayout.parse('KPLAYOUT 1 0 \n')['fill'], [], 'без листов')
        self.assertIsNone(WordLayout.parse('Exception calling "Open"'))

    def test_script_reads_only(self):
        """Сценарий открывает файл только для чтения и ничего не сохраняет; служба SYSTEM — как для PDF."""
        script = WordLayout.SCRIPT
        self.assertTrue(script.startswith(pdf_convert.SYSTEM_DESKTOP))
        self.assertIn('$w.Documents.Open($env:KP_DOC_IN, $false, $true, $false)', script)
        self.assertNotRegex(script, r'\.Save|SaveAs|ExportAsFixedFormat')
        self.assertIn('$doc.Close(0)', script)
        self.assertIn('ComputeStatistics(2)', script)

    def test_without_word(self):
        with mock.patch.object(pdf_convert, 'word_available', return_value=False):
            self.assertEqual(WordLayout.measure('kp.docx'), {'available': False})

    def test_with_word(self):
        done = subprocess.CompletedProcess([], 0, b'KPLAYOUT 3 1 100,95,40\r\n', b'')
        with mock.patch.object(pdf_convert, 'word_available', return_value=True), \
                mock.patch.object(pdf_convert, 'powershell', return_value=done) as run:
            self.assertEqual(WordLayout.measure('kp.docx')['fill'], [100, 95, 40])
        self.assertEqual(run.call_args[0][1]['KP_DOC_IN'], 'kp.docx')
        failed = subprocess.CompletedProcess([], 1, b'', 'Ошибка: файл занят\r\nподробности'.encode('cp866'))
        with mock.patch.object(pdf_convert, 'word_available', return_value=True), \
                mock.patch.object(pdf_convert, 'powershell', return_value=failed), \
                self.assertRaisesRegex(RuntimeError, '^Ошибка: файл занят$'):
            WordLayout.measure('kp.docx')


class RouteTest(unittest.TestCase):
    KID = 'zzword1'
    WHO = {'X-KP-User-Id': 'm1', 'X-KP-User': 'm1'}

    @classmethod
    def setUpClass(cls):
        cls.stand = Stand(mode='local').start()

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def layout(self):
        return self.stand.http.req('POST', f'/api/kp/{self.KID}/layout', {}, headers=self.WHO)

    def test_1_no_file(self):
        self.assertEqual(self.layout()[0], 404, 'КП ещё не сохранено в Word')

    def test_2_no_word(self):
        meta = {'id': self.KID, 'number': 'Т-9', 'client': 'ООО «Пример»', 'authorId': 'm1', 'managerId': 'm1', 'sum': 1}
        self.assertEqual(self.stand.http.req('PUT', f'/api/kp/{self.KID}/meta', meta, headers=self.WHO)[0], 200)
        self.assertEqual(self.stand.http.req('PUT', f'/api/kp/{self.KID}/docx?name=kp.docx', docx(), headers=self.WHO)[0], 200)
        status, body, _ = self.layout()
        self.assertEqual(status, 200, body)
        self.assertEqual(json.loads(body), {'available': False}, 'на стенде нет Word — проверки нет, без ошибки')
        self.assertEqual(self.stand.request_errors(), [])

    def test_3_feature_off(self):
        cookie, headers = self.stand.admin()
        status = self.stand.http.req('POST', '/api/admin/features', {'values': {'wordCheck': {'on': False}}}, cookie=cookie, headers=headers)[0]
        self.assertEqual(status, 200)
        self.assertEqual(self.layout()[0], 403, 'выключенная функция закрыта на сервере')


if __name__ == '__main__':
    unittest.main()
