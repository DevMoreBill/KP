# -*- coding: utf-8 -*-
"""Контакты в карточке клиента: правка, новый контакт, проверка ввода, прочие поля клиента и контакта не теряются."""
import unittest

from client_contacts import ClientContacts
from kit import TempStore


class ClientContactsTest(unittest.TestCase):
    CID = 'inn7707083893'

    def setUp(self):
        self.st = TempStore(self).store
        self.st.client_put(self.CID, {'id': self.CID, 'name': 'ООО «Пример»', 'inn': '7707083893', 'notes': [{'text': 'заметка'}],
                                      'contacts': [{'name': 'Галкина Елена', 'phone': '+7 985 412-55-06', 'bx': 42}]})
        self.book = ClientContacts(self.st)

    def test_edit_keeps_other_fields(self):
        rows = self.book.save(self.CID, 0, {'name': 'Галкина Елена Викторовна', 'post': 'снабжение', 'phone': '+7 985 412-55-07',
                                            'email': 'galkina@example.com'}, 'Иванова')
        self.assertEqual(rows[0]['name'], 'Галкина Елена Викторовна')
        self.assertEqual(rows[0]['bx'], 42, 'метка контакта Битрикс24 сохраняется')
        client = self.st.client_get(self.CID)
        self.assertEqual(client['contacts'][0]['email'], 'galkina@example.com')
        self.assertEqual(client['notes'], [{'text': 'заметка'}])
        self.assertEqual(client['inn'], '7707083893')

    def test_add_first(self):
        rows = self.book.save(self.CID, None, {'name': 'Петров Олег', 'phone': '8 (900) 000-00-02'}, 'Иванова')
        self.assertEqual([row['name'] for row in rows], ['Петров Олег', 'Галкина Елена'])

    def test_checks(self):
        cases = [({'name': ''}, 'ФИО'), ({'name': 'А', 'phone': '123'}, 'Телефон'), ({'name': 'А', 'email': 'не почта'}, 'Почта'),
                 ({'name': 'галкина  елена'}, 'уже есть'), ('строка', 'Нет данных')]
        for raw, text in cases:
            with self.subTest(raw=raw), self.assertRaisesRegex(ValueError, text):
                self.book.save(self.CID, None, raw, 'Иванова')
        for index in (5, -1, 'x'):
            with self.subTest(index=index), self.assertRaisesRegex(ValueError, 'не найден'):
                self.book.save(self.CID, index, {'name': 'Б'}, 'Иванова')
        with self.assertRaises(LookupError):
            self.book.save('inn0000000000', None, {'name': 'Б'}, 'Иванова')
        self.assertEqual(len(self.st.client_get(self.CID)['contacts']), 1, 'ошибка ввода ничего не меняет')

    def test_same_name_on_its_own_row(self):
        rows = self.book.save(self.CID, 0, {'name': 'Галкина Елена', 'phone': ''}, 'Иванова')
        self.assertEqual(rows[0]['phone'], '', 'телефон можно стереть')


if __name__ == '__main__':
    unittest.main()
