# Патч «Названия клиентов как в выписке» — ставится на работающую программу, сервер не останавливается.
#
# 1. Интерфейс: в распакованной копии работающей программы (папка _MEI… во временной папке Windows)
#    заменяется функция shortName в js/features/clients.js — название клиента берётся из краткого
#    наименования выписки как есть, без перевода в строчные буквы и без правки кавычек.
#    После патча достаточно обновить страницу в браузере (Ctrl+F5).
# 2. Справочник клиентов: через работающий сервер для каждого клиента с ИНН заново запрашиваются
#    реквизиты, и название исправляется на краткое наименование из выписки.
#
# Параметры (для проверки и особых случаев):
#   -Port 17845       порт программы (по умолчанию из settings.json или 17845)
#   -Target <папка>   патчить только указанную папку app\web (без поиска _MEI…)
#   -SkipUi           не трогать интерфейс
#   -SkipNames        не исправлять названия в справочнике
param([int]$Port = 0, [string]$Target = '', [switch]$SkipUi, [switch]$SkipNames)

$ErrorActionPreference = 'Stop'
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy   # к своему серверу — без прокси
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$utf8 = New-Object System.Text.UTF8Encoding($false)
$ok = $true

function Say([string]$t, [string]$c = 'Gray') { Write-Host $t -ForegroundColor $c }

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

# ---------------------------------------------------------------- 1. интерфейс
$NEW_FN = @'
// Название клиента в КП — краткое наименование из выписки (ЕГРЮЛ / Checko / DaData) как есть:
// регистр букв и кавычки не меняются. Если краткого нет и пришло полное — сокращается только
// организационно-правовая форма («ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ» → «ООО»).
const OPF_SHORT=[[/^ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ\s*/i,'ООО'],[/^ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО\s*/i,'ПАО'],[/^НЕПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО\s*/i,'АО'],
  [/^АКЦИОНЕРНОЕ ОБЩЕСТВО\s*/i,'АО'],[/^ЗАКРЫТОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО\s*/i,'ЗАО'],[/^ОТКРЫТОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО\s*/i,'ОАО'],[/^ИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ\s*/i,'ИП'],
  [/^ФЕДЕРАЛЬНОЕ ГОСУДАРСТВЕННОЕ УНИТАРНОЕ ПРЕДПРИЯТИЕ\s*/i,'ФГУП'],[/^МУНИЦИПАЛЬНОЕ УНИТАРНОЕ ПРЕДПРИЯТИЕ\s*/i,'МУП'],[/^ГОСУДАРСТВЕННОЕ УНИТАРНОЕ ПРЕДПРИЯТИЕ\s*/i,'ГУП']];
function shortName(s){
  s=String(s||'').replace(/\s+/g,' ').trim(); if (!s) return s;
  for (const [rx,ab] of OPF_SHORT) if (rx.test(s)) return ab+' '+s.replace(rx,'');
  return s;
}
'@

# заменить функцию shortName (от «function shortName(» до первой строки «}» в начале строки)
function Patch-ClientsJs([string]$file) {
    $src = [IO.File]::ReadAllText($file, [Text.Encoding]::UTF8)
    if ($src.Contains('const OPF_SHORT=')) { return 'already' }
    $rx = New-Object Text.RegularExpressions.Regex('(?:// Название клиента в КП[^\n]*\n(?://[^\n]*\n)*)?function shortName\(s\)\{[\s\S]*?\n\}\r?\n', [Text.RegularExpressions.RegexOptions]::None)
    $m = $rx.Match($src)
    if (-not $m.Success) { return 'notfound' }
    $nl = if ($m.Value.Contains("`r`n")) { "`r`n" } else { "`n" }
    $new = $src.Substring(0, $m.Index) + ($NEW_FN -replace "`r?`n", $nl) + $src.Substring($m.Index + $m.Length)
    Copy-Item -LiteralPath $file -Destination ($file + '.before-patch') -Force
    [IO.File]::WriteAllText($file, $new, $utf8)
    return 'patched'
}

if (-not $SkipUi) {
    Say ''
    Say '[1/2] Интерфейс работающей программы' 'Cyan'
    $webDirs = @()
    if ($Target) { $webDirs = @($Target) }
    else {
        # распакованные копии программы: _MEI…\app\web во временных папках (пользователей и SYSTEM)
        $roots = @($env:TEMP, $env:TMP, (Join-Path $env:WINDIR 'Temp'), (Join-Path $env:WINDIR 'SystemTemp'))
        if (Test-Path 'C:\Users') { $roots += Get-ChildItem 'C:\Users' -Directory -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName 'AppData\Local\Temp' } }
        foreach ($r in ($roots | Where-Object { $_ } | Select-Object -Unique)) {
            if (-not (Test-Path -LiteralPath $r)) { continue }
            Get-ChildItem -LiteralPath $r -Directory -Filter '_MEI*' -ErrorAction SilentlyContinue | ForEach-Object {
                $w = Join-Path $_.FullName 'app\web'
                if (Test-Path -LiteralPath (Join-Path $w 'js\features\clients.js')) { $webDirs += $w }
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
    foreach ($w in $webDirs) {
        $f = Join-Path $w 'js\features\clients.js'
        try {
            $r = Patch-ClientsJs $f
            switch ($r) {
                'patched'  { Say "  исправлено: $f" 'Green' }
                'already'  { Say "  уже исправлено: $f" 'Green' }
                'notfound' { Say "  не найдена функция shortName: $f" 'Yellow'; $ok = $false }
            }
        } catch { Say "  не удалось записать $f — $($_.Exception.Message)" 'Red'; $ok = $false }
    }
    # проверка: сервер уже отдаёт исправленный файл
    if (-not $Target) {
        try {
            $js = Invoke-WebRequest -Uri "$base/web/js/features/clients.js" -UseBasicParsing -TimeoutSec 10
            $txt = [Text.Encoding]::UTF8.GetString($js.RawContentStream.ToArray())
            if ($txt.Contains('const OPF_SHORT=')) { Say "  программа ($base) уже отдаёт исправленный интерфейс — обновите страницу в браузере (Ctrl+F5)" 'Green' }
            else { Say "  программа ($base) отдаёт прежний файл — патч попал не в ту копию программы" 'Yellow'; $ok = $false }
        } catch { Say "  программа на $base не отвечает: $($_.Exception.Message)" 'Yellow' }
    }
}

# ---------------------------------------------------------------- 2. названия в справочнике клиентов
$OPF = @(
    @('ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ', 'ООО'), @('ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО', 'ПАО'), @('НЕПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО', 'АО'),
    @('АКЦИОНЕРНОЕ ОБЩЕСТВО', 'АО'), @('ЗАКРЫТОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО', 'ЗАО'), @('ОТКРЫТОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО', 'ОАО'), @('ИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ', 'ИП'),
    @('ФЕДЕРАЛЬНОЕ ГОСУДАРСТВЕННОЕ УНИТАРНОЕ ПРЕДПРИЯТИЕ', 'ФГУП'), @('МУНИЦИПАЛЬНОЕ УНИТАРНОЕ ПРЕДПРИЯТИЕ', 'МУП'), @('ГОСУДАРСТВЕННОЕ УНИТАРНОЕ ПРЕДПРИЯТИЕ', 'ГУП'))
function Get-ShortName([string]$s) {
    $s = ($s -replace '\s+', ' ').Trim()
    foreach ($p in $OPF) { $rx = '^(?i)' + [regex]::Escape($p[0]) + '\s*'; if ($s -match $rx) { return $p[1] + ' ' + ($s -replace $rx, '') } }
    return $s
}

if (-not $SkipNames) {
    Say ''
    Say '[2/2] Названия в справочнике клиентов' 'Cyan'
    # список разворачивается явно: PowerShell 7 отдаёт JSON-массив одним объектом, 5.1 — по элементам
    try { $clients = @(Invoke-RestMethod -Uri "$base/api/clients" -TimeoutSec 15 | ForEach-Object { $_ }) }
    catch { Say "  программа на $base не отвечает — названия не исправлены: $($_.Exception.Message)" 'Red'; $clients = @(); $ok = $false }
    $fixed = 0; $same = 0; $fail = 0
    foreach ($c in $clients) {
        $inn = ([string]$c.inn) -replace '\D', ''
        if (-not $inn) { continue }
        try {
            $p = Invoke-RestMethod -Uri "$base/api/party?inn=$inn" -TimeoutSec 60
            if ($p.error) { throw $p.error }
            $name = Get-ShortName $(if ($p.short) { [string]$p.short } else { [string]$p.full })
            if (-not $name) { throw 'в выписке нет наименования' }
            if ($name -ceq [string]$c.name) { $same++ }
            else {
                $old = $c.name; $c.name = $name
                $body = [Text.Encoding]::UTF8.GetBytes(($c | ConvertTo-Json -Depth 30 -Compress))
                Invoke-RestMethod -Method Put -Uri "$base/api/clients/$($c.id)" -ContentType 'application/json; charset=utf-8' -Body $body -TimeoutSec 15 | Out-Null
                Say "  $inn  «$old» → «$name»" 'Green'; $fixed++
            }
            if ($p.source -like '*ФНС*') { Start-Sleep -Milliseconds 1300 }   # сайт налоговой ограничивает частые запросы
        } catch { Say "  $inn  не исправлен: $_" 'Yellow'; $fail++ }
    }
    Say "  исправлено: $fixed, уже верно: $same, ошибок: $fail"
    if ($fail) { $ok = $false }
}

Say ''
if ($ok) { Say 'Патч установлен. Обновите страницу программы в браузере (Ctrl+F5).' 'Green'; exit 0 }
Say 'Патч установлен не полностью — см. сообщения выше.' 'Yellow'; exit 1
