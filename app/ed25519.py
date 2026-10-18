# -*- coding: utf-8 -*-
"""Подпись Ed25519 (RFC 8032) на чистом Python — без сторонних библиотек (программа собирается в один EXE).

Нужна для пакетов обновления: выпуск подписывается закрытым ключом (секрет сборки), программа проверяет подпись
открытым ключом, вшитым в код (update_sign.UpdateSign). Скорость здесь не важна: одна проверка — доли секунды.
"""
import hashlib


class Ed25519:
    P = 2 ** 255 - 19
    L = 2 ** 252 + 27742317777372353535851937790883648493
    D = -121665 * pow(121666, 2 ** 255 - 21, 2 ** 255 - 19) % (2 ** 255 - 19)
    SQRT_M1 = pow(2, (2 ** 255 - 20) // 4, 2 ** 255 - 19)
    G = None        # базовая точка — в _base()

    # ---------- арифметика точек (расширенные координаты X, Y, Z, T)
    @classmethod
    def _add(cls, a, b):
        p = cls.P
        A = (a[1] - a[0]) * (b[1] - b[0]) % p
        B = (a[1] + a[0]) * (b[1] + b[0]) % p
        C = 2 * a[3] * b[3] * cls.D % p
        Dd = 2 * a[2] * b[2] % p
        E, F, G, H = B - A, Dd - C, Dd + C, B + A
        return (E * F % p, G * H % p, F * G % p, E * H % p)

    @classmethod
    def _mul(cls, s, pt):
        q = (0, 1, 1, 0)
        while s > 0:
            if s & 1:
                q = cls._add(q, pt)
            pt = cls._add(pt, pt)
            s >>= 1
        return q

    @classmethod
    def _equal(cls, a, b):
        p = cls.P
        return (a[0] * b[2] - b[0] * a[2]) % p == 0 and (a[1] * b[2] - b[1] * a[2]) % p == 0

    @classmethod
    def _recover_x(cls, y, sign):
        p = cls.P
        if y >= p:
            return None
        x2 = (y * y - 1) * pow(cls.D * y * y + 1, p - 2, p) % p
        if x2 == 0:
            return None if sign else 0
        x = pow(x2, (p + 3) // 8, p)
        if (x * x - x2) % p != 0:
            x = x * cls.SQRT_M1 % p
        if (x * x - x2) % p != 0:
            return None
        if (x & 1) != sign:
            x = p - x
        return x

    @classmethod
    def _base(cls):
        if cls.G is None:
            y = 4 * pow(5, cls.P - 2, cls.P) % cls.P
            x = cls._recover_x(y, 0)
            cls.G = (x, y, 1, x * y % cls.P)
        return cls.G

    @classmethod
    def _compress(cls, pt):
        p = cls.P
        zi = pow(pt[2], p - 2, p)
        x, y = pt[0] * zi % p, pt[1] * zi % p
        return int.to_bytes(y | ((x & 1) << 255), 32, 'little')

    @classmethod
    def _decompress(cls, s):
        if len(s) != 32:
            return None
        y = int.from_bytes(s, 'little')
        sign = y >> 255
        y &= (1 << 255) - 1
        x = cls._recover_x(y, sign)
        return None if x is None else (x, y, 1, x * y % cls.P)

    @staticmethod
    def _h(*parts):
        return int.from_bytes(hashlib.sha512(b''.join(parts)).digest(), 'little')

    @classmethod
    def _secret(cls, seed):
        if len(seed) != 32:
            raise ValueError('Ключ Ed25519 — 32 байта')
        h = hashlib.sha512(seed).digest()
        a = int.from_bytes(h[:32], 'little')
        a &= (1 << 254) - 8
        a |= 1 << 254
        return a, h[32:]

    # ---------- открытые методы
    @classmethod
    def public_key(cls, seed):
        """Открытый ключ (32 байта) по закрытому (seed, 32 байта)."""
        a, _ = cls._secret(seed)
        return cls._compress(cls._mul(a, cls._base()))

    @classmethod
    def sign(cls, seed, msg):
        a, prefix = cls._secret(seed)
        A = cls._compress(cls._mul(a, cls._base()))
        r = cls._h(prefix, msg) % cls.L
        R = cls._compress(cls._mul(r, cls._base()))
        s = (r + cls._h(R, A, msg) * a) % cls.L
        return R + int.to_bytes(s, 32, 'little')

    @classmethod
    def verify(cls, public, msg, sig):
        """True — подпись sig (64 байта) сообщения msg сделана ключом, чей открытый ключ — public (32 байта)."""
        if len(public) != 32 or len(sig) != 64:
            return False
        A = cls._decompress(public)
        R = cls._decompress(sig[:32])
        if A is None or R is None:
            return False
        s = int.from_bytes(sig[32:], 'little')
        if s >= cls.L:
            return False
        h = cls._h(sig[:32], public, msg) % cls.L
        return cls._equal(cls._mul(s, cls._base()), cls._add(R, cls._mul(h, A)))
