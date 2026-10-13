# Карта приложения «Конструктор КП ПНЕВМОТЕХ» (версия 3.73.0, 12.10.2026)

Правила разработки — `.claude/rules/00-project.md` (стандартная библиотека Python, JS без сборщика, ООП, русский язык, миграции, безопасность).
Подробности по версиям — `README.md`, журнал версий — `APP_VERSIONS` в `app/web/js/features/help.js`, для пользователей — `Инструкция.txt`.

## 1. Что это и для кого
Программа отдела продаж ООО «ПНЕВМОТЕХ» для технико-коммерческих предложений (КП в DOCX и PDF): каталог оборудования (компрессоры, ДГУ,
осушители, насосы…), клиенты и проверка контрагентов, цены, «Экономика сделки» с логистикой, ход сделки, шаблоны КП, станции в контейнере
(компоновка, чертёж по ЕСКД, 3D-вид, расчёт). Один EXE стоит на сервере отдела (Windows 8.1/10/11, 64-бит), менеджеры работают в браузере
(`http://ИМЯ-КОМПЬЮТЕРА:17845/`, есть телефонная раскладка), администратор — «⋯ → Настройки».

## 2. Запуск, сборка, выпуск
- **EXE:** точка входа `app/launcher.py` (`Launcher`) → `kp_server.py`. `settings.json` рядом с EXE: `mode` (`local` | `server`), `port` (17845),
  `dataDir`, `docsShare`, `allowedHosts` (`config.py`). Постоянная папка — `C:\KP` (`install/Установить в C KP.cmd`, `install-full.ps1`).
- **Сервер отдела:** `server-setup/1. Установить сервер отдела.bat` (режим server, брандмауэр, общая папка КП, задача Планировщика ONSTART
  от SYSTEM, ярлык); `2. Остановить` / `3. Запустить` / `4. Удалить` (`kp-server.ps1` + `install/kp-common.ps1`: `Stop-KP`, `Start-KP`,
  `Set-KPTask`); описание — `server-setup/Как устроен сервер отдела.txt`. Задачу Планировщика проверяет и чинит `server_task.ServerTask`.
- **Из исходников:** `python app/kp_server.py` — данные в `app/data`, `app/settings.json` (в `.gitignore`). Интерфейс: правка `app/web` + F5.
- **Данные пользователя** (`config.resolve_dirs`, папка `data` рядом с EXE или в `dataDir`): `data/kp.sqlite3` — база; `data/img/` — фото
  и логотипы (`images.ImageStore`, пути латиницей + отпечаток md5); `data/backup/` — копии перед обновлением, импортом, загрузкой базы;
  `data/backup/auto/` — ежедневные `kp-ГГГГ-ММ-ДД.zip`; `data/backup/audit-archive/`; `data/logs/kp.log`; `Коммерческие предложения/<Фамилия>/`
  — готовые .docx; `templates/` — шаблоны КП. Каталог и фото в EXE не встроены (с 3.46): новая база пустая, данные — на сервере отдела.
- **Автокопии:** `maintenance.DbCopy` + `Background` — при запуске и раз в сутки: согласованная копия → `integrity_check` → ZIP (`storage.DbZip`)
  → ротация (7 дней, по одной на 4 недели и 12 месяцев); раз в месяц VACUUM; состояние — kv `maint`. Вторая папка (сетевой диск, облако) —
  `backup_mirror.MirrorBackup` (kv `settings.backup2`). Вручную — «Настройки → Обслуживание → Копии и база» или `server-setup/5. Резервная копия базы.bat`.
- **Сборка:** `.github/workflows/build-exe.yml` на каждую отправку. Job `tests` (ubuntu): `repo_guard.py`, pyflakes 4.0.0, ESLint 10.1.0
  (`eslint.config.mjs`, правило необъявленных имён по всем файлам), `tests/run_all.py --no-static --strict`. Job `build` (windows-latest,
  Python 3.12 x64, PyInstaller из `requirements-build.txt`, `kp.spec`): проверки EXE (SQLite внутри, запуск, DOCX/PDF через LibreOffice,
  папка update, установка обновления из «Настроек» и откат на сломанных 99.0.x, остановка/запуск сервера, задача Планировщика).
  Артефакты: EXE, комплект `Конструктор КП.zip` (EXE + server-setup + install + Инструкция.txt), патч `Обновление КП.zip`.
- **kp.spec:** вход `app/launcher.py`; данные `app/web`, `icon.ico`, `equipment_types.json`, `templates`; `hiddenimports` — все модули `app/*.py`
  (проверяет `tests/test_project.py`); `STDLIB` — запас модулей стандартной библиотеки для будущих патчей; версия файла — из `app/version.py`.
- **Выпуск:** тег `v*` или Actions → «Сборка EXE для Windows» → Run workflow с `release = true` (`workflow_dispatch`): тег `v<VERSION>`
  ставится на собранный коммит, файлы релиза латиницей — `KP-Konstruktor-<v>-win64.exe|.zip`, `KP-Obnovlenie-<v>.zip`.
- **Пакет обновления (патч):** `update/` (`version.json`, `app/*.py`, `app/web/…`, `templates/…`) + `server-setup` + `install/patch/Установить
  обновление.cmd` (`install-update.ps1`) → `C:\KP\update`. `Launcher` берёт код и интерфейс из `update`, только если версия новее встроенной
  (`config.UPDATE_DIR`, `APP_DIR`). В программе — «Настройки → Обслуживание → Обновления»: `app_update.UpdatePackage` (проверка архива),
  `ReleaseSource` (GitHub Releases), `Updater` (копия базы перед установкой, история — kv `update`), `Restarter`, ночные — `NightUpdate`.
- **Откат обновления:** прежнее — `update.prev` (кнопкой). Не запустилось (ошибка импорта или самопроверки `StartCheck`: `/api/version`,
  `/api/ping`, `/`) → `update` → `update.failed`, `update.prev` → `update`, запись `update-failed.json`, перезапуск (EXE с 3.51,
  `KP_UPDATE_FALLBACK`). Причина видна в «Обновлениях» (`Updater.absorb_failures`). Откат миграции базы — `Store.migration_down` (админка).
- **Проверки:** `python3 tests/run_all.py` (≈2 мин; `--strict` — нет pyflakes/Node = ошибка, как в CI; `--quick`; `--no-static`; имена наборов).
  `python .github/scripts/repo_guard.py .` — нет баз SQLite, `kp*.zip`, `integrations.json`, строк-ключей и токенов. Стенд — `tests/kit.py`
  (`Stand`, `SampleData`, `TempStore`, `SmtpSink`; вымышленные данные, без интернета). Node-проверки `tests/js/*.js` (расчёт и компоновка станций,
  сценарии ТЗ → КП, подбор по ТЗ, DOCX без шаблона) вызываются из `test_station_*`, `test_tz_*`. `.github/scripts/osifont_fix.py` — правка
  шрифта чертежей `app/web/fonts/osifont-italic.ttf` (Э, Ё, ё).

## 3. Сервер (`app/*.py`)
| Модуль | За что отвечает (главные классы) |
|---|---|
| `launcher.py` | точка входа EXE: подключение папки update, откат при сбое (`Launcher`, `_UpdateFinder`); патчем не меняется |
| `kp_server.py` | HTTP/1.1-сервер: `Handler` (ответы, файлы, ETag/gzip, проверка Host/Origin, лимит тела, CSP, 409 по `X-KP-Rev`), `Server`, `Server6` |
| `web_api.py` | маршруты API: `Controller` + `@route`, `Router`; контроллеры Static, Types, Geo, Parties, Templates, System, Catalog, Managers, Kp, Tools, Settings, Deal, Track, Drafts, ClientCard, Me, Service |
| `admin.py` | «Настройки»: `AdminSessions`, `AdminApi` (`/api/admin/*`), `guard` (права, модерация, журнал до маршрутизации), `is_admin`, корзина, audit |
| `admin_overview.py` | `SystemInfo` (версия, режим, папки, место), `Attention` («Требует внимания») |
| `admin_alerts.py` | `AdminAlerts` — письма администратору о проблемах сервера (kv `alerts`) |
| `auth_users.py` | вход менеджеров по логину/паролю и права (kv `mgrAccess`, `userSessions`, cookie `kp_user`) — функции |
| `features.py` | `FeatureAccess` — функции программы: вкл/выкл, кому доступны, закрытие адресов (403) |
| `config.py` | пути и режим (`settings.json`), `store()`, `BadRequest`, `safe_id`/`safe_file`, `UPDATE_DIR`/`APP_DIR` |
| `data_setup.py` | подготовка при запуске: папки, `FreshBase` (признак новой базы), сверка нумерации КП |
| `storage.py` | SQLite: `Store` (таблицы, rev, миграции, корзина, audit, kv, копии), `DbZip`, `Conflict`, `like_arg`, `MIGRATIONS` |
| `catalog_sync.py` | `CatalogSync` — докачка изменений каталога (`seq`/`epoch`) и поиск по характеристикам на сервере |
| `catalog_migrate.py` | разовое обновление каталога под новые категории (с копией базы) — функции, `run()` |
| `equipment_types.py` + `.json` | справочник типов (категорий) оборудования: встроенный + свои (kv `types`) |
| `images.py` | `ImageStore` — хранилище `data/img` |
| `imgfetch.py` | логотипы производителей, загрузка картинки по ссылке (защита от внутренних адресов, `_SafeRedirect`) |
| `kp_templates.py` | шаблоны КП в `templates/<id>`: файлы, история `_history`, копия, заводской вариант (`TemplateError`) |
| `kp_track.py` | ход сделки: `DealTrack`, `OfferTerm` (срок КП), `ReminderList`, `Mailer` + `MailTemplate` (SMTP, kv `mail`), `Val` (проверка ввода) |
| `counterparty.py` | реквизиты по ИНН и проверка: `CheckoApi`, `OfDataApi`, `GirBo`, `Rusprofile`, `Counterparties`, `LimitError` |
| `cbr.py` | курсы ЦБ РФ и ключевая ставка — функции |
| `workcal.py` | производственный календарь РФ (рабочие/банковские дни) — функции, кэш kv `workcal:<год>` |
| `logistics_api.py` | цены перевозчиков и автообновление ставок (`TariffInput`, функции по перевозчикам) |
| `geo.py` | адреса и маршруты: подсказки, координаты, `RoadRoute` (OSRM), раскрытие коротких ссылок карт |
| `feeds.py` / `feed_files.py` | фиды поставщиков: YML и «фид из файлов» (парс сайта CSV/JSON + прайс XLSX + остатки) — функции |
| `ai_llm.py` | нейросеть (DeepSeek / OpenAI-совместимый API): автозаполнение, расход (kv `aiUsage`) — функции |
| `ai_profile.py` | образец объёма для ИИ: `CategoryProfile`, `ModelFacts`, `KeyNorm` |
| `pdf_text.py` | текст из PDF без библиотек (`Doc`, `Font`, лексер) |
| `doc_text.py` | текст из ТЗ: PDF, DOCX, XLSX, ODT/ODS, RTF, TXT, сканы (`DocText`, `TextQuality`, `Xml`, `Rtf`) |
| `ocr_win.py` | `WinOcr` — распознавание сканов встроенным OCR Windows 10/11 |
| `tz_parse.py` | требования к станции из текста ТЗ правилами: `TzParse`, анкета `TzReview` |
| `station_rules.py` | `StationRules` — файл инженерных правил станций: проверка, своя версия администратора, выдача скриптом |
| `pdf_convert.py` | DOCX → PDF: Word, LibreOffice, облачный ConvertAPI — функции |
| `desktop.py` | открыть файл/папку на компьютере-сервере (`DesktopError`) |
| `defaults.py` | умолчания администратора (kv `settings.defaults`) — функции |
| `lists.py` | `ListStore` — «Списки и выборы» (kv `settings.lists`) |
| `user_prefs.py` | `UserPrefs` — личные настройки менеджера (kv `userPrefs`), `GET/PUT /api/me/prefs` |
| `settings_history.py` | `SettingsHistory` — история изменений настроек с откатом (без паролей и ключей) |
| `data_bundle.py` | `DataBundle`, `ProgramSettings` — выгрузка/загрузка JSON + изображения архивом |
| `catalog_patch.py` | `CatalogPatch` — правки каталога файлом (`kp-catalog-patch`): только перечисленные поля, конфликты, копия базы перед записью |
| `connections.py` | `ConnectionCheck` — «Проверить все подключения» |
| `maintenance.py` | `DbCopy` (ежедневные копии ZIP), `Background` (фоновые задачи), архив журнала, VACUUM, лишние изображения |
| `backup_mirror.py` | `MirrorBackup` — копии во вторую папку |
| `app_update.py` | `UpdatePackage`, `ReleaseSource`, `Updater`, `Restarter`, `StartCheck`, `NightUpdate`, `UpdateError` |
| `server_log.py` | `ServerLog` — `data/logs/kp.log`, перехват вывода |
| `server_task.py` | `ServerTask` — задача Планировщика сервера отдела (без лимита 72 ч, от батареи) |
| `version.py` | `VERSION`, `as_tuple` |

## 4. Клиент (`app/web`)
Каркас: `index.html` (все js/css подключаются по порядку, проверяет `test_project`), `js/boot.js` (тема и телефон до отрисовки), `js/main.js` (запуск).
Ядро `js/core`: `api.js` (`api()`, подпись пользователя, `X-CSRF-Token`, 409 → `conflictAsk`; `SRV`, `ADMIN`, `ImgUpload`), `state.js` (состояние КП `S`,
`S.items`, `S.deal`, черновик в браузере), `util.js` (`$`, `esc`, `norm`, `toast`, `morph`; `money` — из `KPGen`), `types.js`, `defaults.js` (`DEF()`), `features.js` (`FEAT.on`),
`lists.js` (`LISTS`), `xlsx.js` (Excel на JSZip). `js/ui`: `form.js` (`STEPS`, `StepList`, `Popups`), `events.js` (кнопки `data-a`), `sidebar.js`
(`SidePanel`), `datepicker.js` (`DP`, `WCAL`), `geo-input.js` (`GEO`), `mobile.js`. Шаги КП `js/ui/steps`: client (1, `TenderBlock`), equipment (2),
pricing (3), cover (4 «Оформление КП»), conditions (5, `CondsStep`), manager (6). Окна — класс `Modal` (`kp-track.js`). CSS — `app/web/css/*.css` по разделам;
`vendor/` — jszip, docx-preview, шрифт Onest; `fonts/` — osifont (чертежи).

`js/features/*` по разделам:
| Раздел | Файл → главные классы → назначение |
|---|---|
| КП и документ | `docx/kpgen.js` → `KPGen` → деньги, сумма прописью, загрузка `skeleton.js`; `docx/build.js` → `KpModels`, `DocxSettings` → сборка DOCX в браузере и `PUT /api/kp/<id>/docx`; `preview.js` → `PreviewDocx` → предпросмотр, PDF; `pricing.js` → `PriceHist` → валюта, курсы ЦБ, цены, скидки |
| Редактор позиции | `item-editor.js` → `ED_TABS` → карточка позиции с вкладками; `images.js` → слоты фото/схем; `ai-autofill.js` → `AiFill` → «Заполнить с ИИ»; `equip-wizard.js` → `NW` → мастер «Добавить оборудование»; `types-editor.js` → `TY` → категории оборудования |
| Каталог | `catalog.js` → `CatSrv`; `catalog-window.js` → `CatalogWindow`, `CatalogIndex`, `CatalogFilter`, `CatalogSorter`, `CatalogPanes` → окно каталога; `catalog-edit.js` → правка позиции каталога; `catalog-cache.js` → `CatalogCache` (IndexedDB), `CatalogSearch`; `excel-import.js` → импорт Excel/CSV |
| Клиенты, менеджеры | `clients.js` → `PartyCheck`, `ApiKeys` → ИНН, справочник, проверка, ключи API; `clients-import.js` → загрузка списком ИНН; `client-card.js` → `ClientCard`; `managers.js` → `MgrBar`; `auth.js` → `AUTH` → вход менеджеров |
| Экономика сделки, логистика | `deal.js` → `DealHs`, `DealSide` → окно «Экономика сделки» (`S.deal`); `deal-calc.js` → `DealCalculator` → расчёт без интерфейса; `deal-xlsx.js` → Excel для согласования; `logistics.js` → `FreightSettings`, `FreightFacts` → вкладка «Логистика» и тарифы; `logistics-calc.js` → `Freight` → расчёт доставки; `tnved.js` → `TnVed` → коды ТН ВЭД и пошлины |
| Журнал, Мой день, черновики | `journal.js` → `JournalRow`; `kp-track.js` → `KpTrack`, `Reminders`, `KpLoader`, `KpDate`, `MailDlg`, `Modal` → ход сделки, напоминания, письмо; `kp-drafts.js` → `Drafts`, `Presets`, `NewKp`; `kp-saved.js` → `KpSaved`; `kp-report.js` → `KpReport`, `KpDiff`; `my-day.js` → `MyDay`; `my-prefs.js` → `MyPrefs` |
| Настройки (админка) | `settings.js` → `AdminNav`, `DbMaint` → разделы Обзор/КП/Каталог/Справочники/Программа/Подключения/Доступ/Обслуживание; `settings-tools.js` → `SettingsSearch`, `StDirty`, `SettingsHistoryPanel`, `ConnectionsPanel`, `AlertsCard`, `MirrorCard`; `settings-system.js` → `AdminSystem` (обновления, система); `settings-data.js` → `DataTransfer`; `settings-defaults.js`; `settings-dir.js` (менеджеры, клиенты, поставщики); `settings-feeds.js` (фиды); `settings-lists.js` → `ListsPanel`, `TextsPanel`, `FeaturesPanel`; `uitexts.js` → `UIT` |
| Шаблоны КП | `templates.js` → `TPL_CACHE` → выбор и загрузка шаблона; `template-editor.js` → `TE` → форма по `editor.json`; `template-designer.js` → `TD` → графический редактор «как в Word» |
| Станции: состав и подбор | `kit.js` → `StationSpec`, `KitPart`, `KitPipe`, `KitCabinet`, `StationDefaults` → сборка (`x.kit.parts`); `kit-view.js` → `KitView`, `KitScope`, `StationReq`, `SupplyDocs`, `KitNeed` (чего не хватает к компрессорам, фильтры окна каталога, «Подобрать всё недостающее») → «Состав станции»; `station-quick.js` → `StationQuick` → «Подбор станции» одной кнопкой; `station-fix.js` → `ExpertFix` (режим «эксперт»: замечания по разделам, «Как решить», «Решить автоматически») |
| Станции: компоновка, системы | `station-layout.js` → `StationLayout`, `StationGeo`, `AirChain`, `StationNorms`, `StationHeat`, `RalColor` → расстановка в контейнере, подбор контейнера; `station-systems.js` → `StationFire`, `StationLight`, `StationSockets`, `StationPower`, `StationPipe`, `StationVent`, `StationMass` → системы контейнера; `station-ui.js` → `StationUi`, `StationSize`, `StationImages` → вкладка «Компоновка», картинки для КП |
| Станции: чертёж ЕСКД | `station-eskd.js` → `EskdSheet`, `EquipIcon`, `PneuSymbol`, `HydroScheme`, `StationScheme` → лист А4, основная надпись, схемы; `station-draw.js` → `StSvg`, `StationDrawing`, `StationView3D` → габаритный чертёж в SVG |
| Станции: 3D | `station-render.js` → `StScene`, `StGl`, `StCam`, `StationRender` → реалистичный 3D-вид (главное фото); `station-outfit.js` → `StOutfit` → оснащение (свет, отопление, жалюзи, маркизы); `station-decal.js` → `StDecal`, `PhotoTint` → наклейки, цвет |
| Станции: расчётная записка | `station-calc.js` → `StationCalc` (+ `AirDemand`, `PressureBudget`, `DryerSizing`, `FilterSizing`, `ReceiverSizing`, `VentSizing`, `ElectricLoad`, `GensetSizing`) → расчёт по правилам, приложение к КП (`docGroups`); `station-rules.js` → `StationRules` (из `/api/rules/stations.js`); `station-rules-doc.js` → `StationRulesDoc`, `RulesPanel` |
| ТЗ заказчика / ТЗ на сборку | `tz-import.js` → `TzImport`, `TzQuestions`, `TzPick` → ТЗ файлом (`/api/tz/parse`) → требования и подбор; `tz-out.js` → `TzOut` → ТЗ на сборку для сборщика контейнера; `docx-writer.js` → `DocxWriter` → Word без шаблона |
| Справка | `help.js` → `APP_VERSIONS`, `HELP_SECTIONS` → руководство и история версий |

## 5. Данные
База `data/kp.sqlite3` (`storage.Store`; JSON-документы в столбце `doc`/`state` + служебные столбцы для поиска):
| Таблица | Что хранит |
|---|---|
| `catalog`, `catalog_gone` | позиции каталога: `doc` (полная карточка), `light` (облегчённая для списка), `rev`, `seq`, `search`; удалённые id для докачки |
| `kp`, `kp_versions`, `counters` | КП: `state` (состояние `S`), `meta`, путь к `docx`, клиент/ИНН/менеджер, `rev`, `track`/`status`/`follow` (ход сделки); 30 прежних версий; нумерация по годам |
| `clients`, `checks` | контрагенты (объекты, контакты, `rev`); кэш проверок по ИНН |
| `managers`, `suppliers`, `customs` | справочник менеджеров; поставщики (условия, реквизиты, склады, контакты, производители); коды ТН ВЭД и пошлины (`cat:<тип>`, `item:<id>`) |
| `drafts` | черновики и заготовки КП (`kind` draft/preset, владелец) |
| `audit`, `trash`, `pending_edits`, `settings_history` | журнал действий; корзина (30 дней); правки каталога на модерации; история настроек |
| `kv` | ключ → JSON (ниже) |

Главные ключи `kv`: `settings` (`features`, `defaults`, `lists`, `userLogin`, `ai`, `backup2`, `productEditModeration`…); `integrations` — **ключи API**
(только в базе на компьютере отдела, в браузер — маской, не в EXE, журналы и историю; имена полей — `RepoGuard.KEY_NAMES`; резервная копия —
`GET /api/integrations/export`, шифрует браузер паролем); `admins`, `adminSessions` (хеши), `mgrAccess`, `userSessions`; `userPrefs`; `mail` (SMTP);
`logistics`, `logisticsAuto`, `lgdict:*`, `georoute`; `feeds`, `feedlog:*`; `uitexts`; `types` (свои категории); `stationRules`, `stationRulesPrev`;
`schema` (применённые миграции); `maint`, `alerts`, `serverTask`, `update`; `checkoQuota`, `ofdataQuota`, `checkQueue`; `workcal:<год>`, `cbr_last`, `aiUsage`, `catepoch`.

Не в репозитории (`.gitignore`, `repo_guard.py`): `*.sqlite3` (+ `-wal`/`-shm`), выгрузки `kp*.zip`, `integrations.json`, файлы ключей, `app/data`,
`app/settings.json`, `backup/`. Готовые КП и фото — только на сервере отдела.

- **Миграции** — `MIGRATIONS` в `app/storage.py`: `(id, up, down)`, только добавляют таблицы/столбцы; `migrations_up` выполняет миграцию и отметку
  в kv `schema` одной транзакцией (`_atomic_script`); `MIGRATION_FILL` заполняет новые столбцы из документов. 11 миграций: `2026-10-admin`, `2026-11-deal`,
  `2026-12-customs-name`, `2026-12-kp-versions`, `2027-01-db` (rev, поиск), `2027-02-light`, `2027-03-track`, `2027-04-drafts`, `2027-05-settings-history`,
  `2027-06-light-slim`, `2027-07-catalog-sync`. Рабочую базу вручную не править.
- **Типы оборудования** — `app/equipment_types.json` (параметры, фильтры, титул, `find`, `folder`, `station`) + свои в kv `types`.
- **Шаблоны КП** — `templates/pnevmotekh`, `templates/tender`: `template.json` (оформление), `skeleton.js` (раскладка), `editor.json` (форма
  редактора), `base.docx` (стили Word), картинки; история — `_history`. Описание — `templates/README.txt`.
- **Правила станций** — `app/web/rules/stations.json`: `format: kp-station-rules`, `version` (сейчас `2026.10.12-6`), `date`, `statuses`, `rules`
  (71 правило: `id` вида `группа.имя` — heat, flow, dgu, el, dryer, air, norm, loss…; `value`, `unit`, `source {doc, item, url}`, `status`),
  `series` (11 — данные производителей: поправки осушителей и фильтров, продувка). Статусы: `confirmed` — подтверждено источником (21),
  `practice` — отраслевая практика (23), `unconfirmed` — требует подтверждения (27). Своя версия администратора — kv `stationRules` (прежняя —
  `stationRulesPrev`), проверка — `station_rules.StationRules`; в браузер — `/api/rules/stations.js`; тест — `tests/test_station_rules.py`.

## 6. Сквозные механизмы
- **Версия:** `app/version.py` (`VERSION`) + `let APP_VERSION` и первая запись `APP_VERSIONS` (`[версия, дата, [пункты]]`) в `help.js` (сверяет
  `test_project.test_version_everywhere`) + раздел в `README.md` + `Инструкция.txt`. `kp.spec` берёт версию для свойств EXE; `/api/version` — версия
  и признак патча. Коммит — `3.x.y: что сделано` + список.
- **Совместная правка:** у `kp`, `catalog`, `clients`, `managers`, `suppliers` — `rev`. Клиент шлёт `X-KP-Rev` (`core/api.js`), `Store` при чужой
  правке бросает `Conflict` → `Handler` отвечает 409 с данными правки → `conflictAsk` спрашивает «перезаписать?» и повторяет с новым rev
  (прежний вариант КП остаётся в `kp_versions`). Справочники отдаются с ETag; каталог — докачкой по `seq`/`epoch` (`CatalogSync`, `CatalogCache`).
- **Админ-сессия и CSRF:** `admin.py` — учётки в kv `admins` (scrypt, иначе PBKDF2), cookie `kp_admin` (HttpOnly, SameSite=Strict) + токен в
  `X-CSRF-Token`; `admin.is_admin(h, need_csrf=True)`; 15 мин бездействия; 5 неверных паролей за 10 мин — пауза; первая учётка — только с самого
  компьютера; сброс — файл `data/admin-reset.txt`. `admin.guard` — права, модерация, журнал до маршрутизации. Менеджеры: без входа — подпись
  `X-KP-User-Id`/`X-KP-User`, со входом — `auth_users` (cookie `kp_user`, права «каталог, чужие КП, экономика»).
- **Защита HTTP** (`kp_server.Handler`): проверка Host (`allowedHosts`, подмена DNS), отказ запросам с Origin чужого сайта, `MAX_BODY` 300 МБ, CSP
  (встроенные скрипты запрещены — потому `boot.js`). SQL — только `?`, `LIKE` — `like_arg`; HTML — `esc()`; пути — `safe_id`/`safe_file`.
- **Доступ к функциям:** `features.FEATURES` (24 ключа: tender, stations, stLayout, check, ai, deal, carriers, track, mail, report, myDay, drafts…),
  kv `settings.features` = `{on, who: all|admin|users, users}`; `ROUTES` закрывают адреса (403); клиент — `FEAT.on(ключ)`, панель `FeaturesPanel`.
- **Тексты интерфейса:** kv `uitexts` `{исходный: новый}`, `/api/uitexts`; клиент `UIT` подменяет тексты после перерисовки (MutationObserver);
  режим правки «⋯ → ✎ Тексты интерфейса» (администратор), панель `TextsPanel`.
- **Умолчания и списки:** `defaults.py` (kv `settings.defaults` = `{ключ: {on, v}}`) ↔ `core/defaults.js` `DEF()`, «Настройки → Умолчания»;
  личные значения менеджера поверх — `UserPrefs`/`MyPrefs`. Списки выборов — `lists.ListStore` ↔ `core/lists.js` `LISTS`. Изменения настроек —
  `SettingsHistory` (откат по полям).
- **Внешние API** (ключи — в kv `integrations`, вводятся в «Настройки → Подключения → Ключи API»):
  | Сервис | Где в коде |
  |---|---|
  | ЦБ РФ: курсы, ключевая ставка (cbr.ru, резерв cbr-xml-daily.ru) | `cbr.py`, `/api/cbr`, `/api/cbr/keyrate`; клиент `pricing.js`, `deal-calc.js` |
  | Производственный календарь (isdayoff.ru, резерв xmlcalendar.ru) | `workcal.py`, `/api/calendar`; клиент `ui/datepicker.js` (`WCAL`), график платежей |
  | DaData, ФНС ЕГРЮЛ, Checko, OFData, ГИР БО, Rusprofile (ссылкой) | `counterparty.py`, `/api/party`, `/api/check`; клиент `clients.js`, `clients-import.js` |
  | Перевозчики: ATI.SU, ПЭК, Деловые Линии, КИТ, СДЭК, Возовоз, Энергия | `logistics_api.py`, `/api/logistics/quote`; клиент `logistics.js` |
  | Адреса и маршруты: DaData, OpenStreetMap Nominatim, OSRM | `geo.py`, `/api/geo/*`; клиент `ui/geo-input.js` |
  | ИИ: DeepSeek / OpenAI-совместимый API (или любой чат копированием) | `ai_llm.py`, `ai_profile.py`, `/api/ai/*`; клиент `ai-autofill.js` |
  | PDF: Word / LibreOffice / ConvertAPI | `pdf_convert.py`, `/api/pdf` |
  | Почта SMTP | `kp_track.Mailer`, `admin_alerts.AdminAlerts` |
  | GitHub Releases (обновления) | `app_update.ReleaseSource`; проверка подключений — `connections.ConnectionCheck` |
  | Фиды поставщиков (YML, страницы сайтов) | `feeds.py`, `feed_files.py`; клиент `settings-feeds.js` |

## 7. Хронология
- **1.0–1.4** (27.09–01.10.2026) — КП на Python одним EXE с браузером; SQLite, типы оборудования, шаблоны КП, сервер отдела; скидка, темы, загрузка клиентов по ИНН; справочник менеджеров, предпросмотр, PDF.
- **2.0** (02.10) — админ-панель «Настройки»: корзина, модерация правок каталога, журнал действий, копии, статистика.
- **2.1–3.5** (02–03.10) — «Экономика сделки» по методике: себестоимость, таможня, НДС, этапы оплат, ключевая ставка, Excel; рабочие дни по производственному календарю (3.0), несколько администраторов, история версий КП, руководство «?»; условия КП из экономики (3.5).
- **3.6–3.8.2** (03.10) — графический редактор шаблона КП, защита от чужих сайтов (3.6.1), график платежей перетаскиванием, компактный интерфейс.
- **3.9–3.15.3** (04–05.10) — совместная правка (rev, 409); лимит Checko на отдел; доставка по России, цены перевозчиков по API, «дверь — дверь», точные адреса и маршруты, страхование, НДС с разбивкой.
- **3.16.x, 3.25–3.34.x** (05–08.10) — фиды поставщиков: YML (Remeza), фид из файлов (парс сайта + прайсы + остатки), сетка скидок, описания блоками, логотипы.
- **3.17–3.22** (06.10) — сборки: изделие из нескольких единиц (состав), мастер «Добавить оборудование», сборка станции в экономике сделки, нейросеть DeepSeek в программе (3.22).
- **3.23–3.24.x** (06–07.10) — «Умолчания», остановка сервера отдела одним файлом, понятные ошибки перевозчиков.
- **3.35–3.36.x** (08.10) — поиск и сортировка каталога, КП для тендера (шаблон «Тендерный»).
- **3.37–3.42.x** (09.10) — «Списки и выборы», переход сервера и клиента на классы (3.38, 3.42.1), безопасность сохранения DOCX, ход сделки и почта (3.40), «Функции программы» (3.41), «Мой день», черновики и заготовки (3.42).
- **3.43–3.48.1** (09–10.10) — профиль ИИ по каталогу, «Настройки» в 8 разделах, обновления с GitHub из «Настроек» (3.45), лёгкий EXE ~10 МБ (3.46), поиск и история настроек (3.47), каталог 20 000+ и личные настройки (3.48), полный прогон на копии базы.
- **3.49–3.53** (10.10) — проверка документа КП на 24 вариантах, резерв OFData, копии базы в ZIP и откат неудачного обновления (3.51), задача Планировщика без 72 ч, журнал сервера, письма администратору, ночные обновления, `tests/` в CI (3.52), упрощение интерфейса (3.53).
- **3.54–3.64** (11.10) — станции в контейнере: компоновка (3.54), режим сервисных дверей (3.55), реалистичный 3D (3.56), цепочка сжатого воздуха (3.57), чертёж по ЕСКД (3.58–3.59), требования заказчика, ТЗ файлом и ТЗ на сборку (3.60), детали 3D, отопление, отсек бака ДГУ (3.61), пожарная безопасность, освещение и электропитание по расчёту (3.62), двери (3.63), фильтры по данным производителей, 3D на любой вкладке (3.64).
- **3.65–3.74** (12.10) — конструктор модульных станций: расчёт с правилами и источниками, расчётная записка (3.65), «Подбор станции» в одно действие (3.66), проход оператора всегда, жалюзи по расходу воздуха (3.67), двери, приток/выброс, рекуперация (3.68), приток без лишнего разбиения (3.69), маркизы-козырьки (3.70), состав компрессорной: «Нужно: …», фильтры каталога по нужному, «Подобрать всё недостающее» (3.71), ресиверы по 900 л АСО и «Нужно…» для ДГУ и насосных (3.72), безмасляные по отрасли, компоновка в габарит перевозки — проход 500 мм и агрегат поперёк как исключения (3.73).; контрольные поля номенклатуры (безмасляный, встроенные фильтры, пылевой после адсорбционного) и правки каталога файлом (3.74)
- **3.75–3.78** (12–13.10) — станции: матрица расстановки и ворота (3.75), расчёт вентиляции `VentCalc` и «эксперт» (3.76), сбалансированная вентиляция (3.77); исправления по аудиту (3.78): проверка ввода `ReqNum`, насосы `PumpSizing` (NPSH), ДГУ `GensetSizing.cap/kva`, ворота по оси торца, `ExpertLog` (вручную / по правилам, журнал), правила станций в истории настроек, `StationPurpose` и `StationAutoVal` (описание), `StationImages.issues` (изображения до сохранения), масса брутто и стропы `StationMass.max/wll`.
- **3.79** (13.10) — ресиверы по методике ПНЕВМОТЕХ (`ReceiverPlan`: приоритеты 1–3, ряд 900/500, мокрый и локальный, шесть проверок, ввод в «Ресиверы — исходные данные и расчёт»), «на чертеже» у замечаний (`IssueSpot`).
- **3.84** (13.10) — ресиверы: наименьшее допустимое число, мокрый при пиках (`ReceiverPlan`); проёмы: `door.gap/edge`, `StationLayout.gaps/inWall/openings`; осушитель по габаритам — `TzPick.fitsW/wmax`, `KitNeed.dryerFit`; чертёж — `StationDrawing.FLD/ROT/page/best`, листы без лимита, `.stl-sheets` в полный размер.
- **3.83.1** (13.10) — осушителям и ресиверам без сервисных дверей (`NO_DOOR`, `toGate`), высота ворот в торцах — по самому высокому оборудованию (`gateFor`, `regate`).
- **3.83** (13.10) — компрессорная без продольного прохода (`StationLayout` режим `ends`: `rowE`, `endsExits`, `entrySpan`, `gateFor`; кандидат в `autoSize` в ширине 2 550 мм, `ENDS_K`); дверь оператора между компрессором и осушителем, ворота в обоих торцах, ресиверы парами плотнее.
- **3.82** (13.10) — выброс: не в створках ворот; над воротами → торец у компрессора (без ворот) → все через крышу одного размера (`StationVent.calc0`: `side`, `atEnd`, `viaRoof`); система «Вытяжные вентиляторы» (`exfan`, правило `vent.exfan`, `VentCalc.summer`), приточные вентиляторы (`V.infan`), `StOutfit.fan`, `StationDrawing.fanEnd`.
- **3.81** (13.10) — скорость у менеджеров: 3D без блокировки (`StGl.idle`, `StationRender.jpeg`), разбор карточек каталога один раз (`CatAttrs`, types.js), окно подбора (`PickFind`: строка поиска, сортировка, задержка ввода, ленивые фото), черновик в браузере без перезаписи картинок (`LocalDraft`, state.js).
- **3.80** (13.10) — выброс над сервисными воротами и одинаковые решётки (`StationVent.calc0`), режим «эксперт» с решениями (`ExpertFix`, station-fix.js), ресиверы в два ряда в конце ряда (`StationLayout.endPairs`), пересчёт ресиверов по вводу (`ReceiverSync`), вид адсорбционного осушителя (`twinDryer`).
