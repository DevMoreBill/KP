# -*- coding: utf-8 -*-
"""Ответственный сделок и дел из программы в Битрикс24 3.272.1 (по снимку уведомлений владельца 02.11: «Новая сделка … не
взята в работу. Ответственный — администратор портала»): crm.deal.add без ASSIGNED_BY_ID Битрикс отдаёт владельцу вебхука.
Менеджер без пары в «Менеджерах» — пара по e-mail находится сама и запоминается; не нашлась — сделка не создаётся и ждёт
в «Не отправлено» с причиной; дело — ответственному сделки. Подставной Битрикс (bitrix_fake.py), временная база."""
import json
import unittest

from test_bitrix import SyncBase


class OwnerTest(SyncBase):
    def manager(self, mid, name, email=''):
        self.st.manager_put(mid, json.dumps({'name': name, 'email': email}, ensure_ascii=False), 'тест')

    def push(self, did):
        from bitrix import BitrixQueue
        BitrixQueue.touch(self.st, 'deal', did)
        return self.sync().run()

    def failed(self):
        from bitrix import BitrixQueue
        return BitrixQueue(self.st).failed()

    def test_new_manager_paired_by_email(self):
        """Менеджер добавлен после настройки «Менеджеров»: пользователь портала с тем же e-mail — ответственный, пара запомнена."""
        from bitrix import BitrixConf, BitrixLog
        self.fake.users.append({'ID': '9', 'NAME': 'Мария', 'LAST_NAME': 'Сидорова', 'EMAIL': 'Sidorova@Example.com'})
        self.manager('m3', 'Сидорова Мария', 'sidorova@example.com')
        did = self.kp('26-0101', authorId='m3', manager='Сидорова Мария')
        res = self.push(did)
        self.assertEqual((res['sent'], res['failed']), (1, 0), res)
        deal = list(self.fake.deals.values())[0]
        self.assertEqual(deal['ASSIGNED_BY_ID'], '9', 'не администратор портала (1)')
        self.assertEqual(BitrixConf(self.st).get()['users'].get('m3'), '9', 'пара запомнена, как в «Менеджерах»')
        self.assertIn('сопоставлен', json.dumps(BitrixLog(self.st).tail(), ensure_ascii=False))

    def test_unpaired_manager_deal_waits(self):
        """Пары нет и по e-mail: сделка (и компания) в Битриксе не создаётся, причина — в «Не отправлено»; пару выбрали —
        сделка уходит с этим ответственным."""
        from bitrix import BitrixConf, BitrixQueue
        self.manager('m4', 'Новиков Пётр', 'novikov@other.ru')
        did = self.kp('26-0102', authorId='m4', manager='Новиков Пётр')
        res = self.push(did)
        self.assertEqual((res['sent'], res['failed']), (0, 1), res)
        self.assertEqual(self.fake.deals, {}, 'сделка не создана')
        self.assertEqual(self.fake.companies, {}, 'компания не создана')
        [item] = self.failed()
        self.assertIn('Новиков Пётр', item['error'])
        self.assertIn('не сопоставлен', item['error'])
        self.assertLessEqual(len(item['error']), 300, 'причина целиком в «Не отправлено»')
        users = dict(BitrixConf(self.st).get()['users'], m4='8')
        BitrixConf(self.st).save({'users': users}, 'тест')
        BitrixQueue(self.st).retry_all()
        res = self.sync().run()
        self.assertEqual((res['sent'], res['failed']), (1, 0), res)
        self.assertEqual(list(self.fake.deals.values())[0]['ASSIGNED_BY_ID'], '8')

    def test_deal_without_manager_waits(self):
        did = self.kp('26-0103', authorId='', manager='')
        from crm import DealBook
        self.assertEqual(DealBook(self.st).get(did)['managerId'], '')
        res = self.push(did)
        self.assertEqual(res['failed'], 1, res)
        self.assertEqual(self.fake.deals, {})
        self.assertIn('нет ответственного', self.failed()[0]['error'])

    def test_task_follows_deal_owner(self):
        """Дело менеджера без пары — ответственному сделки (менеджер сделки), не администратору портала."""
        from crm import TaskBook
        self.manager('m5', 'Без Почты')
        did = self.kp('26-0104')
        TaskBook(self.st).add({'kind': 'call', 'due': '2026-11-10', 'title': 'Позвонить'}, 'm5', 'тест', deal=did)
        res = self.push(did)
        self.assertEqual(res['failed'], 0, res)
        [todo] = list(self.fake.activities.values())
        self.assertEqual(todo['RESPONSIBLE_ID'], '7', 'менеджер сделки (Иванова), не администратор (1)')

    def test_paired_manager_unchanged(self):
        did = self.kp('26-0105')
        res = self.push(did)
        self.assertEqual((res['sent'], res['failed']), (1, 0), res)
        self.assertEqual(list(self.fake.deals.values())[0]['ASSIGNED_BY_ID'], '7')


if __name__ == '__main__':
    unittest.main()
