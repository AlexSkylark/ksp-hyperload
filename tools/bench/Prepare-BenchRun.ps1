<#
.SYNOPSIS
    Prepares KSP-bench for one benchmark run.

.DESCRIPTION
    0. Archives the previous run's KSP.log, Player.log and profiler .jsonl to
       D:\KSP\bench-runs\<time of that run>\ (KSP overwrites its logs).
    1. Restores the dedicated save (saves\hyperload-bench) from its reference
       copy, so every run starts from the same state. Only that save folder is
       touched; the bench's other saves are never modified.
    2. Sets the T-Minus profiler switches in
       GameData\000_TMinus\PluginData\Settings.cfg.
    3. Prints the conditions to record with the result.

    Then launch KSP_x64.exe from the bench folder yourself.

.PARAMETER Profiler
    On: profiler enabled (default). Off: T-Minus loads but records nothing
    (baseline for overhead runs).

.PARAMETER NoStartHooks
    Turn off the per-addon Start() hooks (on by default since 2026-10-16), to
    compare with a run made before that or to measure their cost.

.PARAMETER Set
    Extra Settings.cfg switches for this run, e.g. @{ harmonyCallHooks = 'true' }.
    Each key must already be in the installed Settings.cfg.

.EXAMPLE
    .\Prepare-BenchRun.ps1
    .\Prepare-BenchRun.ps1 -Profiler Off
    .\Prepare-BenchRun.ps1 -Set @{ harmonyCallHooks = 'true' }
#>
[CmdletBinding()]
param(
    [ValidateSet('On', 'Off')]
    [string]$Profiler = 'On',
    [switch]$NoStartHooks,
    [hashtable]$Set = @{},
    [string]$BenchRoot = 'D:\KSP\KSP-bench',
    [string]$SaveSnapshot = 'D:\KSP\bench-saves\hyperload-bench',
    [string]$ArchiveRoot = 'D:\KSP\bench-runs'
)

$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot '..\run\KspRuns.psm1') -Force

$saveTarget = Join-Path $BenchRoot 'saves\hyperload-bench'

if (-not (Test-Path (Join-Path $BenchRoot 'KSP_x64.exe'))) { throw "Not a KSP install: $BenchRoot" }
if (Get-Process -Name 'KSP_x64' -ErrorAction SilentlyContinue) { throw 'KSP is running. Close it first.' }

# 0. Archive the previous run's logs: KSP overwrites them on the next launch.
#    Folder named after KSP.log's last write time, so re-running is harmless.
$archived = Save-KspRun -InstallRoot $BenchRoot -ArchiveRoot $ArchiveRoot

# 1. Restore the save: an exact copy of the snapshot, only this one folder.
Restore-KspSave -Snapshot $SaveSnapshot -Target $saveTarget

# 2. Profiler switches.
$enabled = if ($Profiler -eq 'On') { 'true' } else { 'false' }
$start = if ($NoStartHooks) { 'false' } else { 'true' }
$switches = @{ enabled = $enabled; addonStartHooks = $start }
foreach ($k in $Set.Keys) { $switches[$k] = "$($Set[$k])".ToLowerInvariant() }
Set-TMinusSettings -InstallRoot $BenchRoot -Values $switches

# 3. Conditions to record.
$uptime = (Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
$dll = Get-Item (Join-Path $BenchRoot 'GameData\000_TMinus\Plugins\TMinus.dll')

Write-Host "Bench ready."
if ($archived) { Write-Host "  Previous run:    logs archived in $archived" }
Write-Host "  Save restored:   $saveTarget"
Write-Host "  Profiler:        $Profiler (addonStartHooks = $start)"
foreach ($k in $Set.Keys) { Write-Host "  Switch:          $k = $($switches[$k])" }
Write-Host "  TMinus.dll:      $($dll.LastWriteTime.ToString('yyyy-MM-dd HH:mm'))"
Write-Host ("  System uptime:   {0:%d}d {0:hh}h {0:mm}m (OS file cache: {1})" -f $uptime, $(if ($uptime.TotalMinutes -lt 10) { 'likely cold' } else { 'warm' }))
Write-Host ''
Write-Host 'Keep the machine idle while KSP runs (no uploads, downloads, games or builds).'

exit 0
