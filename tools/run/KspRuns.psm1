<#
    Shared helpers for the run scripts (tools/bench/Prepare-BenchRun.ps1,
    tools/run/Invoke-Run.ps1): archiving one KSP session's logs and profiler
    output into a run folder.
#>

$PlayerLog = Join-Path $env:USERPROFILE 'AppData\LocalLow\Squad\Kerbal Space Program\Player.log'

<#
.SYNOPSIS
    Copies the last session's KSP.log, Player.log and profiler .jsonl into
    <ArchiveRoot>\<time KSP.log was last written>\ and returns that folder
    ($null when the install has no KSP.log). An existing folder is left as it
    is, so archiving the same session twice is harmless.

.PARAMETER Since
    Start time of the session, when known: only a .jsonl written after it
    belongs to the session. Without it, the .jsonl must have been written
    within 120 s of KSP.log (both are last written when KSP quits). A session
    with the profiler off has no .jsonl, and an older one must never be filed
    under it.
#>
function Save-KspRun {
    param(
        [Parameter(Mandatory)] [string]$InstallRoot,
        [Parameter(Mandatory)] [string]$ArchiveRoot,
        [datetime]$Since
    )
    $kspLog = Join-Path $InstallRoot 'KSP.log'
    if (-not (Test-Path $kspLog)) { return $null }

    $logTime = (Get-Item $kspLog).LastWriteTime
    $folder = Join-Path $ArchiveRoot $logTime.ToString('yyyyMMdd-HHmmss')
    if (Test-Path $folder) { return $folder }

    New-Item -ItemType Directory -Force $folder | Out-Null
    Copy-Item $kspLog $folder
    if (Test-Path $PlayerLog) { Copy-Item $PlayerLog $folder }

    $jsonl = Get-ChildItem (Join-Path $InstallRoot 'GameData\000_TMinus\PluginData\Profiler') -Filter *.jsonl -ErrorAction SilentlyContinue |
        Where-Object { if ($PSBoundParameters.ContainsKey('Since')) { $_.LastWriteTime -ge $Since } else { [Math]::Abs(($_.LastWriteTime - $logTime).TotalSeconds) -le 120 } } |
        Sort-Object LastWriteTime | Select-Object -Last 1
    if ($jsonl) { Copy-Item $jsonl.FullName $folder }
    return $folder
}

<#
.SYNOPSIS
    Sets switches in T-Minus's Settings.cfg (key = value lines), leaving the
    rest of the file untouched. Fails on a key the file does not have.
#>
function Set-TMinusSettings {
    param(
        [Parameter(Mandatory)] [string]$InstallRoot,
        [Parameter(Mandatory)] [hashtable]$Values
    )
    $settings = Join-Path $InstallRoot 'GameData\000_TMinus\PluginData\Settings.cfg'
    if (-not (Test-Path $settings)) { throw "T-Minus not installed: $settings" }
    $text = Get-Content -Raw $settings
    foreach ($key in $Values.Keys) {
        $pattern = "(?m)^(\s*$([regex]::Escape($key))\s*=\s*)\w+"
        if ($text -notmatch $pattern) { throw "Settings.cfg has no '$key'" }
        $text = $text -replace $pattern, "`${1}$($Values[$key])"
    }
    Set-Content -NoNewline -Encoding utf8 -Path $settings -Value $text
}

<#
.SYNOPSIS
    Makes a save folder an exact copy of its snapshot (robocopy /MIR: also
    removes files the last run added, e.g. quicksaves and launched crafts).
    Only ever touches that one folder.
#>
function Restore-KspSave {
    param(
        [Parameter(Mandatory)] [string]$Snapshot,
        [Parameter(Mandatory)] [string]$Target
    )
    if (-not (Test-Path (Join-Path $Snapshot 'persistent.sfs'))) { throw "Save snapshot missing: $Snapshot" }
    robocopy $Snapshot $Target /MIR /NJH /NJS /NFL /NDL /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }
    $global:LASTEXITCODE = 0
}

Export-ModuleMember -Function Save-KspRun, Set-TMinusSettings, Restore-KspSave
