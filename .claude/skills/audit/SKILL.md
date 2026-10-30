---
name: audit
description: Тотальный аудит «Конструктора КП» — линтеры, шесть помощников параллельно, проверенные находки, исправления выпусками с тем же поведением, повторная проверка, отчёт владельцу. Использовать по просьбе владельца «аудит».
disable-model-invocation: true
---
# Тотальный аудит
1. Разведка и baseline: run_all.py --strict, горячие зоны, вопросы владельцу одним списком.
2. Автоматика: Ruff с правилами S, BLE, PLR2004, C901; tests/code_style.py; ESLint с no-eval,
   no-implied-eval, no-new-func, eqeqeq. Вывод — audit/raw/.
3. Помощники параллельно: proverka-arhitektury, proverka-povtorov, proverka-oformleniya,
   proverka-vyorstki, proverka-bezopasnosti, proverka-raschetov.
4. Сводка: дедупликация, проверка каждой BLOCKER/MAJOR по коду, audit/findings.json.
5. Исправления: BLOCKER → MAJOR → MINOR, после каждой порции run_all.py --changed, слепки
   совпадают; выпуски по темам по SKILL.md /vypusk. Расчёты и видимое — только списком.
6. Повторная проверка: автоматика и помощники по изменённому, run_all.py --strict, прогон
   всех режимов, независимый ревьюер, CI зелёный.
7. Отчёт: audit/AUDIT_REPORT.md (локально) + короткий отчёт владельцу по-русски.
