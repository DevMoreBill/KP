# Среда разработки Claude Code для проекта

Выборочная интеграция [ECC](https://github.com/affaan-m/ECC) (релиз **v2.2.3**, лицензия MIT — `ECC-LICENSE`).
Полный плагин `ecc@ecc` не подключён: он добавляет ~45 тыс. токенов в каждую сессию (387 навыков, 68 агентов, хуки
на каждое действие), а большая часть его содержимого — для других стеков. Здесь — только то, что подходит проекту
(Python stdlib + SQLite + обычный JavaScript + тесты на Playwright). Хуков нет.

| Что | Где | Зачем |
|---|---|---|
| Правила проекта | `rules/00-project.md` | стек, ограничения, стиль — главнее общих правил |
| Правила ECC | `rules/ecc/common` | качество кода, ревью, безопасность, тесты, git |
| | `rules/ecc/python` | только для `*.py` (по `paths` во фронтматтере) |
| | `rules/ecc/web` | только для `*.css`, `*.html` |
| Агенты | `agents/python-reviewer.md` | ревью Python-кода |
| | `agents/code-reviewer.md` | общее ревью изменений |
| | `agents/security-reviewer.md` | уязвимости, секреты, ввод пользователя |
| | `agents/silent-failure-hunter.md` | проглоченные ошибки, тихие откаты |
| | `agents/e2e-runner.md` | e2e-сценарии (Playwright) |
| Навыки | `skills/verification-loop` | проверка работы перед сдачей: сборка, линт, тесты, дифф |
| | `skills/tdd-workflow` | сначала падающий тест, потом код |
| | `skills/python-testing`, `skills/python-patterns` | тесты и идиомы Python |
| | `skills/e2e-testing` | шаблоны Playwright |

Убрано из наборов правил: `common/agents.md` (ссылается на агентов полного плагина), `*/hooks.md` (хуки не ставятся),
`python/fastapi.md` (FastAPI в проекте нет).

## Как пользоваться
- Агенты — по просьбе: «проверь изменения агентом python-reviewer», «прогони security-reviewer по app/geo.py».
- Навыки — `/verification-loop`, `/tdd-workflow` и т. д. или просьбой своими словами.

## Обновление до новой версии ECC
```bash
git clone --depth 1 --branch vX.Y.Z https://github.com/affaan-m/ECC /tmp/ecc
# скопировать те же файлы из /tmp/ecc/{agents,skills,rules} поверх, просмотреть дифф, закоммитить
```
Нужен полный плагин — `/plugin marketplace add affaan-m/ECC` и `/plugin install ecc@ecc` (в своей пользовательской
области, не поверх этих файлов: иначе навыки и агенты задвоятся).
