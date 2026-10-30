"""Адреса помощников: курсы ЦБ, логотипы, картинки по ссылке, нейросеть, текст страниц, PDF и ТЗ, правила станций, фото со страниц."""

import json
from typing import Any

import ai_llm
import defaults
import pdf_text
from ai_profile import CategoryProfile, ModelFacts
from cbr import cbr_key_rate, cbr_rates
from cbr_cache import CbrCache
from config import store
from equipment_types import load_types
from web_base import IMAGES, Controller, route

_LOGOS: dict = {}  # логотипы производителей: {rev — версия каталога, text — готовый ответ}


class ToolsController(Controller):
    @route(r'/api/cbr')
    def cbr(self) -> Any:
        return self.send_json(CbrCache.get('cbr_last', cbr_rates))

    @route(r'/api/cbr/keyrate')
    def keyrate(self) -> Any:
        return self.send_json(CbrCache.get('keyrate_last', cbr_key_rate))

    # картинки карточек: логотипы производителей из каталога; картинка, перетащенная со страницы сайта
    @route(r'/api/logos', 'GET')
    def logos(self) -> Any:
        # логотипы зависят только от каталога: расчёт (~0,5 с на большом каталоге) — один раз на его версию
        import imgfetch

        rev = store().data_rev('catalog')
        if _LOGOS.get('rev') != rev:
            _LOGOS.update(rev=rev, text=json.dumps(imgfetch.logos(store()), ensure_ascii=False))
        return self.send_cached('logos-' + rev, lambda: _LOGOS['text'])

    @route(r'/api/imgfetch', 'GET')
    def imgfetch(self) -> Any:
        import imgfetch

        try:
            ctype, data = imgfetch.fetch_image(self.query.get('url') or '')
        except Exception as exc:
            return self.text(422, f'Картинка не загружена: {self.no_paths(exc)}')
        return self.send(200, ctype, data)

    @route(r'/api/ai/status', 'GET')  # нейросеть в программе: включена ли (без ключа и адреса)
    def ai_status(self) -> Any:
        return self.send_json(ai_llm.status(store()))

    @route(r'/api/ai/profile', 'GET')  # образец объёма категории и данные этой же модели из каталога — для запроса к ИИ
    def ai_profile(self) -> None:
        query = self.query
        return self.send_json(
            {
                'profile': CategoryProfile(store()).get(str(query.get('cat') or '')[:40]),
                'facts': ModelFacts(store()).find(
                    query.get('maker', '')[:100],
                    query.get('model', '')[:100],
                    query.get('name', '')[:300],
                    query.get('id', '')[:64],
                ),
            }
        )

    @route(r'/api/ai/fill', 'POST')  # автозаполнение: запрос из программы → ответ нейросети (JSON строкой)
    def ai_fill(self) -> Any:
        data = self.json_body()
        try:
            return self.send_json(ai_llm.AiAsk.ask(store(), str(data.get('prompt') or '')))
        except RuntimeError as exc:
            return self.text(422, str(exc))

    @route(r'/api/pagetext', 'POST')  # текст и характеристики со страницы товара — для автозаполнения карточки
    def pagetext(self) -> None:
        import feed_pages

        data = self.json_body()
        try:
            return self.send_json(feed_pages.page_text(str(data.get('url') or '').strip(), defaults.img_opts(store())))
        except Exception as exc:
            return self.text(422, f'Страница не прочитана: {self.no_paths(exc)[:200]}')

    @route(r'/api/pdftext', 'POST')  # текст из PDF (паспорт, каталог, ТЗ) — для автозаполнения карточки
    def pdftext(self) -> None:
        if self._too_big('PDF'):
            return None
        try:
            res = pdf_text.PdfText.require(self.body())
            res.pop('per', None)  # текст по страницам — только для разбора ТЗ
            return self.send_json(res)
        except Exception as exc:
            return self.text(422, f'PDF не прочитан: {self.no_paths(exc)[:200]}')

    @route(
        r'/api/fileimages', 'POST'
    )  # картинки из файла (PDF, Word, Excel) — для фото карточки, как со страницы товара
    def fileimages(self) -> None:
        from doc_images import DocImages

        if self._too_big('Файл'):
            return None
        name, body = str(self.query.get('name') or '')[:200], self.body()
        out = DocImages.extract(name, body, defaults.img_opts(store()))
        if self.query.get('text') == '1':  # Excel: текст читает сервер (в браузере — только Word и PDF)
            from doc_text import DocText

            try:
                out['text'] = DocText.extract(name, body)['text']
            except Exception as exc:
                out['error'] = self.no_paths(exc)[:200]
        return self.send_json(out)

    @route(r'/api/tz/parse', 'POST')  # ТЗ заказчика (PDF, DOCX, XLSX, ODT, RTF, TXT): текст и требования к станции
    def tz_parse(self) -> None:
        from doc_text import DocText
        from tz_parse import TzParse

        if self._too_big('Файл'):
            return None
        try:
            doc = DocText.extract(str(self.query.get('name') or '')[:200], self.body())
        except Exception as exc:
            return self.text(422, f'ТЗ не прочитано: {self.no_paths(exc)[:200]}')
        res = TzParse.parse(doc['text'])
        res.update(
            text=doc['text'][:20000].replace('\f', '\n'),
            doc={
                'kind': doc['kind'],
                'pages': doc.get('pages'),
                'chars': len(doc['text']),
                'quality': doc.get('quality'),
                'low': doc.get('low'),
                'methods': doc.get('methods') or [],
            },
        )
        return self.send_json(res)

    @route(
        r'/api/rules/stations\.js', 'GET'
    )  # инженерные правила станций — скриптом до модулей расчёта (StationRules.use)
    def rules_stations_js(self) -> None:
        from station_rules import StationRules

        return self.send(
            200,
            'text/javascript; charset=utf-8',
            StationRules(store()).json_text().encode('utf-8'),
            {'Cache-Control': 'no-cache'},
        )

    @route(
        r'/api/rules/stations', 'GET'
    )  # то же — JSON (просмотр, выгрузка, документ «Инженерные правила и источники»)
    def rules_stations(self) -> None:
        from station_rules import StationRules

        rules = StationRules(store())
        return self.send_json({'rules': rules.current(), 'info': rules.info()})

    @route(r'/api/pagephotos', 'POST')  # фото со страницы товара на сайте поставщика — в изображения позиции
    def pagephotos(self) -> None:
        import feeds

        data = self.json_body()
        tmap = {tdef.get('id'): tdef for tdef in load_types()['types']}
        try:
            return self.send_json(
                feeds.page_photos(
                    store(),
                    IMAGES,
                    str(data.get('url') or '').strip(),
                    tmap.get(data.get('cat')),
                    data.get('maker') or '',
                    data.get('model') or '',
                    data.get('name') or '',
                    picked if isinstance(picked := data.get('urls'), list) else None,
                )
            )
        except Exception as exc:
            return self.text(422, f'Фото со страницы не загружены: {self.no_paths(exc)[:200]}')
