# Патч «Каталог» — ставится на работающую программу, сервер не останавливается.
#
# Что делает: заменяет интерфейс (папку app\web) в распакованной копии работающей программы
# (папка _MEI… во временной папке Windows) на интерфейс новой версии. Сервер читает эти файлы
# при каждом обращении, поэтому после патча достаточно обновить страницу в браузере (Ctrl+F5).
# База, шаблоны и настройки не меняются. Прежний интерфейс сохраняется рядом (web.before-<дата>).
#
# Откуда берутся файлы: папка web рядом с этим файлом (комплект из GitHub → Actions → Artifacts)
# или app\web репозитория (если патч запускается из скачанного репозитория).
#
# Параметры (для проверки и особых случаев):
#   -Port 17845       порт программы (по умолчанию из settings.json или 17845)
#   -Target <папка>   патчить только указанную папку app\web (без поиска _MEI…)
#   -Force            не проверять версию работающей программы
param([int]$Port = 0, [string]$Target = '', [switch]$Force)

$ErrorActionPreference = 'Stop'
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy   # к своему серверу — без прокси
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$ok = $true
$MARK_FILE = 'js\features\catalog-window.js'
$MARK = 'function cwMove('

function Say([string]$t, [string]$c = 'Gray') { Write-Host $t -ForegroundColor $c }

# ---------------------------------------------------------------- источник: новый интерфейс
$src = $null
foreach ($s in @((Join-Path $here 'web'), (Join-Path (Split-Path -Parent (Split-Path -Parent $here)) 'app\web'))) {
    if ((Test-Path -LiteralPath (Join-Path $s 'index.html')) -and (Test-Path -LiteralPath (Join-Path $s $MARK_FILE))) { $src = (Resolve-Path -LiteralPath $s).ProviderPath; break }
}
if (-not $src) { Say 'Не найдены файлы нового интерфейса (папка web рядом с патчем). Скачайте комплект патча целиком.' 'Red'; exit 1 }
$files = @(Get-ChildItem -LiteralPath $src -Recurse -File)
Say "Новый интерфейс: $src ($($files.Count) файлов)"

# ---------------------------------------------------------------- порт программы
if (-not $Port) {
    $Port = 17845
    foreach ($s in @((Join-Path (Split-Path -Parent $here) 'settings.json'), (Join-Path (Split-Path -Parent (Split-Path -Parent $here)) 'settings.json'))) {
        if (Test-Path -LiteralPath $s) {
            try { $j = [IO.File]::ReadAllText($s, [Text.Encoding]::UTF8) | ConvertFrom-Json; if ($j.port) { $Port = [int]$j.port } } catch {}
            break
        }
    }
}
$base = "http://127.0.0.1:$Port"

# ---------------------------------------------------------------- версия работающей программы
# новому интерфейсу нужен сервер с редактором шаблонов (версия от 29.09.2026 и новее)
if (-not $Force -and -not $Target) {
    try {
        $tpls = @(Invoke-RestMethod -Uri "$base/api/templates" -TimeoutSec 10 | ForEach-Object { $_ })
        if ($tpls.Count -and $tpls[0].id) {
            try { Invoke-WebRequest -Uri "$base/api/templates/$($tpls[0].id)/history" -UseBasicParsing -TimeoutSec 10 | Out-Null }
            catch { Say "Работающая программа слишком старая для этого патча. Замените EXE на новую сборку (GitHub → Actions → Artifacts)." 'Red'; exit 1 }
        }
    } catch { Say "Программа на $base не отвечает: $($_.Exception.Message)" 'Yellow'; Say 'Проверьте, что программа запущена, и укажите порт: install.ps1 -Port <порт>' 'Yellow'; exit 1 }
}

# ---------------------------------------------------------------- распакованные копии программы
Say ''
Say 'Интерфейс работающей программы' 'Cyan'
$webDirs = @()
if ($Target) { $webDirs = @($Target) }
else {
    # _MEI…\app\web во временных папках (пользователей и SYSTEM)
    $roots = @($env:TEMP, $env:TMP, (Join-Path $env:WINDIR 'Temp'), (Join-Path $env:WINDIR 'SystemTemp'))
    if (Test-Path 'C:\Users') { $roots += Get-ChildItem 'C:\Users' -Directory -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName 'AppData\Local\Temp' } }
    foreach ($r in ($roots | Where-Object { $_ } | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $r)) { continue }
        Get-ChildItem -LiteralPath $r -Directory -Filter '_MEI*' -ErrorAction SilentlyContinue | ForEach-Object {
            $w = Join-Path $_.FullName 'app\web'
            if (Test-Path -LiteralPath (Join-Path $w 'index.html')) { $webDirs += $w }
        }
    }
}
# одна и та же временная папка может найтись под разными именами (короткое имя 8.3, TEMP и AppData\Local\Temp)
$webDirs = @($webDirs | ForEach-Object { (Resolve-Path -LiteralPath $_).ProviderPath } | Select-Object -Unique)
if (-not $webDirs.Count) {
    Say '  Распакованная программа не найдена. Возможно, она запущена от другого пользователя или не запущена.' 'Yellow'
    Say '  Запустите патч от имени администратора на компьютере, где работает программа.' 'Yellow'
    $ok = $false
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
foreach ($w in $webDirs) {
    try {
        $bak = Join-Path (Split-Path -Parent $w) "web.before-$stamp"
        Copy-Item -LiteralPath $w -Destination $bak -Recurse -Force
        $n = 0
        foreach ($f in $files) {
            $rel = $f.FullName.Substring($src.Length).TrimStart('\', '/')
            $dst = Join-Path $w $rel
            $dir = Split-Path -Parent $dst
            if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
            Copy-Item -LiteralPath $f.FullName -Destination $dst -Force
            $n++
        }
        Say "  обновлено файлов: $n — $w" 'Green'
        Say "  прежний интерфейс: $bak"
    } catch { Say "  не удалось обновить $w — $($_.Exception.Message)" 'Red'; $ok = $false }
}
# проверка: сервер уже отдаёт новый интерфейс
if (-not $Target) {
    try {
        $js = Invoke-WebRequest -Uri "$base/web/js/features/catalog-window.js" -UseBasicParsing -TimeoutSec 10
        $txt = [Text.Encoding]::UTF8.GetString($js.RawContentStream.ToArray())
        if ($txt.Contains($MARK)) { Say "  программа ($base) уже отдаёт новый интерфейс" 'Green' }
        else { Say "  программа ($base) отдаёт прежний интерфейс — патч попал не в ту копию программы" 'Yellow'; $ok = $false }
    } catch { Say "  программа ($base) не отдаёт новый интерфейс: $($_.Exception.Message)" 'Yellow'; $ok = $false }
}

Say ''
if ($ok) { Say 'Патч установлен. Обновите страницу программы в браузере (Ctrl+F5) у всех сотрудников.' 'Green'; exit 0 }
Say 'Патч установлен не полностью — см. сообщения выше.' 'Yellow'; exit 1
