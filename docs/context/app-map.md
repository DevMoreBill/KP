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
  (`eslint.config.mjs`, правило необъявленных имён по всем файлам), `tests/run_all.py --no-static --strict`. Job `build` (только запуск вручную или метка `v*` — по команде владельца, 17.10; windows-latest,
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
| Редактор позиции | `item-editor.js` → `ED_TABS` → карточка позиции с вкладками; `images.js` → слоты фото/схем; `ai-autofill.js` → `AiFill` → «Заполнить с ИИ»; `equip-wizard.js` → `NW` → мастер «Добавить оборудование», `NewStation` — станция: «что нужно заказчику» → «Подобрать станцию»; `types-editor.js` → `TY` → категории оборудования |
| Каталог | `catalog.js` → `CatSrv`; `catalog-window.js` → `CatalogWindow`, `CatalogIndex`, `CatalogFilter`, `CatalogSorter`, `CatalogPanes` → окно каталога; `catalog-edit.js` → правка позиции каталога; `catalog-cache.js` → `CatalogCache` (IndexedDB), `CatalogSearch`; `excel-import.js` → импорт Excel/CSV |
| Клиенты, менеджеры | `clients.js` → `PartyCheck`, `ApiKeys` → ИНН, справочник, проверка, ключи API; `clients-import.js` → загрузка списком ИНН; `client-card.js` → `ClientCard`; `managers.js` → `MgrBar`; `auth.js` → `AUTH` → вход менеджеров |
| Экономика сделки, логистика | `deal.js` → `DealHs`, `DealSide` → окно «Экономика сделки» (`S.deal`); `deal-calc.js` → `DealCalculator` → расчёт без интерфейса; `deal-xlsx.js` → Excel для согласования; `logistics.js` → `FreightSettings`, `FreightFacts` → вкладка «Логистика» и тарифы; `logistics-calc.js` → `Freight` → расчёт доставки; `tnved.js` → `TnVed` → коды ТН ВЭД и пошлины |
| Кабинет менеджера (сделки, дела) | `cabinet.js` → `Cabinet`, `CrmData`, `CrmTask`, `CabToday`, `CabClients`, `CabTeam`; `cabinet-board.js` → `CabDeals`, `CabGantt`; `deal-card.js` → `DealCard`, `DealPick`; сервер `crm.py` |
| Журнал, Мой день, черновики | `journal.js` → `JournalRow`; `kp-track.js` → `KpTrack`, `Reminders`, `KpLoader`, `KpDate`, `MailDlg`, `Modal` → ход сделки, напоминания, письмо; `kp-drafts.js` → `Drafts`, `Presets`, `NewKp`; `kp-saved.js` → `KpSaved`; `kp-report.js` → `KpReport`, `KpDiff`; `my-day.js` → `MyDay`; `my-prefs.js` → `MyPrefs` |
| Настройки (админка) | `settings.js` → `AdminNav` (Обзор + 4 раздела: Каталог, Документы и справочники, Настройки программы, Сотрудники и система), `ModerationTab`, `AccessPanel`, `DbMaint`; `catalog-admin.js` → `GoodsTab`, `TrashTab`, `ModerationView`, `ModerationList`, `CatalogExportDlg`, `CatalogBin`; `settings-data.js` → `BackupTab`, `SettingsFileCard`; `settings-tools.js` → `SettingsSearch`, `StDirty`, `SettingsHistoryPanel`, `ConnectionsPanel`, `AlertsCard`, `MirrorCard`; `settings-system.js` → `AdminSystem` (обновления, система); `settings-data.js` → `DataTransfer`; `settings-defaults.js`; `settings-dir.js` (менеджеры, клиенты, поставщики); `settings-feeds.js` (фиды); `settings-lists.js` → `ListsPanel`, `TextsPanel`, `FeaturesPanel`; `uitexts.js` → `UIT` |
| Шаблоны КП | `templates.js` → `TPL_CACHE` → выбор и загрузка шаблона; `template-editor.js` → `TE` → форма по `editor.json`; `template-designer.js` → `TD` → графический редактор «как в Word» |
| Станции: состав и подбор | `kit.js` → `StationSpec`, `KitPart`, `KitPipe`, `KitCabinet`, `StationDefaults` → сборка (`x.kit.parts`); `kit-view.js` → `KitView`, `KitScope`, `StationReq`, `SupplyDocs`, `KitNeed` (чего не хватает к компрессорам, фильтры окна каталога, «Подобрать всё недостающее») → «Состав станции»; `station-quick.js` → `StationQuick` → «Подбор станции» одной кнопкой; `station-fix.js` → `ExpertFix` (режим «эксперт»: замечания по разделам, «Как решить», «Решить автоматически») |
| Станции: компоновка, системы | `layout/*.js` (ES-модули, `layout/index.js` — мост) → `StationLayout` (+ `LayoutRows`, `LayoutDgu`, `LayoutTank`, `LayoutJoints`, `LayoutWalls`, `LayoutGates`, `LayoutExits`, `LayoutAccess`, `LayoutSize`, `LayoutRoof`, `LayoutMode`, `LayoutNotes`), `StationGeo`, `AirChain`, `StationNorms`, `StationHeat`, `RalColor` → расстановка в контейнере, подбор контейнера; `layout/*.js` → `StationFire`, `StationLight`, `StationSockets`, `StationPower`, `StationPipe`, `StationJoints`, `StationMass`, `StWalls`, `VentCalc`, `VentGrille`, `VentPlan`, `VentIntake`, `StationVent` → системы контейнера; `station-ui.js` → `StationUi`, `StationSize`, `StationImages` → вкладка «Компоновка», картинки для КП |
| Станции: чертёж ЕСКД | `eskd/*.js` (ES-модули, `eskd/index.js` — мост) → `EskdSheet` (+ `EskdFrame`), `EquipIcon` (+ `IconParts`, `IconAir`, `IconUnits`), `PneuSymbol`, `HydroScheme`, `StationScheme` (+ `SchemeLayout`, `SchemeUnits`) → лист А4, основная надпись, схемы; `draw/*.js` (ES-модули, `draw/index.js` — мост) → `StationDrawing` (+ `DrawText`, `DrawSheets`, `DrawSide`, `DrawPlan`, `DrawEnds`, `DrawSling`), `StationView3D` (+ `View3dUnits`, `StView`, `StSvg`) → габаритный чертёж в SVG |
| Станции: 3D | `view/*.js` → `StScene` (+ `SceneHull`, `SceneRoom`, `SceneAir`, `SceneUnits`, `ScenePipes`), `StMesh`, `StGl`, `StCam`, `StationRender` → реалистичный 3D-вид (главное фото); `view/*.js` → `StOutfit` (+ `Outfit*`) → оснащение (свет, отопление, жалюзи, маркизы), `StDecal`, `PhotoTint` → наклейки, цвет |
| Станции: расчётная записка | `calc/*.js` (ES-модули, `calc/index.js` — мост) → `StationCalc` (+ `AirDemand`, `PressureBudget`, `DryerSizing`, `FilterSizing`, `ReceiverSizing`, `VentSizing`, `ElectricLoad`, `GensetSizing`) → расчёт по правилам, приложение к КП (`docGroups`); `rules/` (ES-модуль) → `StationRules` (из `/api/rules/stations.js`, модулем после `rules/index.js`); `rules-doc/` (ES-модули, по требованию через `LazyJs` → `import()`) → `StationRulesDoc`, `LayoutEditor` + `LayoutForm` (правила компоновки), `RuleEdit` (правка любого правила), `RulesPanel`; `layout/layout-params.js` → `LayoutParams` (поля и пределы), `LayoutDigest` (свод) |
| ТЗ заказчика / ТЗ на сборку | `tz/` (ES-модули) → `TzImport`, `TzQuestions`, `TzPick`, `TzFit` (подбор «чтобы поместилось»), `StationSup` → ТЗ файлом (`/api/tz/parse`) → требования и подбор; `tz-out/` (ES-модули, по требованию) → `TzOut`, `TzText` (разделы), `TzContainer`, `TzDoors`, `TzSystems` → ТЗ на сборку для сборщика контейнера; `docx-writer.js` → `DocxWriter` → Word без шаблона |
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
- **3.85** (13.10) — свод правил компоновки (`LayoutDigest`), все числа — `layout.matrix` (`LayoutParams`, сервер `LayoutValues.SCALAR`), плотный подбор размера (`fit.dense`, уровни gate/acc), негабарит — warn или запрет (`fit.wide`); «Настройки»: `LayoutEditor`, `RuleEdit` (+ `RuleShape` на сервере); окно новой станции — `NewStation` (equip-wizard.js).
- **3.86** (13.10) — предпросмотр новой станции (`NewStation.preview`), наборы правил (`LayoutParams.PRESETS`), подтверждённые значения проёмов/ворот/ресиверов; по прогону на копии базы: `TzPick.dguOk/dguPen` (ДГУ 400/230 В, открытое исполнение), компоновка без сервисных ворот раньше прохода шире допустимого.
- **3.83.1** (13.10) — осушителям и ресиверам без сервисных дверей (`NO_DOOR`, `toGate`), высота ворот в торцах — по самому высокому оборудованию (`gateFor`, `regate`).
- **3.83** (13.10) — компрессорная без продольного прохода (`StationLayout` режим `ends`: `rowE`, `endsExits`, `entrySpan`, `gateFor`; кандидат в `autoSize` в ширине 2 550 мм, `ENDS_K`); дверь оператора между компрессором и осушителем, ворота в обоих торцах, ресиверы парами плотнее.
- **3.86.10** (13.10) — `StationRules.stamp()` в отпечатке станции (правки правил доходят до станций), пара ресиверов у торца по правилу, `gate.minH/top`; `MakerLogos` + `MakerLogoPanel` (логотипы производителей в «Фидах»).
- **3.86.11** (13.10) — `TzPick.fit` (несколько одинаковых компактных, ресиверы снаружи, негабарит последним), `StationQuick.auto` (автопереподбор при смене расхода/давления), `StationGeo.len` + `geo.fixL` + `StationLayout.density` (заданная длина и плотность), «Правила компоновки»: сброс из файла поставки (`layoutDef`), наборы сразу, `render(false)`, `LayoutEditor.mark`.
- **3.86.12** (13.10) — прогон по каталогу: `autoSize` монотонен по отступам («не подойти» → длиннее), вертикальный ресивер в `StationEquip.dims`, без дизельных в `compact`.
- **3.87** (14.10) — `station-doc.js`: `StationDesign` («Устройство станции»), `StationDoc` (карточки основных агрегатов, ключевые строки, габариты/масса станции), `StationBrief` (описание станции ИИ во вкладке «Описание и фото»); записка в КП — только `stLayout.calc`; замечания — `.stl-isb` вверху «Компоновки», `StationUi.badge`; формы `.kr-g` выровнены.
- **3.88** (14.10) — ревью и ускорение: `WebIndex` + `FileGzip` (метки версий файлов, год кэша, сжатие один раз), `CatFind`/`QuickFind` (каталог), `PropList` (feeds), `AtiDirections`, `Carrier` (логистика), `KpJournal` (admin), кэши `StationMatrix`, `autoSize.fitAt`, `EskdSheet.tw`; размер контейнера = чертёж.
- **3.89** (14.10) — «Значения программы»: `DefRegistry` + `DefaultsTab`, сервер `defaults.SrvVal`/`defaults-srv.js`, `DealValues`, `LgValues`, `LtlLimits`; правила станций дополнены (shell, pick, pipe, pumps, grille, mass, light, power, fire), `StationRules.complete`; ресиверы внутри (`TzPick.fit`, `recv.upright`, `recv.close`); `LgCargoIn` (мм/кг), `LgMoney` (валюта своей суммы).
- **3.89.1** (14.10) — «Настройки» по задачам: `AdminNav.GROUPS` (9 разделов, `desc`), вкладка «Что где» (`AdminNav.home`), `AdminNav.path`; разгрузка по умолчанию — заказчик (`LgValues.unload`, `techs`).
- **3.90.0** (14.10) — перевозчики: включение и адреса API в «Настройках» (`CarrierApi`, kv `carrierApi`, `/api/logistics/carriers`, клиент `CarrierApis`), переход по 307 (`_call`), скрытие токенов в ошибках (`_hide`), выпуск через страницу GitHub (`ReleaseSource._latest_web`).
- **3.91.0** (14.10) — доставка из Китая до границы РФ, только админка (`china_freight.ChinaFreight`, kv `chinaRates`, `/api/logistics/china`, клиент `ChinaFreightTab`): ATI.SU по направлениям из Китая + ставки экспедиторов в валюте по курсу ЦБ.
- **3.92.0** (16.10) — ЖелДорЭкспедиция (`logistics_api.Jde`): открытый расчёт без ключа, сборный и крупногабаритный груз (до 20 т, надбавка за негабарит по размерам места), забор и доставка; крупногабарит — только ЖДЭ из сборных.
- **3.93.0** (16.10) — справочные документы к КП (`kp_files.KpFiles`, таблица `kp_files`, `data/kp_files`, клиент `KpFilesPanel`, вложения письма) и окно входа (`LoginGuard`, `UserSession`, `LoginInfo`, `LoginForm`, `AuthScreen`, `AdminLogin`).
- **3.149.0** (20.10) — чистый код, ч. 14: имена `feeds`, `feed_files`; все 62 модуля в `names`.
- **3.148.0** (20.10) — чистый код, ч. 13: имена `admin` (`AdminApi.handler/store/user`); 59 из 62.
- **3.147.0** (20.10) — чистый код, ч. 12: имена `bitrix` (`BitrixConf.enabled`, `BitrixSync.rules`); 58 из 62.
- **3.146.0** (20.10) — чистый код, ч. 11: имена `storage`, `web_api` (`Controller.handler/method/url_path/query`); 57 из 62.
- **3.145.0** (20.10) — чистый код, ч. 10: имена `catalog_admin`, `logistics_api` (`Carrier.CODE`, `CarrierApi.enabled`); 55 из 62.
- **3.144.0** (20.10) — чистый код, ч. 9: имена `pdf_text`, `tz_parse`, `crm` (52 из 62 в `names`).
- **3.143.0** (20.10) — чистый код, ч. 8: имена сервера, ещё 18 модулей (49 из 62 в `names`).
- **3.142.0** (20.10) — чистый код, ч. 7: имена сервера, проверка `tests/test_names.py` (`names` в `tests/code_style.json`), 31 модуль.
- **3.141.0** (20.10) — чистый код, ч. 6: `layout/` — JSDoc у открытых методов, служебные — `_метод`, папка в CLEAN ESLint.
- **3.140.0** (20.10) — чистый код, ч. 5: `layout/` — имена (класс `Num`, `Mm.meters`, константы и поля словами, локальные имена), правило длины имени ESLint для папки.
- **3.139.0** (20.10) — чистый код, ч. 4: `view/` — имена (члены `StScene`, оснащение через `this.outfit`, буферы `StMesh`), описания, класс `Rgb`.
- **3.138.0** (20.10) — чистый код, ч. 3: `eskd/` и `draw/` — имена (поля рамки значка, схем, чертежа — части обращаются к нему через `this.drawing`), описания; в слепке — все листы чертежа.
- **3.137.0** (20.10) — чистый код, ч. 2: `rules/`, `rules-doc/` — имена (и поля классов), `StationRules.value`, описания.
- **3.136.0** (20.10) — чистый код, ч. 1: ESLint `id-length` и `kp/jsdoc` для готовых папок (`CLEAN`); `tz/`, `tz-out/`, `calc/` — имена, `TzFit`, константы, закрытые методы, `Mm.text`/`Mm.dec`, `CalcNote.fmt`.
- **3.135.0** (20.10) — интерфейс: ТЗ заказчика и ТЗ на сборку — ES-модули `tz/` и `tz-out/` (по требованию); слепок — подбор по ТЗ и текст ТЗ.
- **3.134.0** (20.10) — интерфейс: правила станций — ES-модули `rules/` и `rules-doc/` (по требованию через `import()`); кнопка документа правил — сразу.
- **3.133.0** (20.10) — сервер: feeds — строгий Ruff, подписи типов; весь `app/*.py` — под строгим Ruff.
- **3.132.0** (20.10) — сервер: admin — строгий Ruff, подписи типов.
- **3.131.0** (20.10) — сервер: feed_files — строгий Ruff, подписи типов.
- **3.130.0** (20.10) — сервер: storage — строгий Ruff, подписи типов (схема и миграции — без изменений).
- **3.129.0** (20.10) — сервер: web_api — строгий Ruff, подписи типов.
- **3.128.0** (20.10) — сервер: bitrix — строгий Ruff, подписи типов.
- **3.127.0** (20.10) — сервер: counterparty, logistics_api — строгий Ruff, подписи типов.
- **3.126.0** (20.10) — сервер: crm, catalog_admin, data_file, app_update — строгий Ruff, подписи типов.
- **3.125.0** (20.10) — сервер: pdf_text, station_rules, kp_server, tz_parse — строгий Ruff, подписи типов.
- **3.124.0** (20.10) — сервер: doc_text, kp_files, kp_track, maintenance, catalog_migrate — строгий Ruff, подписи типов.
- **3.123.0** (20.10) — сервер: china_freight, catalog_patch, bitrix_rules, kp_templates, data_bundle, auth_users — строгий Ruff, подписи типов.
- **3.122.0** (20.10) — сервер: settings_history, launcher, connections, admin_overview, server_log, pdf_convert, backup_mirror, supplier_scope, images — строгий Ruff, подписи типов.
- **3.121.0** (20.10) — сервер, ещё 16 малых модулей (version, data_setup, desktop, catalog_sync, equipment_types, user_prefs, lists, net, workcal, db_health, update_sign, cbr, server_task, ed25519, admin_alerts, ocr_win) — строгий Ruff, подписи типов.
- **3.120.0** (20.10) — сервер, малые модули (`config`, `features`, `defaults`, `geo`, `ai_llm`, `ai_profile`, `maker_logos`, `imgfetch`) — строгий Ruff, подписи типов, короткие описания.
- **3.119.0** (20.10) — лист ЕСКД, рисунки оборудования, схемы — ES-модули `eskd/` (`EskdSheet` + `EskdFrame`, `EquipIcon` + `Icon*`, `StationScheme` + `Scheme*`, `HydroScheme`); в слепке — гидравлическая схема.
- **3.118.0** (20.10) — габаритный чертёж и SVG-вид — ES-модули `draw/` (`StationDrawing` + `Draw*`, `StationView3D` + `View3dUnits`).
- **3.117.0** (19.10) — 3D-вид — ES-модули `view/` (`StScene` + `Scene*`, `StMesh`, `StGl`, `StationRender`); в слепке — арочная крыша и калитка.
- **3.116.0** (19.10) — 3D-оснащение и наклейки — ES-модули `view/` (`StOutfit` + `Outfit*`, `StDecal`, `PhotoTint`); в слепке — отпечаток `StScene.build`.
- **3.115.0** (19.10) — расчётная записка станции — ES-модули `calc/` (`station-calc.js` удалён), шаги расчёта — методы классов.
- **3.114.0** (19.10) — системы станции — ES-модули `layout/` (`station-systems.js` удалён): `VentPlan`/`VentIntake` — места жалюзи по шагам, `VentGrille` — размеры, `StationVent` — выбор варианта и тексты.
- **3.113.0** (19.10) — `StationLayout` — ES-модуль `layout/station-layout.js` с помощниками по ответственности (`LayoutRows`, `LayoutDgu`, `LayoutTank`, `LayoutJoints`, `LayoutWalls`, `LayoutGates`, `LayoutExits`, `LayoutAccess`, `LayoutSize`, `LayoutRoof`, `LayoutOpening`, `LayoutMode`, `LayoutNotes`); `features/station-layout.js` удалён.
- **3.112.0** (19.10) — классы компоновки станций — ES-модули `features/layout/*.js` (`index.js` — мост в `globalThis`), `AirCheck`, `LayoutPipes`, `LayoutItem`, `Mm`; `tests/js/web.js` грузит модули в проверках; `StationLayout` пока в `station-layout.js` (следующая часть).
- **3.111.0** (19.10) — основа переписывания кода: слепок станций (`tests/js/golden.js`, `station_golden.js`), `tests/code_style.py` (Ruff, Prettier), строгий ESLint для ES-модулей, `pyproject.toml`, `.prettierrc.json`.
- **3.110.1** (19.10) — модуль станции из модулей не короче 7 м (`mods.lMin`); две ДГУ у торцов — без второй двери оператора (`second`); модули в один ряд — без продольного прохода (`rowE`); приток не встаёт — выброс через крышу (`StationVent.calc`); ресиверы парами поперёк, если короче на 1 м (`autoSize`/`forcePairs`, `recv.pairWall`; в `squeeze` пары — раньше «вплотную»); вторая дверь оператора — только при `exits.far` (7 м) или шкафах > 7 м.
- **3.110.0** (19.10) — аккуратная компоновка: `StationTidy` (лицевая линия, шаг, ворота, жалюзи, оценка `plan.tidy`, выбор аккуратнейшего), правило `look`, `StationDrawing.anchor`.
- **3.109.0** (19.10) — модули 2 448…2 550 мм (`StationMods.widths`, `content`), `StationJoints` (разъёмные соединения стыков в ТЗ), выход трубопровода мимо ворот с фланцем (`StationLayout.outlet/outPath`, `StScene.outlet`).
- **3.108.0** (19.10) — станция из модулей: `StationMods` (раскладка a × b, стыки, стойки, `cross`), `StationLayout.joints` (оборудование не на стыках), `geo.mods`, масса и строповка по модулям, окно `StationModsUi` (сетка, перетаскивание, подтверждение), строка «Стыковка модулей на объекте» (`st.joinCost`).
- **3.107.2** (19.10) — ДГУ: бак на всю ширину при воротах (`tankRoom`), ДГУ посередине с `dgu.pass`.
- **3.107.1** (19.10) — ДГУ: бак выше вместо длиннее (`TankSize.of(v, lim)`, `tank.top/wMax`), глушители у всех, приток у каждой ДГУ (`vent.inEach`), `dMid`.
- **3.107.0** (19.10) — станции ДГУ: `StationLayout.rowD/dLine/dEnds/dAcross`, `dguDoors`, `exhausts`, `TankSize`, `fuel.gate`,
  `fuelLine`; `StationVent` — жалюзи радиатора у каждой ДГУ; `StScene.mapMesh`; правила `layout.matrix` `tank.*`, группа `dgu`.
- **3.106.0** (19.10) — Битрикс24: `bitrix_rules.BitrixRules` (направления, менеджеры, воронки, карта полей, товары и файлы,
  компании, дела, расписание), `BitrixDry` (пробный прогон), `BitrixImport` (старые сделки), журнал с менеджером; «Настройки →
  Битрикс24» — 9 вкладок.
- **3.105.1** (19.10) — deal.js в классах (`DealDefaults`, `DealCal`, `DealState`, `DealSuppliers`, `DealFmt`, `DealView`,
  `DealConds`, `DealRows`, `DealWin`); `Debounce` (core/util.js) — задержка ввода поиска; `el.eta` — источник ГОСТ IEC 60034-30-1.
- **3.105.0** (19.10) — окраска станции: `StationPaint` (части `p.paint`, буклет `p.paintBook/paintFile`, рисунки `p.art`),
  `PaintView` (окна в «Крыша, пол, окраска»), `StOutfit.arts`, наклейка `art` (`StDecal`), строка КП «Окраска», ТЗ — по частям и
  приложения; `/api/img` — PDF только как буклет.
- **3.104.3** (19.10) — расчёты по проверке помощником: `DealLeadTime`, `DealMoneyRate` (deal.js), `StationPower` с `el.eta`,
  `StationDefaults.hours`, `StationHeat.airAt`, `Freight.escortCars`, `logRu.ins`/`LruIns`; правила `heat.comp_air`, `heat.dgu_rad`,
  `heat.louver_leak`.
- **3.104.2** (19.10) — `Money` (core/money.js — весь показ денег), `Net` (app/net.py — запросы сервера в интернет), `BodyLimit`
  (kp_server.py), `DocxCheck` и при загрузке docx, `PdfApi`; логистика — классы `DealLogistics`, `LgTariffFile`, `LgFmt` (были функции
  `lg*`); слепок экономики сделки `tests/js/deal_golden.js` (+ `.json`), `tests/js/money.js`, `tests/test_net.py`, `kit.Docx`.
- **3.104.1** (19.10) — `DblClickGuard` (core/util.js): второй щелчок двойного щелчка по окну, открытому первым, не нажимает;
  среда Claude Code: хуки `.claude/hooks` (guard, lint, session-start), навыки `/vypusk`, `/progon`, `/migraciya`, помощники
  `.claude/agents`, Playwright MCP (`.mcp.json`), прогон интерфейса `tests/ui/progon.py`, `run_all.py --changed`, `kit.Schema.down_to`.
- **3.104.0** (18.10) — 17 доработок: `QuickSearch`, `KpRepeat`/`CatPrice`, `DbHealth`, `WriteBatch`, `LazyJs`, журнал по `datarev:kpj`.
- **3.103.1** (18.10) — разделы каталога плитками (`CatSections`, `CatalogFilter.grp`).
- **3.103.0** (18.10) — пункты аудита 1/3/4/5/6/7/9: подпись обновлений (`update_sign`, `ed25519`), `DocLimits`, `feed_id` и индексы, восстановление через временную копию, `MailRate`, скорость каталога.
- **3.102.1** (18.10) — аудит ECC: `TxLock` (откат транзакции), маршруты `\Z`, модерация по полям, `DocxCheck`, `Drafts.stash()` → bool.
- **3.102.0** (18.10) — единые форматы выгрузки (`data_file.DataFile`: xlsx/json/xml/yml/zip), загрузка любого, «только изменённое» (`digests`), `CatalogFilter`.
- **3.101.5** (18.10) — «База и копии»: сводка (`DbOverview`, `maint/overview`) и подвкладки `BackupTab.SUBS`, выгрузка разделов во вкладке.
- **3.101.4** (18.10) — выгрузка каталога по выбору: `ExportScope`, `export/scope`, `pick`.
- **3.101.3** (17.10) — доска: «Новые из Битрикс24», порядок карточек; «Не отправлено» + «Повторить»; EXE только по команде (`build` — `workflow_dispatch`).
- **3.101.2** (17.10) — габариты в три окошка: `DimInput` (core/util.js), `DimRow` (item-editor.js), контейнер станции.
- **3.101.1** (17.10) — «Б24 ↗» на доске (`bxUrl`), `bxNew` + `DealBook.flag`, `CrmController.mailed` (дело «Письмо»).
- **3.101.0** (17.10) — связь с Битрикс24: `bitrix.py` (`BitrixSync`, очередь, опрос, `BitrixDesk`), миграция `2027-11-bitrix`, `settings-bitrix.js`, `KpLines`, `DealState.summary().full`, `EconXlsx`.
- **3.100.0** (17.10) — кабинет менеджера (CRM): сервер `crm.py` (`Stages`, `DealBook`, `TaskBook`, `CrmBoard`), миграция `2027-10-crm` (`deals`, `deal_kp`, `crm_tasks`), `CrmController`; клиент `cabinet.js`, `cabinet-board.js`, `deal-card.js`, `DealPlan` (deal.js), `cabinet.css`; «Мой день» → вкладка «Сегодня».
- **3.99.7** (17.10) — «Настройки» в 4 разделах (`AdminNav.HOME`, `parts`, `ALIAS`), «Товары» = окно каталога (`GoodsTab`), `TrashTab`, `ModerationView` (поля «было → стало», приём по полям), `CatalogExportDlg`; сервер `catalog_admin.py` (`ModerationDesk`, `TrashBin`, `CatalogExport`, `ClientsExport`, `CatalogDesk`, `power`), права `catDelete`/`catSelfMod`/`export`; `feeds.FeedRules` (отбор, поля, план); `data_bundle.SettingsFile` (все настройки в файл).
- **3.99.6** (17.10) — ставки экспедиторов Excel-файлом (шаблон и загрузка, `ChinaRateBook`) и «Запрос экспедитору».
- **3.99.5** (17.10) — ориентиры ставок Китай → РФ по открытым данным (`china_rates_ref.json`, кнопка во вкладке).
- **3.99.4** (17.10) — «Доставка из Китая» (админка): ставки с участками и сроком, условия поставки → сумма к таможенной стоимости, контроль по ATI.SU (`log.cnDev`).
- **3.99.3** (17.10) — поставщик в строке состава и итог «Подбора» (`StationSup.label/summary`); номер тендера в Excel экономики.
- **3.99.2** (17.10) — подбор станции: один поставщик при равных условиях (`StationSup`, `pick.oneSup` 10 %), ресиверы — сначала АСО.
- **3.99.1** (17.10) — станция в сборе: только открытые машины (`open` у груза, `res.openOnly`), без сборного груза (`ltl:false`).
- **3.99.0** (17.10) — аудит п. 1–6: телефон 44 px, карточка каталога без фильтров, отопление до −40 °C без ТЗ (`heat.t_default`), н./ст. м³ (`AirDemand.REF`, `flow.standard`), агент и на разгрузку (`log.agentUnload`), вопрос о несохранённом в «Настройках».
- **3.98.0** (16.10) — выгрузка каталога по поставщику без цен (`supplier_scope.SupplierScope`, копия .zip и Excel для правки `catalog_patch.CatalogSheet`, `SupplierExport`); фиды — `FeedPanel` (разделы под раскрытием, «Поставщик в справочнике»); «Копии и база» — выгрузка сверху.
- **3.97.0** (16.10) — удаление позиций фида в корзину с запретом повторной загрузки (`feeds.FeedPurge`, `FeedPurgeUi`, `Store.trash_put_many`).
- **3.96.3** (16.10) — логистика: «выброс» не идёт в максимум (`LgOutlier`, `log.outlierK`), раскладка цены Энергии.
- **3.96.2** (16.10) — Энергия по API v4 с токеном разработчика (`Nrg`, `nrgToken`, адрес `v4`).
- **3.96.1** (16.10) — скорость (`ItemAttrs`, `CatalogCache` в `syncCatalog`, `feeds._feed_counts`, `GzipCache.building`), черновик без автора, `Modal.once`, системная тёмная тема, правки телефона.
- **3.96.0** (16.10) — аудит (сервер, безопасность, клиент, расчёты): `Handler.non_finite`/`lan_name`, `SafeWeb`, `AccessRecord`, `CbrCache`, `ClientFields`, `XlsId`, `TnVed.SPECIAL`, `deal.supVat`; Деловые Линии — дата забора по `workcal` с перебором (`Dellin.pickup_days`), Энергия — резерв API v3.
- **3.95.1** (16.10) — вход по паролю: менеджер в КП — только вошедший (`MgrLock` в managers.js, `admin.KpManagerLock` в `kp_in`), свою карточку правит сам.
- **3.95.0** (16.10) — пароли: временный от администратора (`auth_users.TempPassword`, `srv.tempPwHours`), смена своим (`UserPassword.change`, `admin.UserAuthApi`), выход на всех устройствах (`UserSession.drop_all`); клиент — `AuthMenu`, `AccessPanel`; автор удаляет свой справочный документ (`KpFiles.delete_own`, `kp.fileUndoMin`); `.kt-head`/`.kt-hist`.
- **3.94.0** (16.10) — ревью кода: перевозчики — классы `Carrier`/`Http`/`DeliveryQuote`; клиент — `Fmt`, `Modal` (util.js), `Theme`, `getPath`/`setPath`; сервер — `Controller.user_input`, `GzipCache`; станции — общие методы геометрии и вентиляции; CSS без дублей.
- **3.86.9** (13.10) — цвета оборудования зонами по фото (`PhotoTint.parts/_zones`, `item.tones`, `StScene.tones`, SVG-вид), логотип крупнее на цвете зоны.
- **3.86.8** (13.10) — «⇄ Заменить» в строке состава (`KitNeed.swap`, `kitSwap`, `swapRow`); общая вытяжка — своего размера, не над воротами.
- **3.86.7** (13.10) — отпечаток станции с версией программы (`APP_VERSION`), `VER` 23; решётки — одна группа на все компрессоры.
- **3.86.6** (13.10) — решётки: группа по габариту и расходу (не по названию); `noDoor` — отметка (без отметки осушителю/ресиверу нет); `service.step`, `service.wall`, `StationLayout.svcW/svcH`.
- **3.86.5** (13.10) — `StationMatrix.NO_DOOR` (осушитель, ресивер — никогда сервисные ворота, независимо от сохранённых правил); общая вытяжка — решётками размера компрессорных, не над воротами; конвекторы 100/100/150.
- **3.86.4** (13.10) — дверь оператора между компрессорами (`endsExits`, `between`), промежуток под неё в `rowE`; конвектор напротив.
- **3.86.3** (13.10) — без продольного прохода: компрессоры рядом в ряд от торца, промежуток `modes.next` (1 000 мм); общая вытяжка компрессорной — у осушителя (`StWalls.find` от точки).
- **3.86.2** (13.10) — без продольного прохода и с двумя компрессорами: по одному у каждого торца (`StationLayout.rowE`, `endsExits`, `ends.pos2`), `VER` 22.
- **3.86.1** (13.10) — жёсткое правило: решётки выброса у компрессоров одной модели одинаковые (`StationVent.calc0`: группы по модели, общий размер `slot`/`at`/`all`, добавка в торце — всем или никому).
- **3.82** (13.10) — выброс: не в створках ворот; над воротами → торец у компрессора (без ворот) → все через крышу одного размера (`StationVent.calc0`: `side`, `atEnd`, `viaRoof`); система «Вытяжные вентиляторы» (`exfan`, правило `vent.exfan`, `VentCalc.summer`), приточные вентиляторы (`V.infan`), `StOutfit.fan`, `StationDrawing.fanEnd`.
- **3.81** (13.10) — скорость у менеджеров: 3D без блокировки (`StGl.idle`, `StationRender.jpeg`), разбор карточек каталога один раз (`CatAttrs`, types.js), окно подбора (`PickFind`: строка поиска, сортировка, задержка ввода, ленивые фото), черновик в браузере без перезаписи картинок (`LocalDraft`, state.js).
- **3.80** (13.10) — выброс над сервисными воротами и одинаковые решётки (`StationVent.calc0`), режим «эксперт» с решениями (`ExpertFix`, station-fix.js), ресиверы в два ряда в конце ряда (`StationLayout.endPairs`), пересчёт ресиверов по вводу (`ReceiverSync`), вид адсорбционного осушителя (`twinDryer`).
