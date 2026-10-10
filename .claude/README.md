# Среда разработки Claude Code для проекта

[ECC](https://github.com/affaan-m/ECC) (релиз **v2.2.3**, лицензия MIT — `ECC-LICENSE`) подключён двумя способами:

1. **Полный плагин `ecc@ecc`** — `.claude/settings.json` (`extraKnownMarketplaces` с закреплённой версией v2.2.3 и
   `enabledPlugins`): 68 агентов, 293 навыка, 94 команды и хуки ECC. Работает в Claude Code на компьютере (CLI, приложение,
   VS Code) после того, как папке проекта доверяют. Плагин из внешнего репозитория каждый ставит у себя один раз:
   `/plugin install ecc@ecc` (маркетплейс `ecc` уже зарегистрирован настройками проекта). Добавляет около 45 тыс. токенов
   в каждую сессию. Отключить у себя, не трогая проект: `"enabledPlugins": {"ecc@ecc": false}` в `.claude/settings.local.json`.
2. **Выборочный набор в репозитории** (таблица ниже) — для облачных сессий (claude.ai/code): там плагины из
   `enabledPlugins` не загружаются, работает только то, что лежит в `.claude/` репозитория. На компьютере с плагином
   имена не пересекаются: у плагина — `ecc:python-reviewer`, `/ecc:tdd-workflow`, здесь — `python-reviewer`, `/tdd-workflow`.

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
Плагин — поменять `ref` в `.claude/settings.json` на новую метку и выполнить `/plugin marketplace update ecc`.
