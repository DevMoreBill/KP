"""Сохранение позиции каталога: что изменилось, модерация, обязательные поля и дубли, цены «из КП»."""

import json
from enum import Enum
from typing import Any

from admin_access import _body_obj, _loads, actor, login_on, perm
from admin_accounts import _now
from admin_journal import _short, log
from catalog_quality import CardRules, DupFinder, KpPriceProof
from storage import Conflict

# поля товара, которые меняет само сохранение КП (цены и история): такие правки не модерируются
AUTO_KEYS = {'price', 'priceCur', 'cost', 'costCur', 'margin', 'mmode', 'prices', 'updatedAt', 'pricesCount'}


LABELS = {
    'name': 'Наименование',
    'spec': 'Краткие характеристики',
    'price': 'Цена',
    'priceCur': 'Валюта цены',
    'cost': 'Закупка',
    'costCur': 'Валюта закупки',
    'pageTitle': 'Заголовок страницы',
    'photoCaption': 'Подпись к фото',
    'features': 'Описание',
    'groups': 'Характеристики',
    'hint': 'Титул',
    'attrs': 'Параметры и категория',
    'photo': 'Главное фото',
    'logo': 'Логотип',
    'gallery': 'Изображения',
    'options': 'Опции',
    'prices': 'История цен',
}


ABSENT = '__absent__'


def diff(before, after, skip=()) -> tuple:
    """Только изменённые поля: ({поле: было}, {поле: стало}); отсутствующее поле — ABSENT."""
    before_obj, after_obj = before or {}, after or {}

    def norm(v) -> Any:
        return ABSENT if v in (None, '', [], {}) else v  # пустое и отсутствующее поле — одно и то же

    keys = [
        k
        for k in sorted(set(before_obj) | set(after_obj))
        if k not in skip
        and not k.startswith('_')
        and json.dumps(norm(before_obj.get(k)), sort_keys=True, ensure_ascii=False)
        != json.dumps(norm(after_obj.get(k)), sort_keys=True, ensure_ascii=False)
    ]
    return {k: _short(before_obj.get(k, ABSENT)) for k in keys}, {k: _short(after_obj.get(k, ABSENT)) for k in keys}


def moderation(store) -> dict:
    return (store.kv_get('settings') or {}).get('productEditModeration') or {'enabled': False}


def _set_moderation(store, enabled, author: str) -> None:
    settings = store.kv_get('settings') or {}
    settings['productEditModeration'] = {'enabled': bool(enabled), 'updatedAt': _now(), 'updatedBy': author}
    store.kv_set('settings', settings)


class CardSource(Enum):
    """Откуда сохранение карточки: правка человеком или загрузка из файла (заголовок X-KP-Edit: import)."""

    HAND = 'hand'
    FILE = 'import'

    @classmethod
    def of(cls, header: str | None) -> 'CardSource':
        return cls.FILE if header == cls.FILE.value else cls.HAND


class CardQuality:
    """Проверка карточки при сохранении человеком: обязательное у основного оборудования и возможные дубли (функция «catQuality»)."""

    def __init__(self, store, before: dict | None, after: dict, cid: str, source: CardSource = CardSource.HAND) -> None:
        from features import FeatureAccess

        self.store, self.before, self.after, self.cid = store, before, after, cid
        # загрузка каталога из файла (JSON, Excel) — как фиды: не блокируется, неполное видно пометкой в каталоге
        self.enabled = source is not CardSource.FILE and FeatureAccess(store).is_on('catQuality')

    def gaps(self) -> list[str]:
        from equipment_types import load_types

        return CardRules(load_types()['types']).check(self.before, self.after)

    def dups(self) -> list[dict]:
        from equipment_types import load_types

        if not CardRules(load_types()['types']).is_main(self.after) or not DupFinder.changed(self.before, self.after):
            return []
        return DupFinder(self.store).find(self.after, self.cid)


class RefusedCard:
    """Отклонённое сохранение карточки — в журнал: причина, что хотели сохранить и карточка целиком (_card), чтобы
    администратор мог открыть её и добавить сам."""

    CARD_LIMIT = 300000

    @classmethod
    def log(cls, handler, store, before: dict | None, after: dict, cid: str, reason: str) -> None:
        found = after.get('attrs')
        attrs: dict = found if isinstance(found, dict) else {}
        brief = {
            'Причина отказа': reason,
            'Наименование': after.get('name') or '',
            'Категория': attrs.get('cat') or '',
            'Производитель': attrs.get('maker') or '',
            'Модель': attrs.get('model') or '',
            '_card': _short(after, cls.CARD_LIMIT),
        }
        action = 'edit_product' if before else 'create_product'
        log(handler, store, action, 'product', cid, None, {k: v for k, v in brief.items() if v}, result='failed')


def _put_product(handler, store, cid, admin) -> None:
    """Единая точка сохранения товара: модерация (черновик) или сразу в каталог; всё — в журнал."""
    after = _body_obj(handler)
    if not after or not isinstance(after.get('attrs', {}), dict):
        return handler.send(
            400, 'text/plain; charset=utf-8', 'Неверный запрос: нужна карточка оборудования (объект JSON)'
        )
    for k in ('name', 'model', 'desc'):
        if k in after and not isinstance(after[k], str):
            after[k] = '' if after[k] is None else str(after[k])
    text = json.dumps(after, ensure_ascii=False)
    before_text = store.catalog_get(cid)
    before = _loads(before_text)
    before_diff, after_diff = diff(before, after)  # что изменилось (одним сравнением на всё сохранение)
    auto = before is not None and set(after_diff) <= AUTO_KEYS  # сохранение КП обновило только цены и историю
    no_right = not admin and login_on(handler) and not perm(handler, 'catEdit' if before is not None else 'catAdd')
    if no_right and not auto:
        reason = f'Нет права {"редактировать" if before is not None else "добавлять"} оборудование в каталоге — обратитесь к администратору'
        RefusedCard.log(handler, store, before, after, cid, reason)
        return handler.send(403, 'text/plain; charset=utf-8', reason)
    quality = CardQuality(store, before, after, cid, CardSource.of(handler.headers.get('X-KP-Edit')))
    gaps = quality.gaps() if not auto and quality.enabled else []
    from_kp = handler.headers.get('X-KP-Edit') == 'auto'
    # цены «из КП» мимо модерации и без права правки — только подтверждённые последним КП, сохранённым этим сотрудником
    kp_price = auto and from_kp and KpPriceProof(store).holds(actor(handler)[1], cid, before, after)
    if gaps and not from_kp:
        RefusedCard.log(handler, store, before, after, cid, CardRules.text(gaps))
        return handler.send(400, 'text/plain; charset=utf-8', CardRules.text(gaps))
    # модерация не касается администратора и менеджера с правом «Правки без модерации»
    mod = moderation(store).get('enabled') and not admin and not (login_on(handler) and perm(handler, 'catSelfMod'))
    # без права правки цена, которую КП не подтверждает, ждёт решения (КП сохраняется, каталог не меняется)
    mod = (mod or no_right) and not kp_price
    dups = quality.dups() if not (admin or auto) and quality.enabled else []
    # возможный дубль и неполная позиция из сохранённого КП — на модерацию (КП сохраняется, каталог не засоряется)
    if mod or dups or gaps:
        uid, name, _ = actor(handler, False)
        pid = store.pending_add(cid, 'update' if before else 'create', before_text, text, uid, name)
        before_spec, after_spec = diff(before, after, AUTO_KEYS)
        if dups or gaps:
            after_spec = dict(after_spec or {}, _dups=[dup['name'] for dup in dups], _gaps=gaps)
        log(handler, store, 'submit_edit', 'product', cid, before_spec, after_spec, admin=False)
        return handler.send_json({'ok': True, 'pending': True, 'pendingId': pid, 'dups': dups})
    try:
        rev = store.catalog_put(cid, text, actor(handler, admin)[1], handler.base_rev())
    except Conflict as exc:
        return handler.conflict(exc)
    log(
        handler,
        store,
        'price_sync' if auto else ('edit_product' if before else 'create_product'),
        'product',
        cid,
        before_diff if before else None,
        after_diff,
        admin=admin,
    )
    return handler.send_json({'ok': True, 'rev': rev})
