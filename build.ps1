# CommsAtlas build: makes ONE file to install, release/CommsAtlas-<build>.run
#   powershell -ExecutionPolicy Bypass -File build.ps1 -Notes "what changed in this build"
# The .run file is self-extracting. Inside it: CommsAtlas.Server (the server program as a single file, the web app embedded in it),
# appsettings.json, the installer / updater, the uninstaller, INSTALL.md and BUILD-LOG.md. Copy it to a Linux server and run it (see INSTALL.md).
# Every build gets its own random build number. It is shown in the app (status bar and sign-in page), added to the address of every script
# and style sheet (so browsers always load the new ones), compiled into the program and listed in BUILD-LOG.md.
#   -Runtime linux-x64 (default) or linux-arm64      -Test runs the server's own checks first and stops if any fails
param([string]$Notes = '', [string]$Runtime = 'linux-x64', [switch]$Test)
$ErrorActionPreference = 'Stop'
$app  = $PSScriptRoot
$src  = Join-Path $app 'src'
$rel  = Join-Path $app 'release'
$srvProj = Join-Path $app 'server\CommsAtlas.Server.csproj'
$embed = Join-Path $app 'server\wwwroot'      # the web app, copied here only while the program is being built, and embedded in it
$utf8 = New-Object System.Text.UTF8Encoding($false)
if ($Runtime -notmatch '^linux-(x64|arm64)$') { throw "-Runtime must be linux-x64 or linux-arm64" }

function Fresh($path) { if (Test-Path $path) { Remove-Item -Recurse -Force $path } }

# A random build number of 10 to 12 characters (the length is random too): lowercase letters and digits only, from the system's random
# generator. It always has at least one letter and one digit, skips look-alikes (0/o, 1/i/l), and is never one that is already in BUILD-LOG.md.
$logFile = Join-Path $app 'BUILD-LOG.md'
$alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
function RandBelow([int]$n) {
    $b = New-Object byte[] 4
    $limit = [uint32]::MaxValue - ([uint32]::MaxValue % [uint32]$n)
    do { $rng.GetBytes($b); $v = [BitConverter]::ToUInt32($b, 0) } while ($v -ge $limit)
    return [int]($v % [uint32]$n)
}
$logText = if (Test-Path $logFile) { [IO.File]::ReadAllText($logFile) } else { '' }
do {
    $len = 10 + (RandBelow 3)
    $build = -join (1..$len | ForEach-Object { $alphabet[(RandBelow $alphabet.Length)] })
} until ($build -cmatch '[a-z]' -and $build -match '[2-9]' -and -not $logText.Contains("| $build |"))
$when = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm'Z'")
Write-Host "Build $build ($when)"

if ($Test) {
    Write-Host 'Running the server checks...'
    $out = & dotnet run --project $srvProj -c Release -- --selftest 2>&1 | Out-String
    if ($out -notmatch 'All checks passed') { Write-Host $out; throw 'The server checks failed; nothing was built.' }
    Write-Host 'All checks passed.'
}

# 1. The web app, stamped with the build number, into the folder the program embeds. config.js is not part of it: the server writes it from appsettings.json.
Fresh $embed
Copy-Item -Recurse $src $embed
[IO.File]::WriteAllText((Join-Path $embed 'version.js'), "window.APP_BUILD = { number: '$build', time: '$when' };`n", $utf8)
$index = Join-Path $embed 'index.html'
$html = [IO.File]::ReadAllText($index)
$html = [regex]::Replace($html, '(src|href)="(/(?:js/[^"?]+\.js|styles\.css|version\.js))"', "`$1=`"`$2?b=$build`"")
[IO.File]::WriteAllText($index, $html, $utf8)
Remove-Item (Join-Path $embed 'config.js')

# 2. The server as ONE program file.
$pub = Join-Path $rel 'publish'
if (-not (Test-Path $rel)) { New-Item -ItemType Directory $rel | Out-Null }      # earlier .run files stay in release/
Fresh $pub
try {
    dotnet publish $srvProj -c Release -r $Runtime --no-self-contained -p:PublishSingleFile=true -p:BuildNumber=$build -o $pub --nologo
    if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed' }
} finally { Fresh $embed }
$exe = Join-Path $pub 'CommsAtlas.Server'
if (-not (Test-Path $exe)) { throw "the single-file program was not produced ($exe)" }
$extra = Get-ChildItem $pub -Recurse -File | Where-Object { $_.Name -notin @('CommsAtlas.Server', 'appsettings.json') }
if ($extra) { Write-Host ('Note: the publish folder also holds: ' + (($extra | ForEach-Object { $_.Name }) -join ', ') + ' (not packaged)') }
Write-Host ('CommsAtlas.Server: {0:N1} MB, one file' -f ((Get-Item $exe).Length / 1MB))

# 3. The payload: program, settings, installer, uninstaller, documents.
$stage = Join-Path $rel 'payload'
Fresh $stage
New-Item -ItemType Directory $stage | Out-Null
Copy-Item $exe $stage
Copy-Item (Join-Path $pub 'appsettings.json') $stage
[IO.File]::WriteAllText((Join-Path $stage 'build.txt'), $build, $utf8)
Copy-Item (Join-Path $app 'deploy\install-server.sh') $stage
Copy-Item (Join-Path $app 'deploy\uninstall-server.sh') $stage
Copy-Item (Join-Path $app 'INSTALL.md') $stage
$tgz = Join-Path $rel 'payload.tgz'
tar -czf $tgz -C $stage .
if ($LASTEXITCODE -ne 0) { throw 'tar failed' }
$payload = [IO.File]::ReadAllBytes($tgz)
$sha = (-join ((New-Object Security.Cryptography.SHA256Managed).ComputeHash($payload) | ForEach-Object { $_.ToString('x2') }))

# 4. The one file: a short shell script that checks and unpacks the payload behind it, then runs the installer.
$header = [IO.File]::ReadAllText((Join-Path $app 'deploy\run-header.sh')).Replace("`r`n", "`n").Replace('@@BUILD@@', $build).Replace('@@SHA@@', $sha)
$runFile = Join-Path $rel "CommsAtlas-$build.run"
$hb = $utf8.GetBytes($header)
$fs = [IO.File]::Create($runFile)
try { $fs.Write($hb, 0, $hb.Length); $fs.Write($payload, 0, $payload.Length) } finally { $fs.Dispose() }
Fresh $pub; Fresh $stage; Remove-Item $tgz

# 5. One line in BUILD-LOG.md.
if (-not (Test-Path $logFile)) {
    [IO.File]::WriteAllText($logFile, "# CommsAtlas build log`n`nOne line per build, newest at the bottom. The build number is shown in the app (status bar and sign-in page), in /api/v1/health and in the file name, so a running site can be matched to a line here.`n`n| Build | Built (UTC) | Package | Files (SHA-256, first 12) | Changes | Uploaded |`n|---|---|---|---|---|---|`n", $utf8)
}
$mb = (Get-Item $runFile).Length / 1MB
$h = (Get-FileHash $runFile -Algorithm SHA256).Hash.ToLower()
$note = ($Notes -replace '\|', '/' -replace '\r?\n', ' ').Trim()
if ($note.Length -eq 0) { $note = '(no notes given)' }
[IO.File]::AppendAllText($logFile, ("| $build | $when | one file, $Runtime | CommsAtlas-$build.run ({0:N1} MB) {1} | $note | not yet |`n" -f $mb, $h.Substring(0, 12)), $utf8)
Write-Host ('Built: {0}  ({1:N1} MB, SHA-256 {2})' -f $runFile, $mb, $h)
Write-Host 'Logged in BUILD-LOG.md'
