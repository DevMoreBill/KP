"""Подпись Ed25519 (RFC 8032) на чистом Python — для пакетов обновления."""

import hashlib


class Ed25519:
    PRIME = 2**255 - 19
    ORDER = 2**252 + 27742317777372353535851937790883648493
    CURVE_D = -121665 * pow(121666, 2**255 - 21, 2**255 - 19) % (2**255 - 19)
    SQRT_M1 = pow(2, (2**255 - 20) // 4, 2**255 - 19)
    BASE = None

    # точки — в расширенных координатах (X, Y, Z, T)
    @classmethod
    def _add(cls, first: tuple, second: tuple) -> tuple:
        prime = cls.PRIME
        sub_prod = (first[1] - first[0]) * (second[1] - second[0]) % prime
        add_prod = (first[1] + first[0]) * (second[1] + second[0]) % prime
        t_prod = 2 * first[3] * second[3] * cls.CURVE_D % prime
        z_prod = 2 * first[2] * second[2] % prime
        e_val, f_val, g_val, h_val = add_prod - sub_prod, z_prod - t_prod, z_prod + t_prod, add_prod + sub_prod
        return (e_val * f_val % prime, g_val * h_val % prime, f_val * g_val % prime, e_val * h_val % prime)

    @classmethod
    def _mul(cls, scalar: int, point: tuple) -> tuple:
        acc = (0, 1, 1, 0)
        while scalar > 0:
            if scalar & 1:
                acc = cls._add(acc, point)
            point = cls._add(point, point)
            scalar >>= 1
        return acc

    @classmethod
    def _equal(cls, first: tuple, second: tuple) -> bool:
        prime = cls.PRIME
        return (first[0] * second[2] - second[0] * first[2]) % prime == 0 and (
            first[1] * second[2] - second[1] * first[2]
        ) % prime == 0

    @classmethod
    def _recover_x(cls, y: int, sign: int) -> int | None:
        prime = cls.PRIME
        if y >= prime:
            return None
        x2 = (y * y - 1) * pow(cls.CURVE_D * y * y + 1, prime - 2, prime) % prime
        if x2 == 0:
            return None if sign else 0
        x = pow(x2, (prime + 3) // 8, prime)
        if (x * x - x2) % prime != 0:
            x = x * cls.SQRT_M1 % prime
        if (x * x - x2) % prime != 0:
            return None
        if (x & 1) != sign:
            x = prime - x
        return x

    @classmethod
    def _base(cls) -> tuple:
        if cls.BASE is None:
            y = 4 * pow(5, cls.PRIME - 2, cls.PRIME) % cls.PRIME
            x = cls._recover_x(y, 0)
            cls.BASE = (x, y, 1, x * y % cls.PRIME)
        return cls.BASE

    @classmethod
    def _compress(cls, point: tuple) -> bytes:
        prime = cls.PRIME
        z_inv = pow(point[2], prime - 2, prime)
        x, y = point[0] * z_inv % prime, point[1] * z_inv % prime
        return int.to_bytes(y | ((x & 1) << 255), 32, 'little')

    @classmethod
    def _decompress(cls, raw: bytes) -> tuple | None:
        if len(raw) != 32:
            return None
        y = int.from_bytes(raw, 'little')
        sign = y >> 255
        y &= (1 << 255) - 1
        x = cls._recover_x(y, sign)
        return None if x is None else (x, y, 1, x * y % cls.PRIME)

    @staticmethod
    def _hash_int(*parts: bytes) -> int:
        return int.from_bytes(hashlib.sha512(b''.join(parts)).digest(), 'little')

    @classmethod
    def _secret(cls, seed: bytes) -> tuple[int, bytes]:
        if len(seed) != 32:
            raise ValueError('Ключ Ed25519 — 32 байта')
        digest = hashlib.sha512(seed).digest()
        secret = int.from_bytes(digest[:32], 'little')
        secret &= (1 << 254) - 8
        secret |= 1 << 254
        return secret, digest[32:]

    @classmethod
    def public_key(cls, seed: bytes) -> bytes:
        secret, _ = cls._secret(seed)
        return cls._compress(cls._mul(secret, cls._base()))

    @classmethod
    def sign(cls, seed: bytes, msg: bytes) -> bytes:
        secret, prefix = cls._secret(seed)
        pub = cls._compress(cls._mul(secret, cls._base()))
        nonce = cls._hash_int(prefix, msg) % cls.ORDER
        r_point = cls._compress(cls._mul(nonce, cls._base()))
        sig_s = (nonce + cls._hash_int(r_point, pub, msg) * secret) % cls.ORDER
        return r_point + int.to_bytes(sig_s, 32, 'little')

    @classmethod
    def verify(cls, public: bytes, msg: bytes, sig: bytes) -> bool:
        if len(public) != 32 or len(sig) != 64:
            return False
        pub = cls._decompress(public)
        r_point = cls._decompress(sig[:32])
        if pub is None or r_point is None:
            return False
        sig_s = int.from_bytes(sig[32:], 'little')
        if sig_s >= cls.ORDER:
            return False
        digest = cls._hash_int(sig[:32], public, msg) % cls.ORDER
        return cls._equal(cls._mul(sig_s, cls._base()), cls._add(r_point, cls._mul(digest, pub)))
