# Патч «Скопировать запрос» — ставится на работающую программу, сервер не останавливается.
#
# Кнопка «Скопировать запрос» (карточка позиции → «Автозаполнение») при открытии программы по сети
# (http://сервер:порт) писала «Запрос скопирован», но в буфере оставался прежний текст. Патч заменяет
# функцию aiCopy в распакованной копии работающей программы (папка _MEI… во временной папке Windows),
# файл js/features/ai-autofill.js. После патча достаточно обновить страницу в браузере (Ctrl+F5).
#
# Параметры (для проверки и особых случаев):
#   -Port 17845       порт программы (по умолчанию из settings.json или 17845)
#   -Target <папка>   патчить только указанную папку app\web (без поиска _MEI…)
param([int]$Port = 0, [string]$Target = '')

$ErrorActionPreference = 'Stop'
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy   # к своему серверу — без прокси
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$utf8 = New-Object System.Text.UTF8Encoding($false)
$ok = $true
$REL = 'js\features\ai-autofill.js'
$MARK = 'function copyToClipboard('

function Say([string]$t, [string]$c = 'Gray') { Write-Host $t -ForegroundColor $c }

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

$NEW_FN = @'
// Копирование в буфер обмена. По сети (http://сервер:порт) браузер не даёт странице navigator.clipboard —
// тогда текст кладётся через событие copy; поле для выделения создаётся внутри открытого окна,
// потому что всё вне модального окна браузер делает неактивным. true — только если текст точно скопирован.
async function copyToClipboard(txt){
  if (navigator.clipboard && window.isSecureContext){ try{ await navigator.clipboard.writeText(txt); return true; }catch(e){} }
  let done=false;
  const onCopy=e=>{ try{ e.clipboardData.setData('text/plain', txt); e.preventDefault(); done=true; }catch(_){} };
  document.addEventListener('copy', onCopy, true);
  const host=[...document.querySelectorAll('dialog[open]')].pop()||document.body;
  const ta=document.createElement('textarea'); ta.value=txt; ta.setAttribute('readonly',''); ta.style.cssText='position:fixed;left:-9999px;top:0;opacity:0';
  host.appendChild(ta); ta.focus(); ta.select();
  try{ document.execCommand('copy'); }catch(e){}
  document.removeEventListener('copy', onCopy, true); ta.remove();
  return done;
}

async function aiCopy(i){
  const it=S.items[i], txt=aiPrompt(it);
  const ok=await copyToClipboard(txt);
  it._aiMsg = ok ? 'Запрос скопирован — вставьте его в Claude.' : 'Не удалось скопировать автоматически — скопируйте текст из окна.';
  renderForm(); persist();
  if (!ok){ const d=$('#dlg'); d.innerHTML=`<div class="dlg-h"><h3>Запрос для Claude</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div><div class="dlg-b"><p class="muted" style="margin-top:0">Выделите текст (Ctrl+A) и скопируйте (Ctrl+C).</p><textarea rows="14" readonly>${esc(txt)}</textarea></div>`; d.showModal(); d.querySelector('[data-close]').onclick=()=>d.close(); const t=d.querySelector('textarea'); t.focus(); t.select(); }
}

'@

# заменить функцию aiCopy (от «async function aiCopy(» до первой строки «}» в начале строки)
function Patch-File([string]$file) {
    $src = [IO.File]::ReadAllText($file, [Text.Encoding]::UTF8)
    if ($src.Contains($MARK)) { return 'already' }
    $rx = New-Object Text.RegularExpressions.Regex('async function aiCopy\(i\)\{[\s\S]*?\n\}\r?\n')
    $m = $rx.Match($src)
    if (-not $m.Success) { return 'notfound' }
    $nl = if ($m.Value.Contains("`r`n")) { "`r`n" } else { "`n" }
    $new = $src.Substring(0, $m.Index) + ($NEW_FN -replace "`r?`n", $nl) + $src.Substring($m.Index + $m.Length)
    Copy-Item -LiteralPath $file -Destination ($file + '.before-patch') -Force
    [IO.File]::WriteAllText($file, $new, $utf8)
    return 'patched'
}

Say ''
Say 'Интерфейс работающей программы' 'Cyan'
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
            if (Test-Path -LiteralPath (Join-Path $w $REL)) { $webDirs += $w }
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
    $f = Join-Path $w $REL
    try {
        switch (Patch-File $f) {
            'patched'  { Say "  исправлено: $f" 'Green' }
            'already'  { Say "  уже исправлено: $f" 'Green' }
            'notfound' { Say "  не найдена функция aiCopy: $f" 'Yellow'; $ok = $false }
        }
    } catch { Say "  не удалось записать $f — $($_.Exception.Message)" 'Red'; $ok = $false }
}
# проверка: сервер уже отдаёт исправленный файл
if (-not $Target) {
    try {
        $js = Invoke-WebRequest -Uri "$base/web/js/features/ai-autofill.js" -UseBasicParsing -TimeoutSec 10
        $txt = [Text.Encoding]::UTF8.GetString($js.RawContentStream.ToArray())
        if ($txt.Contains($MARK)) { Say "  программа ($base) уже отдаёт исправленный интерфейс" 'Green' }
        else { Say "  программа ($base) отдаёт прежний файл — патч попал не в ту копию программы" 'Yellow'; $ok = $false }
    } catch { Say "  программа на $base не отвечает: $($_.Exception.Message)" 'Yellow' }
}

Say ''
if ($ok) { Say 'Патч установлен. Обновите страницу программы в браузере (Ctrl+F5).' 'Green'; exit 0 }
Say 'Патч установлен не полностью — см. сообщения выше.' 'Yellow'; exit 1
