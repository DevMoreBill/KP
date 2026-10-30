"""«Настройки» → данные: выгрузка и загрузка базы, разделов, каталога и файла настроек."""

import json
import os
import re
import secrets
import sys
from collections.abc import Iterator
from datetime import datetime
from typing import Any

from admin_access import _loads, actor
from admin_accounts import AdminSessions, _now, accounts
from admin_base import AdminBase
from admin_rights import AdminRights
from data_file import Load
from server_log import ErrorText

SECTIONS = ('catalog', 'kp', 'managers', 'clients', 'suppliers', 'audit', 'settings')
SECTION_FILE = {
    'catalog': 'каталог',
    'kp': 'КП',
    'managers': 'менеджеры',
    'clients': 'клиенты',
    'suppliers': 'поставщики',
    'audit': 'журнал',
    'settings': 'настройки',
}  # части имени файла выгрузки


class AdminDataApi(AdminBase):
    """«Настройки» → данные: выгрузка и загрузка базы, разделов, каталога и файла настроек."""

    CONFLICTS_SHOWN = 30

    def bundle(self) -> Any:
        from data_bundle import DataBundle

        return DataBundle(os.path.join(os.path.dirname(self.store.path), 'img'))

    def export_cats(self) -> list:
        """Категории каталога для выборочной выгрузки: [{cat, count}] (названия и группы — у клиента в справочнике типов)."""
        return [
            {'cat': cat or '', 'count': count}
            for cat, count in self.store.all('SELECT cat, COUNT(*) FROM catalog GROUP BY cat ORDER BY cat')
        ]

    def export(
        self, sections, cats=None, fallback='json', sup=None, pick=None, fmt=None, flt=None, prices=None
    ) -> None:
        """Выбранные разделы базы файлом в любом формате (DataFile: xlsx, json, xml, yml, zip — решение владельца 18.10)."""
        from data_file import DataFile
        from supplier_scope import SupplierScope

        store = self.store
        out: dict = {}
        items = 0
        catalog = '[]'
        keep = None
        ids = None
        docs = None
        src: tuple | None = None
        fmt = DataFile.fmt(fmt, fallback)
        if fmt == 'yml':
            # YML — каталог для сайтов и маркетплейсов: только каталог и без закупки (она при загрузке остаётся в базе)
            if 'catalog' not in sections and not sup:
                raise ValueError('YML — формат каталога: отметьте раздел «Каталог» или выберите другой формат')
            sections = ['catalog']
        if sup:
            docs = SupplierScope(store).docs(sup)
            sections, cats, items, keep = ['catalog'], None, len(docs), list(SupplierScope.PRICE_KEYS)
            catalog = json.dumps(docs, ensure_ascii=False)
            out['catalog'] = None
        elif 'catalog' in sections and (pick or flt is not None):
            from supplier_scope import CatalogFilter, ExportScope

            if flt is not None:
                ids, keep = CatalogFilter(store).ids(flt), CatalogFilter.keep(prices)
                sections = ['catalog']
            else:
                ids = ExportScope(store).ids(pick)
            out['catalog'] = None
            items = len(ids)
            parts = [
                store.joined(
                    'SELECT doc AS x FROM catalog WHERE id IN ({}) ORDER BY name'.format(
                        ','.join('?' * len(ids[i : i + 500]))
                    ),
                    tuple(ids[i : i + 500]),
                )
                for i in range(0, len(ids), 500)
            ]
            catalog = '[' + ','.join(x for x in parts if x) + ']'
            if keep:
                docs = [SupplierScope.strip(card, keep) for card in json.loads(catalog)]
                catalog = json.dumps(docs, ensure_ascii=False)
            elif fmt != 'yml':
                src = ('WHERE id IN (%s)', ids)
        elif 'catalog' in sections:
            # каталог — готовыми строками из базы, без разбора и повторной сборки: 25 000 позиций занимали 1,3 ГБ памяти сервера
            where, args = ('WHERE cat IN ({})'.format(','.join('?' * len(cats))), tuple(cats)) if cats else ('', ())
            out['catalog'] = None
            items = store.scalar('SELECT COUNT(*) FROM catalog ' + where, args)
            catalog = '[' + store.joined(f'SELECT doc AS x FROM catalog {where} ORDER BY name', args) + ']'
            src = (where, args)
        if fmt == 'yml' and 'catalog' in out:
            cost = list(SupplierScope.COST_KEYS)
            docs = [SupplierScope.strip(card, cost) for card in (docs if docs is not None else json.loads(catalog))]
            catalog, keep, src = json.dumps(docs, ensure_ascii=False), sorted(set(keep or []) | set(cost)), None
        cur = self.current(sections)
        for k in ('kp', 'managers', 'clients', 'audit', 'suppliers', 'settings'):
            if k in cur:
                out[k] = cur[k]
        from version import VERSION

        extra = [
            ('cats', cats if cats else None),
            ('pick', {k: sorted(v) for k, v in pick.items()} if pick and 'catalog' in sections else None),
            ('supplier', sup or None),
            ('keep', keep or None),
            ('filter', json.loads(json.dumps(flt, ensure_ascii=False, default=sorted)) if flt is not None else None),
        ]
        if fmt in ('xlsx', 'xml', 'yml'):
            # таблица и XML строятся из разобранных данных: каталог разбирается один раз (отпечатки — из него же), строка JSON
            # всей выгрузки не собирается — 25 000 позиций в Excel занимали больше гигабайта памяти сервера
            cat_docs = None
            if 'catalog' in out:
                cat_docs, catalog = (docs if docs is not None else json.loads(catalog)), ''
            digests = self.digests(out, cat_docs if cat_docs is not None else False)
            doc = {
                'format': 'kp-backup',
                'version': 1,
                'app': VERSION,
                'createdAt': _now(),
                'sections': {k: cat_docs if k == 'catalog' else v for k, v in out.items()},
            }
            doc.update((k, v) for k, v in extra if v is not None)
            doc['digests'] = digests
            body = None
        else:
            digests = self.digests(
                out,
                ('catalog' in out)
                and (docs if docs is not None and src is None else self._rows(src) if src else json.loads(catalog)),
            )
            secs = ','.join(
                '{}:{}'.format(json.dumps(k), catalog if k == 'catalog' else json.dumps(v, ensure_ascii=False))
                for k, v in out.items()
            )
            del catalog
            body = (
                '{{"format":"kp-backup","version":1,"app":{},"createdAt":{},"sections":{{{}}}{},"digests":{}}}'.format(
                    json.dumps(VERSION),
                    json.dumps(_now()),
                    secs,
                    ''.join(f',{json.dumps(k)}:{json.dumps(v, ensure_ascii=False)}' for k, v in extra if v is not None),
                    json.dumps(digests, separators=(',', ':')),
                )
            )
            del secs
            doc = None
        what = (
            ('+'.join(SECTION_FILE[x] for x in sections) if len(sections) < len(SECTIONS) else 'вся_база')
            + (f'_категорий-{len(cats)}' if cats else '')
            + (f'_выборка-{items}' if (pick or flt is not None) and 'catalog' in sections else '')
        )
        if sup:
            what = 'каталог_' + (re.sub(r'[^\w.-]+', '_', sup).strip('_')[:60] or 'поставщик')
        stamp = datetime.now().strftime('%Y-%m-%d_%H%M')
        info = {'sections': sections, 'cats': cats, 'items': items, 'fmt': fmt}
        if pick:
            info['pick'] = {k: len(v) for k, v in pick.items()}
        if flt is not None:
            info['filter'] = True
            info['keep'] = keep or []
        if sup:
            info['supplier'] = sup[:120]
        data, ext, ctype, more = self.data_file().dump(body, fmt, doc)
        del body, doc
        self.log('export_db', 'db', ','.join(sections), None, dict(info, bytes=len(data), **more))
        return self.handler.send(200, ctype, data, self.handler.attachment(f'КП_выгрузка_{what}_{stamp}{ext}'))

    def data_file(self) -> Any:
        """Форматы выгрузки: подписи столбцов Excel — из справочника категорий, ссылки на фото в YML — адрес программы."""
        from data_file import DataFile
        from equipment_types import load_types

        types = {tdef.get('id'): tdef for tdef in load_types()['types'] if isinstance(tdef, dict)}
        labels: dict = {}
        for tdef in types.values():
            for field in tdef.get('fields') or []:
                if isinstance(field, dict) and field.get('key') and field.get('label'):
                    labels.setdefault(
                        'attrs.{}'.format(field['key']),
                        field['label'] + (', ' + field['unit'] if field.get('unit') else ''),
                    )
        host = re.sub(r'[^A-Za-z0-9.:\-\[\]]', '', self.handler.headers.get('Host') or '')
        return DataFile(
            os.path.join(os.path.dirname(self.store.path), 'img'), 'http://' + host if host else '', labels, types
        )

    def current(self, sections) -> dict:
        """Разделы базы, кроме каталога, — как в файле выгрузки."""
        store = self.store
        out: dict[str, Any] = {}
        if 'kp' in sections:
            out['kp'] = [
                dict(zip(('id', 'number', 'state', 'meta', 'docx', 'updated', 'track'), row, strict=False))
                for row in store.all('SELECT id, number, state, meta, docx, updated, track FROM kp')
            ]
        if 'managers' in sections:
            out['managers'] = json.loads(store.managers_list())
        if 'clients' in sections:
            out['clients'] = store.clients_all()
        if 'audit' in sections:
            out['audit'] = store.audit_query({}, 10**7)['items']
        if 'suppliers' in sections:
            out['suppliers'] = {
                'suppliers': [{k: v for k, v in x.items() if k != '_rev'} for x in store.suppliers_list()],
                'customs': store.customs_all(),
            }
        if 'settings' in sections:
            from data_bundle import ProgramSettings

            out['settings'] = ProgramSettings(store).export()
        return out

    def _rows(self, src) -> Iterator[dict]:
        """Позиции каталога по одной (для отпечатков): условие WHERE … или список id."""
        where, args = src
        if '%s' in where:
            for i in range(0, len(args), 500):
                part = tuple(args[i : i + 500])
                for (doc,) in self.store.all('SELECT doc FROM catalog ' + where % ','.join('?' * len(part)), part):
                    yield _loads(doc) or {}
            return
        for (doc,) in self.store.all('SELECT doc FROM catalog ' + where, args):
            yield _loads(doc) or {}

    def digests(self, out, catalog) -> dict:
        """Отпечатки записей на момент выгрузки: {раздел: {id: отпечаток}}; у настроек — {"_": отпечаток}."""
        from data_file import DataFile
        from supplier_scope import SupplierScope

        res = {}
        if catalog:
            res['catalog'] = {
                x['id']: DataFile.digest(x, SupplierScope.VOLATILE)
                for x in catalog
                if isinstance(x, dict) and x.get('id')
            }
        for k in ('kp', 'managers', 'clients'):
            if isinstance(out.get(k), list):
                res[k] = {str(x.get('id')): DataFile.digest(x) for x in out[k] if isinstance(x, dict) and x.get('id')}
        if isinstance(out.get('suppliers'), dict):
            res['suppliers'] = {
                str(x.get('id')): DataFile.digest(x) for x in out['suppliers'].get('suppliers') or [] if x.get('id')
            }
        if 'settings' in out:
            res['settings'] = {'_': DataFile.digest(out['settings'])}
        return res

    def export_sqlite(self) -> None:
        """Файл базы целиком — архивом ZIP (kp.sqlite3 внутри): в 15–20 раз меньше, загружается обратно как есть."""
        tmp = os.path.join(os.path.dirname(self.store.path), 'backup', f'export-{secrets.token_hex(4)}.zip')
        self.store.backup(tmp)
        try:
            with open(tmp, 'rb') as handle:
                data = handle.read()
        finally:
            os.remove(tmp)
        self.log('export_db', 'db', 'sqlite', None, {'bytes': len(data)})
        return self.handler.send(
            200,
            'application/zip',
            data,
            self.handler.attachment('kp_{}.zip'.format(datetime.now().strftime('%Y-%m-%d_%H%M'))),
        )

    def _keys_right(self) -> Any:
        """Файл настроек загружает администратор с правом «Ключи и пароли» — ключи и адреса из файла, иначе — текущие."""
        from data_bundle import Keys

        login = (AdminSessions.of(self.handler) or {}).get('login', '')
        return Keys.WITH if AdminRights(accounts(self.store)).has_action(login, 'secrets') else Keys.WITHOUT

    ADMIN_KEYS = ('admins', 'admin', AdminSessions.KV_KEY)

    def _kept_on_import(self) -> tuple:
        """Не главный администратор загружает базу — учётные записи администраторов и их сессии остаются текущими."""
        login = (AdminSessions.of(self.handler) or {}).get('login', '')
        acc = AdminRights(accounts(self.store)).account(login)
        return () if acc is not None and AdminRights.is_main(acc) else self.ADMIN_KEYS

    def import_sqlite(self, data, name='') -> dict:
        """Файл базы целиком (.sqlite3 или .zip с ним): проверка, копия текущей базы, замена содержимого «на ходу»."""
        import io
        import zipfile

        from storage import DbZip

        if not data:
            raise ValueError('Файл пустой')
        tmp = os.path.join(os.path.dirname(self.store.path), 'backup', f'import-{secrets.token_hex(4)}.sqlite3')
        os.makedirs(os.path.dirname(tmp), exist_ok=True)
        try:
            if data[:2] == b'PK':
                try:
                    DbZip.unpack(io.BytesIO(data), tmp)
                except zipfile.BadZipFile:
                    raise ValueError('Архив повреждён или это не архив ZIP') from None
            else:
                with open(tmp, 'wb') as handle:
                    handle.write(data)
            with open(tmp, 'rb') as handle:
                if handle.read(16) != b'SQLite format 3\x00':
                    raise ValueError('Это не файл базы SQLite (.sqlite3) и не архив с ним')
            import feeds

            if any(
                feeds.busy(fid) for fid in list(feeds.JOBS)
            ):  # фоновая загрузка писала бы старые карточки в новую базу
                raise ValueError('Идёт загрузка или проверка фида — дождитесь её окончания и загрузите файл базы снова')
            bak = self.store.restore_sqlite(tmp, keep_kv=self._kept_on_import())
        finally:
            for ext in ('', '-wal', '-shm', '-journal'):
                try:
                    os.remove(tmp + ext)
                except OSError:
                    pass
        rep = {
            'catalog': self.store.scalar('SELECT COUNT(*) FROM catalog'),
            'kp': self.store.scalar('SELECT COUNT(*) FROM kp'),
            'clients': self.store.scalar('SELECT COUNT(*) FROM clients'),
            'backup': bak,
            'file': str(name or '')[:120],
        }
        self.log(
            'import_db',
            'db',
            'sqlite',
            None,
            {'bytes': len(data), 'file': rep['file'], 'backup': bak, 'catalog': rep['catalog'], 'kp': rep['kp']},
        )
        return rep

    @staticmethod
    def _limits_ok(x) -> bool:
        from storage import DocLimits

        try:
            DocLimits.check(x, 'Карточка')
            return True
        except ValueError:
            return False

    DUP_KEYS = {'name': 'фамилия и имя', 'email': 'e-mail', 'mobile': 'мобильный телефон', 'ext': 'добавочный номер'}

    def _dup_in_file(self, x, seen) -> str:
        """Повтор менеджера внутри одного файла (те же ключи, что manager_dup для базы). → что совпало или ''."""
        what = self.DUP_KEYS
        keys = self.store.manager_keys(x)
        return next(
            (
                what[what_key]
                for what_key in what
                if keys.get(what_key) and seen.get((what_key, keys[what_key])) not in (None, x.get('id'))
            ),
            '',
        )

    def _remember_in_file(self, x, seen) -> None:
        """Ключи менеджера — в «уже встречались в файле»."""
        keys = self.store.manager_keys(x)
        for what_key in self.DUP_KEYS:
            if keys.get(what_key):
                seen.setdefault((what_key, keys[what_key]), x.get('id'))

    def import_(self, data, load: Load, sections=None, mode='all', fmt='json') -> dict:
        """Проверка схемы и предпросмотр (что добавится / обновится); Load.APPLY — запись после копии базы."""
        apply = load is Load.APPLY
        if (
            not isinstance(data, dict)
            or data.get('format') != 'kp-backup'
            or data.get('version') != 1
            or not isinstance(data.get('sections'), dict)
        ):
            raise ValueError(
                'Это не выгрузка данных программы: нужен файл «КП_выгрузка_…», выгруженный в «Копии и база → Выгрузить»'
            )
        from data_file import DataFile

        sec = data['sections']
        want = [
            section
            for section in (sections or 'catalog,kp,managers,clients,suppliers,settings').split(',')
            if section in sec and section != 'audit' and section in SECTIONS
        ]
        store, rep, errors, conflicts = self.store, {}, [], []
        from supplier_scope import SupplierScope

        keep = SupplierScope.keep_of(data)  # выгрузка без цен и остатков: у имеющихся позиций они остаются как в базе
        digs = got_value if isinstance(got_value := data.get('digests'), dict) else {}
        edits = mode == 'edits' and bool(digs)
        if edits:
            keep = list(SupplierScope.PRICE_KEYS)
        author = actor(self.handler, True)[1]
        backup = self.import_backup() if apply else None
        exist = {
            'catalog': {x['id']: x for x in json.loads(store.catalog_light())},
            'kp': {row[0]: row for row in store.all('SELECT id, meta FROM kp')},
            'managers': {x['id']: x for x in json.loads(store.managers_list())},
            'clients': {x['id']: x for x in store.clients_all()},
            'suppliers': {x['id']: x for x in store.suppliers_list()},
        }
        req = {
            'catalog': ('id', 'name'),
            'kp': ('id', 'number'),
            'managers': ('id', 'name'),
            'clients': ('id',),
            'suppliers': ('id', 'name'),
        }
        from data_bundle import ProgramSettings

        def now_of(sec_key, cid) -> dict:
            """Запись базы сейчас — в том же виде, что в файле выгрузки (для сравнения отпечатков)."""
            if sec_key == 'catalog':
                return _loads(store.catalog_get(cid)) or {}
            if sec_key == 'kp':
                kp_row = store.one('SELECT id, number, state, meta, docx, updated, track FROM kp WHERE id=?', (cid,))
                return (
                    dict(zip(('id', 'number', 'state', 'meta', 'docx', 'updated', 'track'), kp_row, strict=False))
                    if kp_row
                    else {}
                )
            x = exist[sec_key].get(cid) or {}
            return {k: v for k, v in x.items() if k != '_rev'}

        for section in want:
            if section == 'settings':
                count = ProgramSettings(store).count(sec[section])
                if edits and (digs.get('settings') or {}).get('_'):
                    own = digs['settings']['_']
                    if DataFile.digest(sec[section]) == own:
                        rep[section] = {'new': 0, 'updated': 0, 'invalid': 0, 'same': count}
                        want = [x for x in want if x != 'settings']
                        continue
                    if DataFile.digest(ProgramSettings(store).export()) != own:
                        rep[section] = {'new': 0, 'updated': 0, 'invalid': 0, 'conflict': count}
                        conflicts.append('Настройки программы — изменены и в программе после выгрузки')
                        want = [x for x in want if x != 'settings']
                        continue
                rep[section] = {'new': 0, 'updated': count, 'invalid': 0}
                continue
            if section == 'suppliers':  # {suppliers: [...], customs: {ключ: {code, duty, note, name}}}
                rows = (sec[section].get('suppliers') if isinstance(sec[section], dict) else None) or []
            else:
                rows = sec[section] if isinstance(sec[section], list) else []
            for x in rows:
                if isinstance(x, dict) and isinstance(x.get('id'), (int, float)) and not isinstance(x.get('id'), bool):
                    x['id'] = str(int(x['id'])) if float(x['id']).is_integer() else str(x['id'])
            bad = [
                i
                for i, x in enumerate(rows)
                if not isinstance(x, dict)
                or any(not x.get(k) for k in req[section])
                or not re.match(r'^[A-Za-z0-9_-]{1,64}$', str(x.get('id')))
            ]
            errors += [f'{section}: запись {i + 1} без обязательных полей {", ".join(req[section])}' for i in bad[:5]]
            # то, на чём запись споткнулась бы посередине загрузки, — видно уже в предпросмотре и пропускается
            more = []
            seen: dict = {}
            for i, x in enumerate(rows):
                if i in bad:
                    continue
                if section == 'catalog' and 'attrs' in x and not isinstance(x['attrs'], (dict, type(None))):
                    more.append(i)
                    errors.append('Позиция «{}»: параметры не в том виде — пропущено'.format(str(x.get('name'))[:80]))
                elif section == 'suppliers' and not self._limits_ok(x):
                    more.append(i)
                    errors.append('Поставщик «{}»: карточка не в том виде — пропущено'.format(str(x.get('name'))[:80]))
                elif section == 'managers' and self._dup_in_file(x, seen):
                    more.append(i)
                    errors.append(
                        'Менеджер «{}»: повторяется в файле ({}) — пропущено'.format(
                            x.get('name'), self._dup_in_file(x, seen)
                        )
                    )
                if section == 'managers':
                    self._remember_in_file(x, seen)
                if i in more:
                    continue
                if section == 'kp' and not store.kp_import_ok(x):
                    more.append(i)
                    errors.append(f'КП {x.get("number") or x.get("id")}: испорченная запись — пропущено')
                elif section == 'managers':
                    dup = store.manager_dup(x['id'], x)
                    if dup:
                        more.append(i)
                        errors.append(
                            'Менеджер «{}»: такой уже есть — {} (совпадает {}), пропущено'.format(
                                x.get('name'), dup[0].get('name') or 'без имени', dup[1]
                            )
                        )
            bad += more
            skip = set(bad)
            ok = [x for i, x in enumerate(rows) if i not in skip]
            same = conf = 0
            if edits:
                digest, skip_keys, left = (
                    digs.get(section) or {},
                    SupplierScope.VOLATILE if section == 'catalog' else (),
                    [],
                )
                for x in ok:
                    own = digest.get(str(x['id']))
                    if own and DataFile.digest(x, skip_keys) == own:
                        same += 1
                        continue
                    if (
                        own
                        and x['id'] in exist[section]
                        and DataFile.digest(now_of(section, x['id']), skip_keys) != own
                    ):
                        conf += 1
                        if len(conflicts) < self.CONFLICTS_SHOWN:
                            conflicts.append(
                                '{} «{}» — изменено и в программе после выгрузки'.format(
                                    {
                                        'catalog': 'Позиция',
                                        'kp': 'КП',
                                        'managers': 'Менеджер',
                                        'clients': 'Клиент',
                                        'suppliers': 'Поставщик',
                                    }[section],
                                    x.get('name') or x.get('number') or x['id'],
                                )
                            )
                        continue
                    left.append(x)
                ok = left
            rep[section] = {
                'new': sum(1 for x in ok if x['id'] not in exist[section]),
                'updated': sum(1 for x in ok if x['id'] in exist[section]),
                'invalid': len(bad),
            }
            if edits:
                rep[section].update(same=same, conflict=conf)

            def put(func, x, sec_name=section, errors=errors) -> None:
                """Запись одной строки: ошибка — в отчёт, остальные записываются (загрузка не обрывается посередине)."""
                try:
                    func(x)
                except (ValueError, TypeError) as exc:
                    what = str(x.get('name') or x.get('number') or x.get('id'))[:80]
                    errors.append(f'{sec_name} «{what}»: не записано — {ErrorText.of(exc)[:160]}')

            if apply:
                if section == 'catalog':

                    def cat_put(x) -> None:
                        y = {k: v for k, v in x.items() if k not in ('_light', 'st', 'pricesCount')}
                        if keep and x['id'] in exist['catalog']:
                            y = SupplierScope.merge(y, _loads(store.catalog_get(x['id'])) or {}, keep)
                        store.catalog_put(x['id'], json.dumps(y, ensure_ascii=False))

                    for x in ok:
                        put(cat_put, x)
                elif section == 'kp':
                    for x in ok:
                        put(store.kp_import, x)
                elif section == 'managers':
                    for x in ok:
                        put(lambda x: store.manager_put(x['id'], json.dumps(x, ensure_ascii=False)), x)
                elif section == 'suppliers':
                    for x in ok:
                        put(lambda x: store.supplier_put(x['id'], x, author), x)
                    customs = got_value if isinstance(got_value := sec[section].get('customs'), dict) else {}
                    now = store.customs_all() if edits else {}
                    for key, code in customs.items():
                        if isinstance(code, dict) and re.match(r'^(cat|item):[\w.-]{1,80}$', str(key)):
                            if edits and all(
                                str(code.get(field) or '') == str((now.get(key) or {}).get(field) or '')
                                for field in ('code', 'duty', 'note', 'name')
                            ):
                                continue  # «только изменённое»: такие же коды ТН ВЭД не переписываются
                            store.customs_put(
                                key,
                                code.get('code'),
                                code.get('duty'),
                                code.get('note'),
                                author,
                                code.get('name') or '',
                            )
                else:
                    for x in ok:
                        put(lambda x: store.client_put(x['id'], x), x)
        if apply and 'settings' in want and isinstance(sec['settings'], dict):
            ProgramSettings(store).apply(sec['settings'], self._keys_right())
        if apply:
            self.log(
                'import_db',
                'db',
                ','.join(want),
                None,
                {
                    'report': rep,
                    'createdAt': data.get('createdAt'),
                    'backup': backup,
                    'fmt': fmt,
                    'mode': 'edits' if edits else 'all',
                },
            )
        return {
            'report': rep,
            'errors': errors,
            'createdAt': data.get('createdAt'),
            'applied': apply,
            'keep': bool(keep) and not edits,
            'supplier': str(data.get('supplier') or '')[:120],
            'digests': bool(digs),
            'mode': 'edits' if edits else 'all',
            'conflicts': conflicts,
        }

    def import_file(self, data, load: Load, sections=None, name='', mode='all') -> dict:
        """Файл любого формата выгрузки → предпросмотр или запись (копия базы перед записью)."""
        from catalog_patch import CatalogPatch, CatalogSheet
        from data_file import DataFile

        apply = load is Load.APPLY

        kind = DataFile.sniff(data)
        if kind in ('sqlite', 'sqlite-zip'):
            if apply:
                raise ValueError('Это файл базы целиком — загрузите его в «Загрузить → Файл базы целиком»')
            return {'kind': 'sqlite'}
        if kind == 'xlsx-patch':
            patch_res, z, imgs = CatalogSheet(self.store).patch(data, str(name)[:120]), None, []
        else:
            patch_res, z, imgs = self.data_file().load(data)
        if isinstance(patch_res, dict) and patch_res.get('format') == 'kp-settings':
            if z:
                z.close()
            if apply:
                raise ValueError('Это файл настроек — загрузите его в «Загрузить → Файл настроек»')
            return {'kind': 'settings'}
        bundle = self.bundle()
        if CatalogPatch.is_patch(
            patch_res
        ):  # правки каталога: только перечисленные поля позиций, цены и остатки не трогаются
            if z:
                z.close()
            res = CatalogPatch(self.store).run(patch_res, load, actor(self.handler, True)[1], self.import_backup)
            if apply:
                self.log(
                    'import_db',
                    'db',
                    'catalog-patch',
                    None,
                    {
                        'title': res['patch']['title'],
                        'items': res['patch']['written'],
                        'fields': res['patch']['fields'],
                        'skipped': res['patch']['conflictCount'],
                    },
                )
            return res
        if mode == 'auto':  # Excel — по умолчанию «только изменённое в файле», остальное — «всё как в файле»
            mode = 'edits' if kind == 'xlsx' else 'all'
        try:
            res = self.import_(patch_res, load, sections, mode, kind)
            res['images'] = bundle.plan(imgs) if imgs else None
            res['fmt'] = kind
            if apply and imgs:
                res['images']['written'] = bundle.write(z, imgs)
                web = sys.modules.get('web_base')  # учёт одинаковых изображений ведёт веб-часть, если она загружена
                if web is not None:
                    web.IMAGES.index = None  # новые файлы — в учёт
            return res
        finally:
            if z:
                z.close()

    def settings_doc(self, data_file, data) -> Any:
        """Файл настроек любого формата → документ kp-settings (проверку делает SettingsFile.read)."""
        from data_file import DataFile

        kind = DataFile.sniff(data)
        if kind not in ('json', 'zip', 'xlsx', 'xml'):
            raise ValueError('Это не файл настроек программы')
        if kind == 'json':
            return data
        doc, z, _ = data_file.load(data)
        if z:
            z.close()
        return doc

    def settings_images(self, data_file, data) -> int | None:
        """Архив .zip настроек: недостающие изображения (логотипы производителей) — в папку img."""
        from data_file import DataFile

        if DataFile.sniff(data) != 'zip':
            return None
        _, z, imgs = data_file.load(data)
        try:
            return self.bundle().write(z, imgs) if imgs else 0
        finally:
            z.close()

    def import_backup(self) -> str:
        return self.store.backup_before('import')
