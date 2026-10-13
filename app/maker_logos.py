# -*- coding: utf-8 -*-
"""Логотипы производителей, закреплённые администратором («Настройки → Фиды поставщиков → Логотипы производителей»).

Закреплённый логотип ставится на всё оборудование производителя в каталоге (все написания одной марки — «Remeza»,
«REMEZA», «Ремеза» — одна марка) и остаётся за ним: новые позиции (фиды, добавление вручную) получают его, фиды
его не меняют. Хранение: kv «makerLogos» — {ключ марки: {maker, src, w, h, at, by}}; файл картинки — в data/img/logos.
"""
import base64
import json
import struct
from datetime import datetime

import images


class MakerLogos:
    KV = 'makerLogos'
    MAX_BYTES = 2 * 1024 * 1024
    MAX_MAKER = 80

    def __init__(self, store, image_store=None):
        self.store, self.images = store, image_store

    @staticmethod
    def key(maker):
        """Ключ марки — как в логотипах каталога (imgfetch.logos): латиницей, без пробелов и знаков; «Ремеза», «REMEZA»
        и «Remeza» — одна марка."""
        return images.slug(str(maker or '').strip(), 60).replace('-', '')

    def pins(self):
        v = self.store.kv_get(self.KV)
        return v if isinstance(v, dict) else {}

    def pinned(self, maker):
        """Закреплённый логотип марки или None."""
        return self.pins().get(self.key(maker))

    def list(self):
        """Производители каталога: [{maker, n, logo: {src, w, h} | None, pinned}] — по числу позиций."""
        import imgfetch
        cur, pins, groups = imgfetch.logos(self.store), self.pins(), {}
        for maker, n in self.store.all("SELECT maker, COUNT(*) FROM catalog WHERE maker IS NOT NULL AND maker <> '' GROUP BY maker"):
            k = self.key(maker)
            if not k:
                continue
            g = groups.setdefault(k, {'maker': maker.strip(), 'n': 0, 'top': 0})
            g['n'] += n
            if n > g['top']:
                g['maker'], g['top'] = maker.strip(), n
        out = []
        for k, g in groups.items():
            pin = pins.get(k)
            lg = pin or cur.get(g['maker'].lower())
            out.append({'maker': g['maker'], 'n': g['n'], 'pinned': bool(pin),
                        'logo': {'src': lg['src'], 'w': lg.get('w'), 'h': lg.get('h')} if lg and lg.get('src') else None})
        return sorted(out, key=lambda x: (-x['n'], x['maker'].lower()))

    @staticmethod
    def image(raw):
        """Картинка из запроса (base64 или data:-адрес) → (байты, расширение, ширина, высота); иначе ValueError."""
        s = str(raw or '').strip()
        if s.startswith('data:'):
            s = s.split(',', 1)[1] if ',' in s else ''
        try:
            data = base64.b64decode(s, validate=False)
        except (ValueError, TypeError):
            raise ValueError('Картинка не читается')
        if not data:
            raise ValueError('Нет картинки логотипа')
        if len(data) > MakerLogos.MAX_BYTES:
            raise ValueError('Картинка больше 2 МБ — уменьшите её')
        if data[:8] == b'\x89PNG\r\n\x1a\n' and len(data) >= 24:
            w, h = struct.unpack('>II', data[16:24])
            return data, '.png', w, h
        if data[:3] == b'\xff\xd8\xff':
            w, h = MakerLogos._jpeg_size(data)
            return data, '.jpg', w, h
        if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
            w, h = MakerLogos._webp_size(data)
            return data, '.webp', w, h
        raise ValueError('Нужна картинка PNG, JPEG или WebP')

    @staticmethod
    def _jpeg_size(d):
        i = 2
        while i + 9 < len(d):
            if d[i] != 0xFF:
                i += 1
                continue
            m = d[i + 1]
            if m in (0xD8, 0x01) or 0xD0 <= m <= 0xD7:
                i += 2
                continue
            ln = struct.unpack('>H', d[i + 2:i + 4])[0]
            if m in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                h, w = struct.unpack('>HH', d[i + 5:i + 9])
                return w, h
            i += 2 + ln
        return None, None

    @staticmethod
    def _webp_size(d):
        c = d[12:16]
        try:
            if c == b'VP8X':
                return 1 + int.from_bytes(d[24:27], 'little'), 1 + int.from_bytes(d[27:30], 'little')
            if c == b'VP8L':
                b = int.from_bytes(d[21:25], 'little')
                return 1 + (b & 0x3FFF), 1 + ((b >> 14) & 0x3FFF)
            if c == b'VP8 ':
                w, h = struct.unpack('<HH', d[26:30])
                return w & 0x3FFF, h & 0x3FFF
        except (struct.error, ValueError):
            pass
        return None, None

    def set(self, maker, raw, by=''):
        """Закрепить логотип за маркой и поставить его на всё её оборудование. → {maker, logo, items}"""
        maker = str(maker or '').strip()
        if not maker or len(maker) > self.MAX_MAKER or not self.key(maker):
            raise ValueError('Укажите производителя')
        if self.images is None:
            raise ValueError('Хранилище изображений недоступно')
        data, ext, w, h = self.image(raw)
        rel = self.images.put(data, ext, *images.place(None, maker, '', '', 'logo'))
        lg = {'maker': maker, 'src': '/img/' + rel, 'w': w, 'h': h, 'at': datetime.now().isoformat(timespec='seconds'), 'by': str(by or '')[:120]}
        pins = self.pins()
        pins[self.key(maker)] = lg
        self.store.kv_set(self.KV, pins)
        return {'maker': maker, 'logo': {'src': lg['src'], 'w': w, 'h': h}, 'items': self.apply(maker, by)}

    def unpin(self, maker):
        """Снять закрепление: логотип на оборудовании остаётся, фиды и новые позиции берут логотип как прежде."""
        pins, k = self.pins(), self.key(maker)
        if k not in pins:
            raise ValueError('У этого производителя логотип не закреплён')
        pins.pop(k)
        self.store.kv_set(self.KV, pins)
        return {'maker': str(maker or '').strip()}

    def apply(self, maker=None, by=''):
        """Закреплённые логотипы — на оборудование каталога (одной марки или всех закреплённых). → число изменённых позиций"""
        pins = self.pins()
        if maker is not None:
            k = self.key(maker)
            pins = {k: pins[k]} if k in pins else {}
        if not pins:
            return 0
        n = 0
        for cid, doc, mk in self.store.all("SELECT id, doc, maker FROM catalog WHERE maker IS NOT NULL AND maker <> ''"):
            lg = pins.get(self.key(mk))
            if not lg:
                continue
            try:
                d = json.loads(doc)
            except ValueError:
                continue
            cur = d.get('logo') or {}
            if cur.get('src') == lg['src']:
                continue
            d['logo'] = {'src': lg['src'], 'w': lg.get('w'), 'h': lg.get('h')}
            self.store.catalog_put(cid, json.dumps(d, ensure_ascii=False), by or 'логотип производителя')
            n += 1
        return n
