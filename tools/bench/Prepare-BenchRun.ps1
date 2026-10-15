<#
.SYNOPSIS
    Prepares KSP-bench for one benchmark run.

.DESCRIPTION
    0. Archives the previous run's KSP.log, Player.log and profiler .jsonl to
       D:\KSP\bench-runs\<time of that run>\ (KSP overwrites its logs).
    1. Restores the dedicated save (saves\hyperload-bench) from its reference
       copy, so every run starts from the same state. Only that save folder is
       touched; the bench's other saves are never modified.
    2. Sets the HyperLoad profiler switches in
       GameData\000_HyperLoad\PluginData\Settings.cfg.
    3. Prints the conditions to record with the result.

    Then launch KSP_x64.exe from the bench folder yourself.

.PARAMETER Profiler
    On: profiler enabled (default). Off: HyperLoad loads but records nothing
    (baseline for overhead runs).

.PARAMETER StartHooks
    Enable the diagnostic per-addon Start() hooks. They patch mod code: never
    use them for timing or overhead runs.

.EXAMPLE
    .\Prepare-BenchRun.ps1
    .\Prepare-BenchRun.ps1 -Profiler Off
#>
[CmdletBinding()]
param(
    [ValidateSet('On', 'Off')]
    [string]$Profiler = 'On',
    [switch]$StartHooks,
    [string]$BenchRoot = 'D:\KSP\KSP-bench',
    [string]$SaveSnapshot = 'D:\KSP\bench-saves\hyperload-bench',
    [string]$ArchiveRoot = 'D:\KSP\bench-runs'
)

$ErrorActionPreference = 'Stop'

$saveTarget = Join-Path $BenchRoot 'saves\hyperload-bench'
$settings = Join-Path $BenchRoot 'GameData\000_HyperLoad\PluginData\Settings.cfg'

if (-not (Test-Path (Join-Path $BenchRoot 'KSP_x64.exe'))) { throw "Not a KSP install: $BenchRoot" }
if (-not (Test-Path (Join-Path $SaveSnapshot 'persistent.sfs'))) { throw "Save snapshot missing: $SaveSnapshot" }
if (-not (Test-Path $settings)) { throw "HyperLoad not installed in the bench: $settings" }
if (Get-Process -Name 'KSP_x64' -ErrorAction SilentlyContinue) { throw 'KSP is running. Close it first.' }

# 0. Archive the previous run's logs: KSP overwrites them on the next launch.
#    Folder named after KSP.log's last write time, so re-running is harmless.
$kspLog = Join-Path $BenchRoot 'KSP.log'
$archived = $null
if (Test-Path $kspLog) {
    $archived = Join-Path $ArchiveRoot (Get-Item $kspLog).LastWriteTime.ToString('yyyyMMdd-HHmmss')
    if (-not (Test-Path $archived)) {
        New-Item -ItemType Directory -Force $archived | Out-Null
        Copy-Item $kspLog $archived
        $playerLog = Join-Path $env:USERPROFILE 'AppData\LocalLow\Squad\Kerbal Space Program\Player.log'
        if (Test-Path $playerLog) { Copy-Item $playerLog $archived }
        $lastJsonl = Get-ChildItem (Join-Path $BenchRoot 'GameData\000_HyperLoad\PluginData\Profiler') -Filter *.jsonl -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime | Select-Object -Last 1
        if ($lastJsonl) { Copy-Item $lastJsonl.FullName $archived }
    }
}

# 1. Restore the save. /MIR makes the target an exact copy (removes files the
#    last run added, e.g. quicksaves); it only ever touches this one folder.
robocopy $SaveSnapshot $saveTarget /MIR /NJH /NJS /NFL /NDL /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }

# 2. Profiler switches.
$enabled = if ($Profiler -eq 'On') { 'true' } else { 'false' }
$start = if ($StartHooks) { 'true' } else { 'false' }
$text = Get-Content -Raw $settings
$text = $text -replace '(?m)^(\s*enabled\s*=\s*)\w+', "`${1}$enabled"
$text = $text -replace '(?m)^(\s*addonStartHooks\s*=\s*)\w+', "`${1}$start"
Set-Content -NoNewline -Encoding utf8 -Path $settings -Value $text

# 3. Conditions to record.
$uptime = (Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
$dll = Get-Item (Join-Path $BenchRoot 'GameData\000_HyperLoad\Plugins\HyperLoad.dll')

Write-Host "Bench ready."
if ($archived) { Write-Host "  Previous run:    logs archived in $archived" }
Write-Host "  Save restored:   $saveTarget"
Write-Host "  Profiler:        $Profiler (addonStartHooks = $start)"
Write-Host "  HyperLoad.dll:   $($dll.LastWriteTime.ToString('yyyy-MM-dd HH:mm'))"
Write-Host ("  System uptime:   {0:%d}d {0:hh}h {0:mm}m (OS file cache: {1})" -f $uptime, $(if ($uptime.TotalMinutes -lt 10) { 'likely cold' } else { 'warm' }))
Write-Host ''
Write-Host 'Keep the machine idle while KSP runs (no uploads, downloads, games or builds).'
