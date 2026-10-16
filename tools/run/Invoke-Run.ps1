<#
.SYNOPSIS
    One automated run on KSP-dev, KSP-scenario or KSP-bench: build, deploy,
    play the route, archive, analyze.

.DESCRIPTION
    1. Builds the solution (TMinus and the dev-only route driver) and the
       analyzer, unless -NoBuild.
    2. Archives a KSP.log left by an earlier manual session, so nothing is lost.
    3. Deploys 000_TMinus\Plugins and TMinusRoute into the install, and writes
       its Settings.cfg: the repo's file, then the install's own switches
       (below), then -Set. Every run states its switches; nothing is inherited
       from the last run.
    4. Restores the save from its snapshot (a launch leaves a vessel on the
       pad, which would stop the next launch at a pre-flight check).
    5. Starts KSP_x64.exe -tminus-route and waits for it to quit. The route
       driver (src/TMinus.Route) plays docs/benchmarks/protocol.md's route and
       quits; on a problem it writes "[TMinusRoute] FAILED" and quits. Past
       -TimeoutMinutes the game is killed.
    6. Archives KSP.log, Player.log and the session's .jsonl into the install's
       run folder, with conditions.txt (commit, switches, route result) and
       report.md (the analyzer's report).
    7. Runs check-archived and prints this run's line.

    Exits with 0 when the route finished and the run passes its expectations.
    On KSP-bench (frozen) it touches only GameData\000_TMinus,
    GameData\TMinusRoute and saves\hyperload-bench. Never runs on any other
    install.

.PARAMETER Set
    Extra Settings.cfg switches for this run, e.g. @{ harmonyCallHooks = 'true' }.

.EXAMPLE
    .\tools\run\Invoke-Run.ps1 -Install dev
    .\tools\run\Invoke-Run.ps1 -Install scenario -Set @{ harmonyCallHooks = 'true' }
    .\tools\run\Invoke-Run.ps1 -Install bench -Set @{ addonStartHooks = 'true' }
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('dev', 'scenario', 'bench')]
    [string]$Install,
    [hashtable]$Set = @{},
    [switch]$NoBuild,
    [int]$TimeoutMinutes = 30,
    [string]$Expectations = 'D:\KSP\expectations.json'
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'KspRuns.psm1') -Force

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$installs = @{
    # Switches each install's cases rely on (CLAUDE.md, Environment).
    dev      = @{ Root = 'D:\KSP\KSP-dev'; Snapshot = 'D:\KSP\dev-saves\hyperload-dev'; Runs = 'D:\KSP\dev-runs'; Switches = @{} }
    scenario = @{ Root = 'D:\KSP\KSP-scenario'; Snapshot = 'D:\KSP\scenario-saves\hyperload-dev'; Runs = 'D:\KSP\scenario-runs'; Switches = @{ patchInventory = 'true' } }
    bench    = @{ Root = 'D:\KSP\KSP-bench'; Snapshot = 'D:\KSP\bench-saves\hyperload-bench'; Runs = 'D:\KSP\bench-runs'; Switches = @{} }
}
$target = $installs[$Install]
$root = $target.Root
$save = Split-Path -Leaf $target.Snapshot

if (-not (Test-Path (Join-Path $root 'KSP_x64.exe'))) { throw "Not a KSP install: $root" }
if (Get-Process -Name 'KSP_x64' -ErrorAction SilentlyContinue) { throw 'KSP is running. Close it first.' }

# 1. Build. The TMinus build also deploys to KSP-dev (TMinus.csproj), Settings.cfg included: step 3 rewrites it.
if (-not $NoBuild) {
    dotnet build (Join-Path $repo 'TMinus.sln') -v q -nologo | Select-String -Pattern 'error|warning CS' | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) { throw 'dotnet build failed' }
    npm --prefix (Join-Path $repo 'tools\analyze') run build --silent
    if ($LASTEXITCODE -ne 0) { throw 'analyzer build failed' }
}

# 2. A manual session's logs, before this run overwrites them.
$earlier = Save-KspRun -InstallRoot $root -ArchiveRoot $target.Runs
if ($earlier) { Write-Host "Earlier session archived (if new): $earlier" }

# 3. Deploy and switches.
foreach ($mod in @(@{ From = 'GameData\000_TMinus\Plugins'; To = 'GameData\000_TMinus\Plugins' }, @{ From = 'GameData\TMinusRoute'; To = 'GameData\TMinusRoute' })) {
    $from = Join-Path $repo $mod.From
    if (-not (Get-ChildItem $from -Filter *.dll -Recurse -ErrorAction SilentlyContinue)) { throw "Nothing built in $from (run without -NoBuild)" }
    robocopy $from (Join-Path $root $mod.To) /MIR /NJH /NJS /NFL /NDL /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }
}
Copy-Item (Join-Path $repo 'GameData\000_TMinus\PluginData\Settings.cfg') (Join-Path $root 'GameData\000_TMinus\PluginData\Settings.cfg')
$switches = @{}
foreach ($s in @($target.Switches, $Set)) { foreach ($k in $s.Keys) { $switches[$k] = "$($s[$k])".ToLowerInvariant() } }
if ($switches.Count) { Set-TMinusSettings -InstallRoot $root -Values $switches }

# 4. Save.
Restore-KspSave -Snapshot $target.Snapshot -Target (Join-Path $root "saves\$save")

# 5. Play the route.
$commit = (git -C $repo rev-parse --short HEAD)
$dirty = if (git -C $repo status --porcelain -- src GameData tools) { '.dirty' } else { '' }
$switchText = if ($switches.Count) { ($switches.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Name) = $($_.Value)" }) -join ', ' } else { 'repo defaults' }
Write-Host "Running KSP-$Install ($commit$dirty; $switchText). Keep the machine idle until KSP quits."
$started = Get-Date
$ksp = Start-Process -FilePath (Join-Path $root 'KSP_x64.exe') -ArgumentList '-tminus-route', "-tminus-route-save=$save" -WorkingDirectory $root -PassThru
$timedOut = -not $ksp.WaitForExit($TimeoutMinutes * 60 * 1000)
if ($timedOut) {
    $ksp.Kill()
    $ksp.WaitForExit()
}
$minutes = ((Get-Date) - $started).TotalMinutes

# 6. Archive.
$kspLog = Join-Path $root 'KSP.log'
if (-not (Test-Path $kspLog) -or (Get-Item $kspLog).LastWriteTime -lt $started) { throw "KSP wrote no KSP.log for this run ($root)" }
$run = Save-KspRun -InstallRoot $root -ArchiveRoot $target.Runs -Since $started
$routeLines = Select-String -Path $kspLog -SimpleMatch '[TMinusRoute] ' | ForEach-Object { $_.Line }
$failure = $routeLines | Where-Object { $_ -match '\[TMinusRoute\] FAILED' } | Select-Object -First 1
$route = if ($timedOut) { "timed out after $TimeoutMinutes min, KSP killed" } elseif ($failure) { $failure -replace '^.*\[TMinusRoute\] ', '' } elseif ($routeLines -match '\[TMinusRoute\] done') { 'done' } else { 'KSP quit before the route finished' }
@(
    "install:   KSP-$Install ($root)"
    "commit:    $commit$dirty"
    "switches:  $switchText"
    "save:      $save, restored from $($target.Snapshot)"
    "started:   $($started.ToString('yyyy-MM-dd HH:mm:ss')), $([Math]::Round($minutes, 1)) min"
    "route:     $route"
    ''
    $routeLines
) | Set-Content -Encoding utf8 (Join-Path $run 'conditions.txt')

# 7. Analyze and check.
node (Join-Path $repo 'tools\analyze\dist\cli\analyze.js') $run | Set-Content -Encoding utf8 (Join-Path $run 'report.md')
$check = node (Join-Path $repo 'tools\analyze\dist\cli\check-archived.js') $Expectations 2>&1
$mine = $false
$checkLines = @(foreach ($line in $check) {
    if ($line -match '^(ok  |FAIL) ') { $mine = $line.Contains($run) }
    if ($mine) { $line }
})

Write-Host "Run:    $run"
Write-Host "Route:  $route ($([Math]::Round($minutes, 1)) min)"
$checkLines | ForEach-Object { Write-Host "Check:  $_" }
$passed = ($route -eq 'done') -and $checkLines -and ($checkLines[0] -like 'ok*')
exit $(if ($passed) { 0 } else { 1 })
