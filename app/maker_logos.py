"""Логотипы, закреплённые администратором за марками: kv «makerLogos», ставятся на всё оборудование марки."""

import base64
import json
import struct

import images
from clock import Clock


class MakerLogos:
    PNG_HEAD = 24
    JPEG_MARK = 0xFF
    RST_FIRST = 0xD0
    RST_LAST = 0xD7
    KV_KEY = 'makerLogos'
    MAX_BYTES = 2 * 1024 * 1024
    MAX_MAKER = 80

    def __init__(self, store, image_store=None) -> None:
        self.store, self.images = store, image_store

    @staticmethod
    def key(maker) -> str:
        """Ключ марки как в imgfetch.logos: «Ремеза», «REMEZA» и «Remeza» — одна марка."""
        return images.slug(str(maker or '').strip(), 60).replace('-', '')

    def pins(self) -> dict:
        v = self.store.kv_get(self.KV_KEY)
        return v if isinstance(v, dict) else {}

    def pinned(self, maker) -> dict | None:
        return self.pins().get(self.key(maker))

    def list(self) -> list[dict]:
        """[{maker, n, logo, pinned}] по убыванию числа позиций."""
        import imgfetch

        cur = imgfetch.logos(self.store)
        pins = self.pins()
        groups: dict = {}
        for maker, name in self.store.all(
            "SELECT maker, COUNT(*) FROM catalog WHERE maker IS NOT NULL AND maker <> '' GROUP BY maker"
        ):
            k = self.key(maker)
            if not k:
                continue
            group = groups.setdefault(k, {'maker': maker.strip(), 'n': 0, 'top': 0})
            group['n'] += name
            if name > group['top']:
                group['maker'], group['top'] = maker.strip(), name
        out = []
        for k, group in groups.items():
            pin = pins.get(k)
            logo = pin or cur.get(group['maker'].lower())
            out.append(
                {
                    'maker': group['maker'],
                    'n': group['n'],
                    'pinned': bool(pin),
                    'logo': {'src': logo['src'], 'w': logo.get('w'), 'h': logo.get('h')}
                    if logo and logo.get('src')
                    else None,
                }
            )
        return sorted(out, key=lambda x: (-x['n'], x['maker'].lower()))

    @staticmethod
    def image(raw) -> tuple:
        """base64 или data:-адрес → (байты, расширение, ширина, высота)."""
        text = str(raw or '').strip()
        if text.startswith('data:'):
            text = text.split(',', 1)[1] if ',' in text else ''
        try:
            data = base64.b64decode(text, validate=False)
        except (ValueError, TypeError):
            raise ValueError('Картинка не читается') from None
        if not data:
            raise ValueError('Нет картинки логотипа')
        if len(data) > MakerLogos.MAX_BYTES:
            raise ValueError('Картинка больше 2 МБ — уменьшите её')
        if data[:8] == b'\x89PNG\r\n\x1a\n' and len(data) >= MakerLogos.PNG_HEAD:
            width, height = struct.unpack('>II', data[16:24])
            return data, '.png', width, height
        if data[:3] == b'\xff\xd8\xff':
            width, height = MakerLogos._jpeg_size(data)
            return data, '.jpg', width, height
        if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
            width, height = MakerLogos._webp_size(data)
            return data, '.webp', width, height
        raise ValueError('Нужна картинка PNG, JPEG или WebP')

    @staticmethod
    def _jpeg_size(data: bytes) -> tuple:
        i = 2
        while i + 9 < len(data):
            if data[i] != MakerLogos.JPEG_MARK:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xD8, 0x01) or MakerLogos.RST_FIRST <= marker <= MakerLogos.RST_LAST:
                i += 2
                continue
            length = struct.unpack('>H', data[i + 2 : i + 4])[0]
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                height, width = struct.unpack('>HH', data[i + 5 : i + 9])
                return width, height
            i += 2 + length
        return None, None

    @staticmethod
    def _webp_size(data: bytes) -> tuple:
        chunk = data[12:16]
        try:
            if chunk == b'VP8X':
                return 1 + int.from_bytes(data[24:27], 'little'), 1 + int.from_bytes(data[27:30], 'little')
            if chunk == b'VP8L':
                bits = int.from_bytes(data[21:25], 'little')
                return 1 + (bits & 0x3FFF), 1 + ((bits >> 14) & 0x3FFF)
            if chunk == b'VP8 ':
                width, height = struct.unpack('<HH', data[26:30])
                return width & 0x3FFF, height & 0x3FFF
        except (struct.error, ValueError):
            pass
        return None, None

    def set(self, maker: object, raw, author: str = '') -> dict:
        """Закрепить логотип и поставить на оборудование марки → {maker, logo, items}."""
        maker = str(maker or '').strip()
        if not maker or len(maker) > self.MAX_MAKER or not self.key(maker):
            raise ValueError('Укажите производителя')
        if self.images is None:
            raise ValueError('Хранилище изображений недоступно')
        data, ext, width, height = self.image(raw)
        rel = self.images.put(data, ext, *images.place(None, maker, '', '', 'logo'))
        logo = {
            'maker': maker,
            'src': '/img/' + rel,
            'w': width,
            'h': height,
            'at': Clock.now(),
            'by': str(author or '')[:120],
        }
        pins = self.pins()
        pins[self.key(maker)] = logo
        self.store.kv_set(self.KV_KEY, pins)
        return {
            'maker': maker,
            'logo': {'src': logo['src'], 'w': width, 'h': height},
            'items': self.apply(maker, author),
        }

    def unpin(self, maker: object) -> dict:
        """Снять закрепление; логотип на оборудовании остаётся."""
        pins, k = self.pins(), self.key(maker)
        if k not in pins:
            raise ValueError('У этого производителя логотип не закреплён')
        pins.pop(k)
        self.store.kv_set(self.KV_KEY, pins)
        return {'maker': str(maker or '').strip()}

    def apply(self, maker: str | None = None, author: str = '') -> int:
        """Закреплённые логотипы — на оборудование (одной марки или всех) → число изменённых позиций."""
        pins = self.pins()
        if maker is not None:
            k = self.key(maker)
            pins = {k: pins[k]} if k in pins else {}
        if not pins:
            return 0
        count = 0
        for cid, doc, maker_name in self.store.all(
            "SELECT id, doc, maker FROM catalog WHERE maker IS NOT NULL AND maker <> ''"
        ):
            logo = pins.get(self.key(maker_name))
            if not logo:
                continue
            try:
                card = json.loads(doc)
            except ValueError:
                continue
            cur = card.get('logo') or {}
            if cur.get('src') == logo['src']:
                continue
            card['logo'] = {'src': logo['src'], 'w': logo.get('w'), 'h': logo.get('h')}
            self.store.catalog_put(cid, json.dumps(card, ensure_ascii=False), author or 'логотип производителя')
            count += 1
        return count
