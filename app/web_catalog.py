"""Адреса каталога: категории оборудования, позиции, поиск, сверка, проверка карточки, изображения."""

import hashlib
import json
import os
from typing import Any

import admin
import defaults
import images
from config import MIME, read_text, safe_id, store
from equipment_types import load_types, save_user_types, types_builtin_path
from web_base import IMAGES, Controller, NotFound, route


class TypesController(Controller):
    @route(r'/api/types')
    def types(self) -> Any:
        if self.query.get('builtin') == '1':
            return self.send_json(read_text(types_builtin_path()))
        if self.method == 'PUT':
            self.json_body()
            with self.user_input():
                save_user_types(self.body())
            return self.send_json(load_types())
        text = json.dumps(load_types(), ensure_ascii=False)
        return self.send_cached(
            'types-' + hashlib.md5(text.encode('utf-8'), usedforsecurity=False).hexdigest()[:16], lambda: text
        )


class CatalogController(Controller):
    @route(r'/api/catalog', 'GET')
    def catalog(self) -> Any:
        # список — облегчённые карточки (без таблиц характеристик и галерей); полная позиция — по id
        full = self.query.get('full') == '1'
        return self.send_cached(
            'cat{}-{}'.format('f' if full else 'l', store().data_rev('catalog')),
            lambda: store().catalog_full() if full else store().catalog_light(),
        )

    # каталог 20 000+: браузер хранит каталог у себя (IndexedDB) и докачивает изменения после своего номера
    @route(r'/api/catalog/sync', 'GET')
    def sync(self) -> Any:
        from catalog_sync import CatalogSync

        sync = CatalogSync(store())
        delta = sync.delta(self.query.get('since'), self.query.get('epoch') or '')
        if delta is not None:
            return self.send(
                200,
                'application/json; charset=utf-8',
                sync.delta_json(delta).encode('utf-8'),
                {'Cache-Control': 'no-store'},
            )
        state = sync.state()
        return self.send_cached('cats-{}-{}'.format(state['epoch'], state['seq']), sync.full_json)

    # поиск по характеристикам (строка поиска позиции хранится на сервере, не в браузере)
    @route(r'/api/catalog/search', 'GET')
    def search(self) -> Any:
        from catalog_sync import CatalogSync

        return self.send_json(
            {'q': self.query.get('q') or '', 'ids': CatalogSync(store()).search(self.query.get('q') or '')}
        )

    @route(
        r'/api/catalog/sources', 'GET'
    )  # фиды-источники позиций: id → поставщик (из справочника, если фид к нему привязан)
    def sources(self) -> None:
        sups = {x.get('id'): x.get('name') for x in store().suppliers_list()}
        return self.send_json(
            {
                feed['id']: {
                    'name': sups.get(feed.get('supplier')) or feed.get('name') or feed['id'],
                    'feed': feed.get('name') or feed['id'],
                }
                for feed in (store().kv_get('feeds') or {}).get('items', [])
                if feed.get('id')
            }
        )

    @route(r'/api/catalog/pending')  # режим модерации и товары с правками на модерации (бейдж «На модерации»)
    def pending(self) -> Any:
        return self.send_json(
            {'moderation': bool(admin.moderation(store()).get('enabled')), 'ids': store().pending_ids()}
        )

    # перед сохранением карточки: что не заполнено у основного оборудования и похожие позиции (сервер проверит то же)
    @route(r'/api/catalog/check', 'POST')
    def card_check(self) -> Any:
        from catalog_save import CardQuality

        body = self.json_body()
        doc = body.get('doc')
        if not isinstance(doc, dict) or not isinstance(doc.get('attrs', {}), dict):
            return self.text(400, 'Нужна карточка оборудования')
        cid = safe_id(str(body.get('id') or ''))
        before = json.loads(raw) if (raw := store().catalog_get(cid)) else None
        quality = CardQuality(store(), before, doc, cid)
        return self.send_json(
            {
                'on': quality.enabled,
                'missing': quality.gaps() if quality.enabled else [],
                'dups': quality.dups() if quality.enabled else [],
            }
        )

    @route(r'/api/catalog/([^/]+)', 'GET')  # запись позиции — PUT в admin.guard (модерация, права)
    def item(self, cid) -> Any:
        doc = store().catalog_get_rev(safe_id(cid))
        if not doc:
            raise NotFound()
        return self.send_json(doc)

    # изображения: папки «раздел/категория/производитель» латиницей (app/images.py); одинаковые хранятся один раз
    @route(r'/api/img', 'POST')
    def img_put(self) -> Any:
        data, query = self.body(), self.query
        max_mb = defaults.SrvVal.get(store(), 'kp.imgMB')
        if len(data) > max_mb * 1024 * 1024:
            return self.text(413, f'Картинка больше {max_mb} МБ — уменьшите её (предел — «Настройки → Параметры»)')
        if data[:8] == b'\x89PNG\r\n\x1a\n':
            ext = '.png'
        elif data[:3] == b'\xff\xd8\xff':
            ext = '.jpg'
        elif data[:4] == b'RIFF' and data[8:12] == b'WEBP':
            ext = '.webp'
        elif data[:5] == b'%PDF-' and query.get('kind') == 'booklet':  # буклет цветовых решений заказчика — ещё и PDF
            ext = '.pdf'
        else:
            return self.text(
                400, 'Нужна картинка JPEG, PNG или WebP' + (' либо файл PDF' if query.get('kind') == 'booklet' else '')
            )
        tmap = {tdef.get('id'): tdef for tdef in load_types()['types']}
        folder, title = images.place(
            tmap.get(query.get('cat')),
            query.get('maker'),
            query.get('model'),
            query.get('name'),
            query.get('kind') or 'photo',
            query.get('caption'),
        )
        rel = IMAGES.put(data, ext, folder, title)
        return self.send_json({'name': rel})

    @route(r'/img/(.+)')
    def img(self, rel) -> Any:
        path = IMAGES.path(rel)
        if not path:
            raise NotFound()
        return self.send_file(path, MIME[os.path.splitext(path)[1].lower()], 'private, max-age=604800')
