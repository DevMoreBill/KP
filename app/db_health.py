"""Проверка «здоровья» базы раз в неделю и по кнопке: целостность, категории, повторы, файлы КП."""

import os
import re
import time
from datetime import datetime, timedelta

from storage import DbZip


class DbHealth:
    KV = 'health'
    EVERY_DAYS = 7
    SAMPLES = 8

    def __init__(self, store, data_dir: str | None = None, docs_dir: str | None = None) -> None:
        self.store, self.data_dir, self.docs_dir = store, data_dir, docs_dir

    def last(self) -> dict:
        v = self.store.kv_get(self.KV)
        return v if isinstance(v, dict) else {}

    def due(self) -> bool:
        at = self.last().get('at') or ''
        return not at or at < (datetime.now() - timedelta(days=self.EVERY_DAYS)).isoformat(timespec='seconds')

    def weekly(self) -> dict | None:
        return self.run() if self.due() else None

    def run(self) -> dict:
        t0 = time.time()
        res = {
            'at': datetime.now().isoformat(timespec='seconds'),
            'integrity': DbZip.integrity(self.store.path, quick=True),
        }
        res['noCat'] = self._no_category()
        res['dups'] = self._duplicates()
        res['noFile'] = self._kp_without_file()
        res['seconds'] = round(time.time() - t0, 1)
        self.store.kv_set(self.KV, res)
        return res

    def _types(self) -> set:
        from equipment_types import load_types

        return {t.get('id') for t in load_types().get('types') or [] if isinstance(t, dict)}

    def _no_category(self) -> dict:
        known = self._types()
        rows = [
            (cid, name, cat)
            for cid, name, cat in self.store.all('SELECT id, name, cat FROM catalog')
            if not cat or cat not in known
        ]
        return {
            'n': len(rows),
            'samples': [{'id': c, 'name': n or c, 'cat': k or ''} for c, n, k in rows[: self.SAMPLES]],
        }

    @staticmethod
    def _key(s) -> str:
        # пробелы и дефисы не важны, знаки в числах — важны: «7,5/8» и «75/8» — разные модели
        return re.sub(r'[\s\-_]+', '', str(s or '').lower().replace('ё', 'е').replace(',', '.'))

    def _duplicates(self) -> dict:
        """Одинаковое название основного оборудования в категории (не по модели: исполнения отличаются словами)."""
        from equipment_types import load_types

        main = {
            t.get('id') for t in load_types().get('types') or [] if isinstance(t, dict) and t.get('role') != 'accessory'
        }
        groups = {}
        for cid, name, cat in self.store.all('SELECT id, name, cat FROM catalog'):
            if cat in main and name:
                groups.setdefault((cat, self._key(name)), []).append({'id': cid, 'name': name})
        dup = [g for g in groups.values() if len(g) > 1]
        return {'n': sum(len(g) for g in dup), 'groups': len(dup), 'samples': [g[:3] for g in dup[: self.SAMPLES]]}

    def _kp_without_file(self) -> dict:
        rows = self.store.all('SELECT id, number, docx FROM kp WHERE meta IS NOT NULL')
        miss = []
        for kid, num, rel in rows:
            if not rel:
                miss.append((kid, num, 'не сохранён'))
            elif self.docs_dir and not os.path.isfile(
                os.path.join(self.docs_dir, *str(rel).replace('\\', '/').split('/'))
            ):
                miss.append((kid, num, 'файла нет в папке'))
        return {'n': len(miss), 'samples': [{'id': k, 'number': n or k, 'why': w} for k, n, w in miss[: self.SAMPLES]]}

    def attention(self) -> list[dict]:
        """Пункты «Требует внимания» по последней проверке."""
        r = self.last()
        if not r:
            return []
        out = []
        if r.get('integrity') not in (None, 'ok'):
            out.append(
                {
                    'level': 'bad',
                    'text': f'Проверка базы: файл базы повреждён ({str(r["integrity"])[:120]}) — восстановите последнюю копию',
                    'tab': 'backup',
                    'key': 'health',
                    'alert': True,
                }
            )
        parts = []
        if (r.get('noCat') or {}).get('n'):
            parts.append(f'без категории — {r["noCat"]["n"]}')
        if (r.get('dups') or {}).get('groups'):
            parts.append(f'одинаковые названия — {r["dups"]["groups"]} групп')
        if (r.get('noFile') or {}).get('n'):
            parts.append(f'КП без файла Word — {r["noFile"]["n"]}')
        if parts:
            out.append(
                {
                    'level': 'info',
                    'text': f'Проверка базы {str(r.get("at") or "")[:10]}: {"; ".join(parts)}',
                    'tab': 'backup',
                }
            )
        return out
