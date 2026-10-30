"""Права администраторов «Настроек»: доступ к вкладкам (нет / просмотр / изменение) и к отдельным действиям.

Главный администратор может всё и один управляет администраторами; прежние учётные записи (до прав) — главные.
Адрес запроса → вкладка и действие — таблица RULES; проверка — до маршрута (admin.guard и AdminApi.handle)."""

import re
from dataclasses import dataclass
from typing import Any

FREE = ''  # адрес без проверки прав (вход, свой пароль)
MAIN = '*'  # адрес только для главного администратора
HOME = 'home'


@dataclass(frozen=True)
class Rule:
    """Адрес → вкладка; write — действие для изменения (POST, PUT, DELETE), always — действие и для чтения."""

    pattern: re.Pattern
    section: str
    write: str = ''
    always: str = ''
    peek: tuple = ()  # изменение с этими полями тела — ещё и действие write (например, адрес вебхука)
    also: str = ''  # ещё одно действие для любого запроса (база целиком — это и все ключи API)
    # ((параметр адреса, значение в списке через запятую, действие), …): файл настроек с ключами
    query_needs: tuple = ()


def rule(pattern: str, section: str, **kw: Any) -> Rule:
    return Rule(re.compile(pattern), section, **kw)


class AdminRights:
    """Что разрешено администратору: {main, sections: {вкладка: view|edit}, actions: [...]}."""

    LEVELS = ('none', 'view', 'edit')
    VIEW, EDIT = 'view', 'edit'
    READ = ('GET', 'HEAD')
    # (ключ вкладки, группа, подпись) — как в меню «Настроек» (app/web/js/features/admin/admin-nav.js)
    SECTIONS = (
        ('goods', 'Каталог', 'Товары'),
        ('moderation', 'Каталог', 'Правки сотрудников'),
        ('types', 'Каталог', 'Категории и характеристики'),
        ('feeds', 'Каталог', 'Фиды поставщиков'),
        ('managers', 'Люди и доступ', 'Менеджеры'),
        ('audit', 'Люди и доступ', 'Журнал действий'),
        ('templates', 'Документы', 'Шаблоны КП'),
        ('ourdocs', 'Документы', 'Наши реквизиты'),
        ('mail', 'Документы', 'Почта и письма'),
        ('db-client', 'Справочники', 'Клиенты'),
        ('db-supplier', 'Справочники', 'Поставщики и склады'),
        ('db-kp', 'Справочники', 'Сохранённые КП'),
        ('params', 'Параметры', 'Параметры программы'),
        ('bitrix', 'Связи', 'Битрикс24'),
        ('services', 'Связи', 'Сервисы и ключи'),
        ('carriers', 'Связи', 'Перевозчики и тарифы'),
        ('updates', 'Обслуживание', 'Обновления'),
        ('backup', 'Обслуживание', 'Копии и база'),
        ('trash', 'Обслуживание', 'Корзина'),
        ('changes', 'Обслуживание', 'Файл и история настроек'),
        ('system', 'Обслуживание', 'Система'),
        ('danger', 'Обслуживание', 'Опасная зона'),
    )
    ACTIONS = {
        'delete': 'Удаление и корзина',
        'db': 'База данных: замена, загрузка, выгрузка целиком',
        'updates': 'Установка и откат обновлений',
        'secrets': 'Ключи и пароли сервисов',
    }
    DELETE_SECTION = {
        'kp': 'db-kp',
        'catalog': 'goods',
        'manager': 'managers',
        'client': 'db-client',
        'supplier': 'db-supplier',
    }
    ADM = r'^/api/admin/'
    RULES = (
        rule(ADM + r'(status|setup|login|logout|password)$', FREE),
        rule(ADM + r'users$', MAIN),
        rule(ADM + r'(attention|readiness|stats)$', HOME),
        rule(ADM + r'feedback(/\d{1,9}/done)?$', HOME),
        rule(ADM + r'(system|log|log/download|restart|folder)$', 'system'),
        rule(ADM + r'alerts(/.*)?$', 'system', write='secrets', peek=('password',)),
        rule(ADM + r'update(/.*)?$', 'updates', write='updates'),
        rule(ADM + r'history(/.*)?$', 'changes'),
        rule(ADM + r'settings-file/preview$', 'changes'),
        rule(ADM + r'settings-file$', 'changes', write='db', query_needs=(('keys', '1', 'secrets'),)),
        rule(ADM + r'connections$', 'services'),
        rule(ADM + r'ai(/test)?$', 'services', write='secrets', peek=('key', 'apiKey', 'base')),
        rule(ADM + r'access(/.*)?$', 'managers'),
        rule(ADM + r'(rules/stations|features|lists|defaults)$', 'params'),
        rule(ADM + r'mail$', 'mail', write='secrets', peek=('password', 'clearPassword', 'moved')),
        rule(ADM + r'mail/test$', 'mail'),
        rule(ADM + r'bitrix(/.*)?$', 'bitrix', write='secrets', peek=('url',)),
        rule(ADM + r'audit(/.*)?$', 'audit'),
        rule(ADM + r'feeds/[^/]+/purge$', 'feeds', write='delete'),
        rule(ADM + r'feeds/[^/]+/import$', 'feeds', write='delete', peek=('trashMissing',)),
        rule(ADM + r'(feeds(/.*)?|logos)$', 'feeds'),
        rule(ADM + r'delete$', 'trash', write='delete'),
        rule(ADM + r'(kpfiles|dealfiles)/.*/delete$', 'db-kp', write='delete'),
        rule(ADM + r'list/kp$', 'db-kp'),
        rule(ADM + r'list/catalog$', 'goods'),
        rule(ADM + r'list/manager$', 'managers'),
        rule(ADM + r'list/client$', 'db-client'),
        rule(ADM + r'list/supplier$', 'db-supplier'),
        rule(ADM + r'trash(/.*)?$', 'trash', write='delete'),
        rule(ADM + r'(moderation|pending(/.*)?)$', 'moderation'),
        rule(ADM + r'export/sqlite$', 'backup', always='db', also='secrets'),
        rule(ADM + r'export(/.*)?$', 'backup'),
        rule(ADM + r'import(/.*)?$', 'backup', write='db'),
        rule(ADM + r'maint/mirror(/check)?$', 'backup', write='secrets', peek=('password', 'moved')),
        rule(ADM + r'maint(/.*)?$', 'backup'),
        rule(ADM + r'migrations(/.*)?$', 'danger', write='db'),
        rule(r'^/api/catalog/trash(/.*)?$', 'goods', write='delete'),
        rule(r'^/api/catalog/(moderation|pending)(/.*)?$', 'moderation'),
        rule(r'^/api/catalog/export(/.*)?$', 'goods'),
        rule(r'^/api/catalog/[A-Za-z0-9_-]{1,64}$', 'goods'),
        rule(r'^/api/types$', 'types'),
        rule(r'^/api/logistics/carriers$', 'carriers', write='secrets', peek=('moved',)),
        rule(r'^/api/logistics(/refresh|/carriers.*|/china.*)?$', 'carriers'),
        rule(r'^/api/onec(/.*)?$', 'services', write='secrets', peek=('password',)),
        rule(r'^/api/(requisites|doctpl/.*)$', 'ourdocs'),
        rule(r'^/api/integrations/export$', 'services', always='secrets'),
        rule(r'^/api/integrations$', 'services', write='secrets'),
        rule(r'^/api/uitexts$', 'params'),
        rule(r'^/api/templates/(folder|[A-Za-z0-9_-]+/(file|restore|copy|reset|delete|open))$', 'templates'),
    )
    ADMIN_PATH = '/api/admin/'
    UNLISTED = rule(r'$^', MAIN)
    # код шаблона выполняется в окне каждого, кто строит КП (и главного администратора) — меняет только главный
    CODE_FILE = re.compile(r'^skeleton(-[\d-]+)?\.js$')
    CODE_PATH = re.compile(r'^/api/templates/[A-Za-z0-9_-]+/(file|restore)$')

    def __init__(self, accounts: list) -> None:
        self.accounts = accounts

    # ---------------------------------------------------------------- учётная запись
    @staticmethod
    def is_main(account: dict) -> bool:
        """Главный: отмечен главным, а прежние учётные записи без прав — главные (ничего не теряют)."""
        return bool(account.get('main', 'rights' not in account))

    def account(self, login: str) -> dict | None:
        low = (login or '').strip().lower()
        found = next((acc for acc in self.accounts if acc.get('login', '').lower() == low), None)
        if found is None and not low and len(self.accounts) == 1:
            return self.accounts[0]  # прежний вход без логина — единственная учётная запись
        return found

    def view(self, login: str) -> dict:
        """Права вошедшего — для меню «Настроек»: {main, sections, actions}."""
        acc = self.account(login) or {}
        if self.is_main(acc):
            return {
                'main': True,
                'sections': dict.fromkeys(self.section_keys(), self.EDIT),
                'actions': list(self.ACTIONS),
            }
        rights = self.clean(acc.get('rights'))
        return {'main': False, **rights}

    @classmethod
    def section_keys(cls) -> list[str]:
        return [key for key, _group, _label in cls.SECTIONS]

    @classmethod
    def clean(cls, raw: Any) -> dict:
        """Права из запроса или базы: только известные вкладки, уровни и действия."""
        raw = raw if isinstance(raw, dict) else {}
        given = raw.get('sections') if isinstance(raw.get('sections'), dict) else {}
        sections = {key: given[key] for key in cls.section_keys() if given.get(key) in (cls.VIEW, cls.EDIT)}
        given_actions = raw.get('actions') if isinstance(raw.get('actions'), list) else []
        actions = [key for key in cls.ACTIONS if key in given_actions]
        return {'sections': sections, 'actions': actions}

    @classmethod
    def schema(cls) -> dict:
        """Вкладки и действия — для редактора прав."""
        return {
            'sections': [{'key': key, 'group': group, 'label': label} for key, group, label in cls.SECTIONS],
            'actions': [{'key': key, 'label': label} for key, label in cls.ACTIONS.items()],
        }

    # ---------------------------------------------------------------- проверка запроса
    @classmethod
    def rule_of(cls, path: str) -> Rule | None:
        return next((one for one in cls.RULES if one.pattern.match(path)), None)

    @classmethod
    def needs_body(cls, method: str, path: str) -> bool:
        """Проверке нужно тело запроса (читается, только если нужно: большие файлы маршрут читает сам)."""
        found = cls.rule_of(path)
        return method not in cls.READ and found is not None and (bool(found.peek) or path == '/api/admin/delete')

    @staticmethod
    def same_value(new: Any, cur: Any) -> bool:
        return str(new or '').strip().rstrip('/') == str(cur or '').strip().rstrip('/')

    def refuse(self, login: str, method: str, path: str, body: dict | None = None, query: dict | None = None) -> str:
        """Почему администратору нельзя этот запрос ('' — можно); query — параметры адреса (имя файла шаблона)."""
        found = self.rule_of(path)
        if found is None and path.startswith(self.ADMIN_PATH):
            found = self.UNLISTED  # адрес «Настроек» без строки в таблице — только главному (новое не открывается само)
        if found is None or found.section in (FREE, HOME):
            return ''
        if not path.startswith(self.ADMIN_PATH) and method in self.READ and not found.always:
            return ''  # адреса программы (каталог, тексты, шаблоны) читает и окно менеджера
        acc = self.account(login)
        if acc is None:
            return 'Учётная запись администратора не найдена — войдите заново'
        if self.is_main(acc):
            return ''
        if found is self.UNLISTED:
            return 'Это действие «Настроек» доступно только главному администратору'
        if found.section == MAIN:
            return 'Администраторами и их правами управляет главный администратор'
        if self._template_code(method, path, query or {}):
            return 'Код шаблона (skeleton.js) меняет только главный администратор: он выполняется у всех, кто строит КП'
        rights = self.clean(acc.get('rights'))
        why = self._why(rights, found, method, path, body or {})
        if why:
            return why
        for param, token, action in found.query_needs:
            if token in str((query or {}).get(param) or '').split(','):
                why = why or self._lacks(rights, action)
        return why or (self._lacks(rights, found.also) if found.also else '')

    def _why(self, rights: dict, found: Rule, method: str, path: str, body: dict) -> str:
        section = self._section(found, path, body)
        label = {key: name for key, _group, name in self.SECTIONS}.get(section, section)
        level = rights['sections'].get(section, 'none')
        write = method not in self.READ
        if level == 'none':
            return f'Нет доступа к разделу «{label}» — права выдаёт главный администратор'
        if write and level != self.EDIT:
            return f'Раздел «{label}» открыт только для просмотра — изменения не сохраняются'
        need = found.always or (found.write if write and self._needs_write_action(found, path, body) else '')
        return self._lacks(rights, need) if need else ''

    def _lacks(self, rights: dict, action: str) -> str:
        if action in rights['actions']:
            return ''
        return f'Нет права «{self.ACTIONS[action]}» — его выдаёт главный администратор'

    def has_action(self, login: str, action: str) -> bool:
        """Главный или отмечено действие."""
        acc = self.account(login)
        if acc is None:
            return False
        return self.is_main(acc) or action in self.clean(acc.get('rights'))['actions']

    @classmethod
    def _template_code(cls, method: str, path: str, query: dict) -> bool:
        name = str(query.get('name') or '')
        return method not in cls.READ and bool(cls.CODE_PATH.match(path)) and bool(cls.CODE_FILE.match(name))

    def _section(self, found: Rule, path: str, body: dict) -> str:
        if path == '/api/admin/delete':
            return self.DELETE_SECTION.get(str(body.get('type') or ''), 'trash')
        return found.section

    @staticmethod
    def _needs_write_action(found: Rule, path: str, body: dict) -> bool:
        if path == '/api/admin/delete':
            return True
        return not found.peek or any(AdminRights.given(body.get(key)) for key in found.peek)

    @staticmethod
    def given(value: Any) -> bool:
        """Значение задано заново: не пусто, не false и не «звёздочки», которыми экран показывает сохранённый пароль."""
        if isinstance(value, bool):
            return value
        if isinstance(value, dict):
            return any(AdminRights.given(item) for item in value.values())
        text = str(value or '').strip()
        return bool(text) and not set(text) <= {'•', '*'}
