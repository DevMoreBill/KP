# -*- coding: utf-8 -*-
"""Подставной Битрикс24 для проверок (tests/test_bitrix.py): REST по входящему вебхуку /rest/1/<ключ>/<метод>.json,
данные — в памяти. Только методы, которыми пользуется app/bitrix.py; поведение — по документации Битрикс24 REST
(списки по 50 с next, фильтры с префиксом «>», ошибки {error, error_description})."""
import json
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class FakeBitrix:
    KEY = 'abcdef123456'
    PAGE = 50

    def __init__(self):
        self.calls = []
        self.down = False
        self.no_todo = False
        self.seq = 100
        self.categories = [{'id': 0, 'name': 'Общая'}, {'id': 3, 'name': 'Продажи оборудования'}]
        self.stages = {'DEAL_STAGE_3': [('C3:NEW', 'Новая', 'P'), ('C3:PREPARATION', 'КП отправлено', 'P'), ('C3:EXECUTING', 'Переговоры', 'P'),
                                        ('C3:FINAL_INVOICE', 'Договор', 'P'), ('C3:WON', 'Успешно', 'S'), ('C3:LOSE', 'Провал', 'F')],
                       'DEAL_STAGE': [('NEW', 'Новая', 'P'), ('WON', 'Успешно', 'S'), ('LOSE', 'Провал', 'F')]}
        self.users = [{'ID': '1', 'NAME': 'Админ', 'LAST_NAME': 'Портала', 'EMAIL': 'admin@example.com'},
                      {'ID': '7', 'NAME': 'Анна', 'LAST_NAME': 'Иванова', 'EMAIL': 'ivanova@example.com'},
                      {'ID': '8', 'NAME': 'Олег', 'LAST_NAME': 'Петров', 'EMAIL': 'PETROV@example.com'}]
        self.ufields, self.companies, self.requisites, self.contacts, self.deals = [], {}, {}, {}, {}
        self.deal_people, self.company_people = {}, {}  # контакты, привязанные к сделке и к компании списком связей
        self.rows, self.comments, self.activities, self.addresses = {}, [], {}, []
        self.portal_fields = []          # свои поля сделки портала (кабинет как Битрикс24): {FIELD_NAME, USER_TYPE_ID, L, ITEMS}
        srv = ThreadingHTTPServer(('127.0.0.1', 0), self._handler())
        self.srv = srv
        self.port = srv.server_address[1]
        self.url = 'http://127.0.0.1:%d/rest/1/%s/' % (self.port, self.KEY)
        threading.Thread(target=srv.serve_forever, daemon=True).start()

    def stop(self):
        self.srv.shutdown()
        self.srv.server_close()

    @staticmethod
    def now():
        return datetime.now(timezone.utc).astimezone().isoformat(timespec='seconds')

    def _id(self):
        self.seq += 1
        return str(self.seq)

    def methods(self):
        return [m for m, _ in self.calls]

    # ---------- HTTP
    def _handler(self):
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                n = int(self.headers.get('Content-Length') or 0)
                body = json.loads(self.rfile.read(n).decode('utf-8') or '{}')
                parts = self.path.strip('/').split('/')
                if fake.down:
                    self.send_response(503)
                    self.end_headers()
                    return
                if len(parts) != 4 or parts[0] != 'rest' or parts[2] != fake.KEY:
                    return self._out(401, {'error': 'INVALID_CREDENTIALS', 'error_description': 'Invalid request credentials'})
                method = parts[3][:-5] if parts[3].endswith('.json') else parts[3]
                fake.calls.append((method, body))
                try:
                    res = fake.handle(method, body)
                except KeyError:
                    return self._out(400, {'error': 'ERROR_METHOD_NOT_FOUND', 'error_description': 'Method not found!'})
                except ValueError as e:
                    return self._out(400, {'error': 'ERROR_CORE', 'error_description': str(e)})
                self._out(200, res)

            def _out(self, code, obj):
                raw = json.dumps(obj, ensure_ascii=False).encode('utf-8')
                self.send_response(code)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
        return H

    def page(self, rows, body):
        start = int(body.get('start') or 0)
        out = {'result': rows[start:start + self.PAGE], 'total': len(rows)}
        if start + self.PAGE < len(rows):
            out['next'] = start + self.PAGE
        return out

    @staticmethod
    def match(row, flt):
        for k, v in (flt or {}).items():
            if isinstance(v, list):                      # список значений — «одно из»
                if str(row.get(k) if row.get(k) is not None else '') not in {str(x) for x in v}:
                    return False
            elif k.startswith('>='):
                if not str(row.get(k[2:]) or '') >= str(v):
                    return False
            elif k.startswith('>'):
                if not str(row.get(k[1:]) or '') > str(v):
                    return False
            elif str(row.get(k) if row.get(k) is not None else '') != str(v):
                return False
        return True

    # ---------- методы
    def handle(self, m, b):
        f = b.get('fields') or {}
        if m == 'profile':
            return {'result': {'ID': '1', 'NAME': 'Админ', 'LAST_NAME': 'Портала', 'ADMIN': True}}
        if m == 'crm.category.list':
            return {'result': {'categories': self.categories}}
        if m == 'crm.status.list':
            ent = (b.get('filter') or {}).get('ENTITY_ID')
            return self.page([{'STATUS_ID': s, 'NAME': n, 'EXTRA': {'SEMANTICS': {'S': 'success', 'F': 'failure'}.get(sem, 'process')}}
                              for s, n, sem in self.stages.get(ent, [])], b)
        if m == 'user.get':
            return self.page(self.users, b)
        if m == 'crm.deal.fields':
            out = {'TITLE': {'type': 'string', 'title': 'Название'}, 'COMMENTS': {'type': 'string', 'title': 'Комментарий'},
                   'ID': {'type': 'integer', 'isReadOnly': True, 'title': 'ID'}}
            for u in self.ufields + [{'FIELD_NAME': 'UF_CRM_1700000001', 'USER_TYPE_ID': 'double', 'L': 'Маржа (отдел продаж)'}] + self.portal_fields:
                out[u['FIELD_NAME']] = {'type': u['USER_TYPE_ID'], 'formLabel': u.get('L') or u['FIELD_NAME'], 'title': u['FIELD_NAME'],
                                        'isMultiple': bool(u.get('MULTIPLE')), **({'items': u['ITEMS']} if u.get('ITEMS') else {})}
            return {'result': out}
        if m == 'crm.deal.userfield.list':
            return self.page(self.ufields, b)
        if m == 'crm.deal.userfield.add':
            self.ufields.append({'FIELD_NAME': 'UF_CRM_' + f['FIELD_NAME'], 'USER_TYPE_ID': f['USER_TYPE_ID']})
            return {'result': len(self.ufields)}
        if m == 'crm.requisite.preset.list':
            return self.page([{'ID': '1', 'NAME': 'Организация', 'ENTITY_TYPE_ID': 8}, {'ID': '2', 'NAME': 'ИП'}], b)
        if m == 'crm.requisite.list':
            return self.page([r for r in self.requisites.values() if self.match(r, b.get('filter'))], b)
        if m == 'crm.requisite.add':
            i = self._id()
            self.requisites[i] = dict(f, ID=i)
            return {'result': i}
        if m == 'crm.address.add':
            self.addresses.append(f)
            return {'result': True}
        if m == 'crm.company.list':
            return self.page([c for c in self.companies.values() if self.match(c, b.get('filter'))], b)
        if m == 'crm.company.add':
            i = self._id()
            self.companies[i] = dict(f, ID=i)
            return {'result': int(i)}
        if m == 'crm.company.get':
            return {'result': self.companies[str(b['id'])]}
        if m == 'crm.contact.list':
            return self.page([c for c in self.contacts.values() if self.match(c, b.get('filter'))], b)
        if m in ('crm.deal.contact.items.get', 'crm.company.contact.items.get'):
            links = self.deal_people if m.startswith('crm.deal') else self.company_people
            return {'result': [{'CONTACT_ID': cid} for cid in links.get(str(b['id']), [])]}
        if m == 'crm.contact.get':
            return {'result': self.contacts[str(b['id'])]}
        if m == 'crm.contact.add':
            i = self._id()
            self.contacts[i] = dict(f, ID=i)
            return {'result': int(i)}
        if m == 'crm.deal.add':
            i = self._id()
            st = f.get('STAGE_ID') or ('C%s:NEW' % f.get('CATEGORY_ID') if f.get('CATEGORY_ID') else 'NEW')
            self.deals[i] = dict(f, ID=i, STAGE_ID=st, DATE_CREATE=self.now(), DATE_MODIFY=self.now(),
                                 ASSIGNED_BY_ID=str(f.get('ASSIGNED_BY_ID') or '1'), CATEGORY_ID=str(f.get('CATEGORY_ID') or 0))
            return {'result': int(i)}
        if m == 'crm.deal.get':
            return {'result': self.deals[str(b['id'])]}
        if m == 'crm.deal.update':
            d = self.deals[str(b['id'])]
            d.update(f)
            d['DATE_MODIFY'] = self.now()
            return {'result': True}
        if m == 'crm.item.update':        # смена воронки сделки (entityTypeId 2)
            d = self.deals[str(b['id'])]
            d.update(CATEGORY_ID=str(f['categoryId']), STAGE_ID=f['stageId'], DATE_MODIFY=self.now())
            return {'result': {'item': {'id': int(b['id'])}}}
        if m == 'crm.deal.list':
            rows = sorted((d for d in self.deals.values() if self.match(d, b.get('filter'))), key=lambda d: d['DATE_MODIFY'])
            return self.page(rows, b)
        if m == 'crm.deal.productrows.set':
            self.rows[str(b['id'])] = b['rows']
            return {'result': True}
        if m == 'crm.timeline.comment.add':
            self.comments.append(f)
            return {'result': len(self.comments)}
        if m == 'crm.activity.todo.add':
            if self.no_todo:
                raise KeyError(m)
            i = self._id()
            self.activities[i] = {'ID': i, 'OWNER_TYPE_ID': '2', 'OWNER_ID': str(b['ownerId']), 'SUBJECT': b['title'], 'DEADLINE': b['deadline'] + '+03:00',
                                  'COMPLETED': 'N', 'TYPE_ID': '6', 'RESPONSIBLE_ID': str(b.get('responsibleId') or '1'), 'DESCRIPTION': b.get('description') or '',
                                  'LAST_UPDATED': self.now()}
            return {'result': {'id': int(i)}}
        if m == 'crm.activity.add':
            i = self._id()
            self.activities[i] = dict(f, ID=i, OWNER_ID=str(f['OWNER_ID']), OWNER_TYPE_ID=str(f['OWNER_TYPE_ID']), TYPE_ID=str(f['TYPE_ID']),
                                      DEADLINE=f['DEADLINE'] + '+03:00', LAST_UPDATED=self.now())
            return {'result': int(i)}
        if m == 'crm.activity.update':
            a = self.activities[str(b['id'])]
            a.update(f)
            if 'DEADLINE' in f and '+' not in f['DEADLINE']:
                a['DEADLINE'] = f['DEADLINE'] + '+03:00'
            a['LAST_UPDATED'] = self.now()
            return {'result': True}
        if m == 'crm.activity.list':
            return self.page([a for a in self.activities.values() if self.match(a, b.get('filter'))], b)
        raise KeyError(m)

    # ---------- «пользователь Битрикса» правит
    def edit_deal(self, i, **f):
        self.deals[str(i)].update(f)
        self.deals[str(i)]['DATE_MODIFY'] = self.now()

    def new_deal(self, **f):
        i = self._id()
        self.deals[i] = dict({'TITLE': 'Сделка с сайта', 'CATEGORY_ID': '3', 'STAGE_ID': 'C3:NEW', 'ASSIGNED_BY_ID': '7', 'OPPORTUNITY': '0',
                              'DATE_CREATE': self.now()}, **f, ID=i, DATE_MODIFY=self.now())
        return i

    def add_activity(self, owner, subj, deadline, **f):
        i = self._id()
        self.activities[i] = dict({'ID': i, 'OWNER_TYPE_ID': '2', 'OWNER_ID': str(owner), 'SUBJECT': subj, 'DEADLINE': deadline, 'COMPLETED': 'N',
                                   'TYPE_ID': '2', 'RESPONSIBLE_ID': '7', 'LAST_UPDATED': self.now()}, **f)
        return i
