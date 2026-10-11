# -*- coding: utf-8 -*-
"""Правка шрифта чертежей osifont-italic.ttf (app/web/fonts, GNU LGPL 3 с исключением для шрифтов).

В исходном файле (osifont 0.1.20221020) на месте «Э», «Ё» и «ё» — прямоугольники-заглушки. Правка:
  «Ё», «ё» — рисунок «Ë», «ë» (те же буквы: Е/е и две точки — составные глифы копируются как есть);
  «Э» — зеркальное отражение «Є» с поправкой на наклон (наклон сохраняется вправо), обход контуров — обратный.
Остальное не меняется. Запуск: python3 .github/scripts/osifont_fix.py исходный.ttf результат.ttf
"""
import struct
import sys


class Ttf:
    """TrueType: таблицы по тегам, глифы (glyf/loca), метрики (hmtx), сборка обратно с контрольными суммами."""

    def __init__(self, data):
        self.ver = data[:4]
        n = struct.unpack('>H', data[4:6])[0]
        self.tables = {}
        for i in range(n):
            tag, _, off, ln = struct.unpack('>4sIII', data[12 + 16 * i:28 + 16 * i])
            self.tables[tag.decode('latin-1')] = data[off:off + ln]
        head = self.tables['head']
        self.short = struct.unpack('>h', head[50:52])[0] == 0
        self.ng = struct.unpack('>H', self.tables['maxp'][4:6])[0]
        self.nh = struct.unpack('>H', self.tables['hhea'][34:36])[0]
        loca = self.tables['loca']
        if self.short:
            offs = [2 * v for v in struct.unpack('>%dH' % (self.ng + 1), loca[:2 * (self.ng + 1)])]
        else:
            offs = list(struct.unpack('>%dI' % (self.ng + 1), loca[:4 * (self.ng + 1)]))
        glyf = self.tables['glyf']
        self.glyphs = [glyf[offs[i]:offs[i + 1]] for i in range(self.ng)]
        hm = self.tables['hmtx']
        self.adv = [struct.unpack('>H', hm[4 * i:4 * i + 2])[0] for i in range(self.nh)]
        self.lsb = [struct.unpack('>h', hm[4 * i + 2:4 * i + 4])[0] for i in range(self.nh)]
        rest = hm[4 * self.nh:]
        self.lsb += [struct.unpack('>h', rest[2 * i:2 * i + 2])[0] for i in range(self.ng - self.nh)]

    # ---- cmap (формат 4): знак → глиф
    def glyph_of(self, cp):
        cm = self.tables['cmap']
        for i in range(struct.unpack('>H', cm[2:4])[0]):
            pid, eid, off = struct.unpack('>HHI', cm[4 + 8 * i:12 + 8 * i])
            if (pid, eid) not in ((3, 1), (0, 3), (0, 4)) or struct.unpack('>H', cm[off:off + 2])[0] != 4:
                continue
            seg = struct.unpack('>H', cm[off + 6:off + 8])[0] // 2
            ends = struct.unpack('>%dH' % seg, cm[off + 14:off + 14 + 2 * seg])
            base = off + 16 + 2 * seg
            starts = struct.unpack('>%dH' % seg, cm[base:base + 2 * seg])
            deltas = struct.unpack('>%dh' % seg, cm[base + 2 * seg:base + 4 * seg])
            rpos = base + 4 * seg
            roffs = struct.unpack('>%dH' % seg, cm[rpos:rpos + 2 * seg])
            for k in range(seg):
                if starts[k] <= cp <= ends[k]:
                    if roffs[k] == 0:
                        return (cp + deltas[k]) & 0xFFFF
                    a = rpos + 2 * k + roffs[k] + 2 * (cp - starts[k])
                    g = struct.unpack('>H', cm[a:a + 2])[0]
                    return (g + deltas[k]) & 0xFFFF if g else 0
        return 0

    def adv_of(self, g):
        return self.adv[min(g, self.nh - 1)]

    def set_metrics(self, g, adv, lsb):
        if g < self.nh:
            self.adv[g] = adv
        self.lsb[g] = lsb

    # ---- простой глиф: контуры [[(x, y, on), …], …]
    @staticmethod
    def contours(data):
        nc = struct.unpack('>h', data[:2])[0]
        if nc <= 0:
            raise ValueError('не простой глиф')
        ends = struct.unpack('>%dH' % nc, data[10:10 + 2 * nc])
        p = 10 + 2 * nc
        il = struct.unpack('>H', data[p:p + 2])[0]
        p += 2 + il
        n = ends[-1] + 1
        flags = []
        while len(flags) < n:
            f = data[p]
            p += 1
            flags.append(f)
            if f & 8:
                flags += [f] * data[p]
                p += 1
        flags = flags[:n]

        def coords(short, same):
            nonlocal p
            out, v = [], 0
            for f in flags:
                if f & short:
                    d = data[p]
                    p += 1
                    v += d if f & same else -d
                elif not f & same:
                    v += struct.unpack('>h', data[p:p + 2])[0]
                    p += 2
                out.append(v)
            return out
        xs = coords(2, 16)
        ys = coords(4, 32)
        pts = [(xs[i], ys[i], flags[i] & 1) for i in range(n)]
        out, s = [], 0
        for e in ends:
            out.append(pts[s:e + 1])
            s = e + 1
        return out

    @staticmethod
    def simple(cs):
        """простой глиф из контуров: смещения 2-байтовые, без инструкций"""
        pts = [q for c in cs for q in c]
        xs, ys = [q[0] for q in pts], [q[1] for q in pts]
        out = struct.pack('>hhhhh', len(cs), min(xs), min(ys), max(xs), max(ys))
        e = -1
        for c in cs:
            e += len(c)
            out += struct.pack('>H', e)
        out += struct.pack('>H', 0) + bytes(q[2] & 1 for q in pts)
        px = py = 0
        dx, dy = b'', b''
        for x, y, _ in pts:
            dx += struct.pack('>h', x - px)
            dy += struct.pack('>h', y - py)
            px, py = x, y
        return out + dx + dy

    @staticmethod
    def mirror(cs, t):
        """отражение по горизонтали с сохранением наклона t (tg угла): без наклона → отражение → наклон обратно;
        обход каждого контура — в обратную сторону"""
        us = [x - t * y for c in cs for x, y, _ in c]
        a = min(us) + max(us)
        out = []
        for c in cs:
            m = [(int(round(a - (x - t * y) + t * y)), y, on) for x, y, on in c]
            out.append([m[0]] + m[1:][::-1])
        return out

    def slant(self, cp=0x49):
        """наклон шрифта по левому краю прямой «I»: Δx/Δy крайних точек"""
        pts = [q for c in self.contours(self.glyphs[self.glyph_of(cp)]) for q in c]
        lo, hi = min(pts, key=lambda q: (q[1], q[0])), max(pts, key=lambda q: (q[1], -q[0]))
        return (hi[0] - lo[0]) / float(hi[1] - lo[1])

    # ---- сборка
    @staticmethod
    def sum32(b):
        b = b + b'\0' * (-len(b) % 4)
        return sum(struct.unpack('>%dI' % (len(b) // 4), b)) & 0xFFFFFFFF

    def build(self):
        glyf, offs = b'', []
        for g in self.glyphs:
            offs.append(len(glyf))
            glyf += g + b'\0' * (-len(g) % 4)
        offs.append(len(glyf))
        self.tables['glyf'] = glyf
        if self.short:
            self.tables['loca'] = struct.pack('>%dH' % len(offs), *[o // 2 for o in offs])
        else:
            self.tables['loca'] = struct.pack('>%dI' % len(offs), *offs)
        hm = b''.join(struct.pack('>Hh', self.adv[i], self.lsb[i]) for i in range(self.nh))
        hm += b''.join(struct.pack('>h', self.lsb[i]) for i in range(self.nh, self.ng))
        self.tables['hmtx'] = hm
        head = bytearray(self.tables['head'])
        head[8:12] = b'\0\0\0\0'
        self.tables['head'] = bytes(head)
        tags = sorted(self.tables)
        n = len(tags)
        es = max(k for k in range(16) if 2 ** k <= n)
        out = self.ver + struct.pack('>HHHH', n, 16 * 2 ** es, es, 16 * n - 16 * 2 ** es)
        off = 12 + 16 * n
        dirs, body = b'', b''
        for tag in tags:
            t = self.tables[tag]
            dirs += struct.pack('>4sIII', tag.encode('latin-1'), self.sum32(t), off + len(body), len(t))
            body += t + b'\0' * (-len(t) % 4)
        font = bytearray(out + dirs + body)
        adj = (0xB1B0AFBA - self.sum32(bytes(font))) & 0xFFFFFFFF
        p = font.find(self.tables['head'], 12 + 16 * n)
        font[p + 8:p + 12] = struct.pack('>I', adj)
        return bytes(font)


class OsifontFix:
    """заглушки «Ё», «ё», «Э» — нормальными буквами"""
    COPY = ((0x401, 0xCB), (0x451, 0xEB))     # Ё ← Ë, ё ← ë
    MIRROR = ((0x42D, 0x404),)                # Э ← зеркальная Є

    @classmethod
    def run(cls, src, dst):
        f = Ttf(open(src, 'rb').read())
        t = f.slant()
        for to, fr in cls.COPY:
            a, b = f.glyph_of(to), f.glyph_of(fr)
            f.glyphs[a] = f.glyphs[b]
            f.set_metrics(a, f.adv_of(b), f.lsb[b])
        for to, fr in cls.MIRROR:
            a, b = f.glyph_of(to), f.glyph_of(fr)
            cs = f.mirror(f.contours(f.glyphs[b]), t)
            f.glyphs[a] = f.simple(cs)
            f.set_metrics(a, f.adv_of(b), min(x for c in cs for x, _, _ in c))
        open(dst, 'wb').write(f.build())
        return t


if __name__ == '__main__':
    print('наклон', round(OsifontFix.run(sys.argv[1], sys.argv[2]), 4))
