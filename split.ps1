Set-StrictMode -Off
$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot

# Read source
[string[]]$L = [System.IO.File]::ReadAllLines("$repo\index.html", [System.Text.Encoding]::UTF8)
$N = $L.Count
Write-Host "Read $N lines from index.html"

# Find CSS block
$cssStart = -1; $cssEnd = -1
for ($i = 0; $i -lt $N; $i++) {
    if ($L[$i].Trim() -eq '<style>')   { $cssStart = $i + 1 }
    if ($cssStart -ge 0 -and $L[$i].Trim() -eq '</style>') { $cssEnd = $i; break }
}
if ($cssStart -lt 0 -or $cssEnd -lt 0) { throw "Cannot find <style> block" }

# Find main <script> block
$jsStart = -1; $jsEnd = -1
for ($i = 2000; $i -lt $N; $i++) {
    if ($L[$i].Trim() -eq '<script>') { $jsStart = $i + 1; break }
}
for ($i = $jsStart; $i -lt $N; $i++) {
    if ($L[$i].Trim() -eq '</script>') { $jsEnd = $i; break }
}
if ($jsStart -lt 0 -or $jsEnd -lt 0) { throw "Cannot find main <script> block" }

$jsLines = $L[$jsStart..($jsEnd - 1)]
Write-Host "JS block: lines $jsStart to $jsEnd ($($jsLines.Count) lines)"

# Section-marker detection
# Real markers: start at column 0 (//) with >= 6 box-drawing chars (U+2500, en/em dash)
$BOX = [char]0x2500
$EN  = [char]0x2013
$EM  = [char]0x2014

function Test-SectionMarker([string]$line) {
    if (-not $line.StartsWith('//')) { return $false }
    $count = 0
    foreach ($c in $line.ToCharArray()) {
        if ($c -eq $script:BOX -or $c -eq $script:EN -or $c -eq $script:EM) { $count++ }
    }
    return $count -ge 4
}

function Get-SectionName([string]$line) {
    $s = $line -replace '^//\s*', ''
    # Remove box-drawing chars and dashes, then trim
    $chars = $s.ToCharArray() | Where-Object {
        $_ -ne $script:BOX -and $_ -ne $script:EN -and $_ -ne $script:EM -and
        [int]$_ -ne 0x2015 -and [int]$_ -ne 0x2501
    }
    return (-join $chars).Trim()
}

# Routing table
$ROUTES = [ordered]@{
    # Sync entries come before 'Config' to prevent substring mismatch
    'Multi-Device Config Sync'                               = 'js/sync.js'
    'Config Sync Core'                                       = 'js/sync.js'
    'Config'                                                 = 'js/config.js'
    'State'                                                  = 'js/config.js'
    'Global State'                                           = 'js/config.js'
    'Queue Persistence'                                      = 'js/queue.js'
    'Queue History Browser'                                  = 'js/queue.js'
    'Queue (Front Desk)'                                     = 'js/queue.js'
    'Manual Add Modal'                                       = 'js/queue.js'
    'Edit Check-In'                                          = 'js/queue.js'
    'Queue Assign Modal'                                     = 'js/queue.js'
    'Edit Services Modal'                                    = 'js/queue.js'
    'Group Assign Modal'                                     = 'js/queue.js'
    'Split Modal'                                            = 'js/queue.js'
    'Merge Select Modal'                                     = 'js/queue.js'
    'Init'                                                   = 'js/app.js'
    'Daily Midnight Reset'                                   = 'js/app.js'
    'Navigation'                                             = 'js/app.js'
    'Dashboard Panel Switching'                              = 'js/app.js'
    'App Version & Data Preservation'                        = 'js/app.js'
    'Version freshness check'                                = 'js/app.js'
    'Guest Card Builder'                                     = 'js/checkin.js'
    'Check-In Submission'                                    = 'js/checkin.js'
    'Services CRUD'                                          = 'js/catalog.js'
    'Dashboard service visibility'                           = 'js/catalog.js'
    'Items settings render'                                  = 'js/catalog.js'
    'Fees settings render'                                   = 'js/catalog.js'
    'Staff CRUD'                                             = 'js/staff.js'
    'Schedule Calendar'                                      = 'js/staff.js'
    'Per-Service Status Helpers'                             = 'js/turns.js'
    'Turns Tab'                                              = 'js/turns.js'
    'Turn Suggestion Engine'                                 = 'js/turns.js'
    'Tech Status Menu'                                       = 'js/turns.js'
    'Undo Stack'                                             = 'js/turns.js'
    'Updated setupTurnsDragDrop'                             = 'js/turns.js'
    'Drag & Drop'                                            = 'js/turns.js'
    'Turns'                                                  = 'js/turns.js'
    'Reports'                                                = 'js/reports.js'
    'Shared record merge helper'                             = 'js/reports.js'
    'Report Range'                                           = 'js/reports.js'
    'Report Drill-Down'                                      = 'js/reports.js'
    'Transactions History'                                   = 'js/reports.js'
    'Sheets Report Export'                                   = 'js/reports.js'
    'Historical Transaction Entry'                           = 'js/reports.js'
    'Google Calendar Integration'                            = 'js/calendar.js'
    'Calendar Hours Setting'                                 = 'js/calendar.js'
    'Silent calendar sync'                                   = 'js/calendar.js'
    'Cross-device token sharing via Sheets'                  = 'js/calendar.js'
    'New / Edit Appointment Modal'                           = 'js/calendar.js'
    'Appointment modal autocomplete'                         = 'js/calendar.js'
    'Appointment extra guests'                               = 'js/calendar.js'
    'Calendar column reorder'                                = 'js/calendar.js'
    'Square Customer Autocomplete'                           = 'js/square.js'
    'Customer Directory'                                     = 'js/square.js'
    'Square Appointments Sync'                               = 'js/square.js'
    'Load gift cards from Gift Cards tab in Sheets'          = 'js/sync.js'
    'Gift Cards'                                             = 'js/giftcards.js'
    'Gift Card Sort/Filter'                                  = 'js/giftcards.js'
    'Logo Upload & Crop'                                     = 'js/photos.js'
    'Photo Storage'                                          = 'js/photos.js'
    'Photo Crop'                                             = 'js/photos.js'
    'Logged-in User Display'                                 = 'js/auth.js'
    'PIN Modal'                                              = 'js/auth.js'
    'Front Desk Users CRUD'                                  = 'js/auth.js'
    'Google Sheets Export'                                   = 'js/sync.js'
    'Auto-update existing Sheets row'                        = 'js/sync.js'
    'Load historical records from Transaction Log in Sheets' = 'js/sync.js'
    'allRecords cross-device sync'                           = 'js/sync.js'
    'allRecords event-driven push'                           = 'js/sync.js'
    'Clock'                                                  = 'js/utils.js'
    'Auto Capitalize'                                        = 'js/utils.js'
    'Deduplication helper'                                   = 'js/utils.js'
    'Local Date Helper'                                      = 'js/utils.js'
    'Elapsed Time Timer'                                     = 'js/utils.js'
    'Phone Formatting'                                       = 'js/utils.js'
    'Numeric Keypad'                                         = 'js/utils.js'
    'Toast'                                                  = 'js/utils.js'
    'Settings Panel'                                         = 'js/settings.js'
    'Staff & Service Visibility'                             = 'js/settings.js'
    'First-Time Setup Wizard'                                = 'js/settings.js'
    'Settings embedded panels'                               = 'js/settings.js'
    'Audit Log'                                              = 'js/settings.js'
}

function Get-Target([string]$name) {
    foreach ($key in $ROUTES.Keys) {
        if ($name.Contains($key)) { return $ROUTES[$key] }
    }
    return $null
}

# Split JS into sections
$sections  = [System.Collections.Generic.List[hashtable]]::new()
$curName   = '__preamble__'
$curTarget = $null
$curBuf    = [System.Collections.Generic.List[string]]::new()

foreach ($line in $jsLines) {
    if (Test-SectionMarker $line) {
        if ($curBuf.Count -gt 0) {
            $sections.Add(@{ name = $curName; target = $curTarget; lines = $curBuf.ToArray() })
        }
        $curName   = Get-SectionName $line
        $curTarget = Get-Target $curName
        $curBuf    = [System.Collections.Generic.List[string]]::new()
        [void]$curBuf.Add($line)
    } else {
        [void]$curBuf.Add($line)
    }
}
if ($curBuf.Count -gt 0) {
    $sections.Add(@{ name = $curName; target = $curTarget; lines = $curBuf.ToArray() })
}

# Report unmapped
$unmapped = $sections | Where-Object { -not $_.target -and $_.name -ne '__preamble__' }
if ($unmapped) {
    Write-Warning "UNMAPPED SECTIONS (lines will be dropped):"
    foreach ($u in $unmapped) { Write-Warning "  '$($u.name)' ($($u.lines.Count) lines)" }
}

# Collect content per output file
$fileContents = @{}
foreach ($s in $sections) {
    if (-not $s.target) { continue }
    if (-not $fileContents.ContainsKey($s.target)) {
        $fileContents[$s.target] = [System.Collections.Generic.List[string]]::new()
    }
    $fileContents[$s.target].AddRange([string[]]$s.lines)
    [void]$fileContents[$s.target].Add('')
}

# Write output files
$FILE_ORDER = @(
    'js/utils.js', 'js/config.js', 'js/sync.js', 'js/photos.js',
    'js/auth.js',  'js/catalog.js', 'js/square.js', 'js/staff.js',
    'js/checkin.js', 'js/queue.js', 'js/turns.js', 'js/reports.js',
    'js/giftcards.js', 'js/calendar.js', 'js/settings.js', 'js/app.js'
)

[void](New-Item -ItemType Directory -Force -Path "$repo\css")
[void](New-Item -ItemType Directory -Force -Path "$repo\js")

# CSS
$cssContent = ($L[$cssStart..($cssEnd - 1)] -join "`n") + "`n"
[System.IO.File]::WriteAllText("$repo\css\styles.css", $cssContent, [System.Text.Encoding]::UTF8)
Write-Host "OK css/styles.css ($($cssEnd - $cssStart) lines)"

# JS files
foreach ($file in $FILE_ORDER) {
    $fpath = "$repo\$($file -replace '/', '\')"
    if ($fileContents.ContainsKey($file)) {
        $content = ($fileContents[$file].ToArray() -join "`n") + "`n"
        [System.IO.File]::WriteAllText($fpath, $content, [System.Text.Encoding]::UTF8)
        Write-Host ("OK " + $file.PadRight(22) + " ($($fileContents[$file].Count) lines)")
    } else {
        Write-Warning "$file -- no sections routed here"
    }
}

# Rewrite index.html
$newLines = [System.Collections.Generic.List[object]]::new()
for ($i = 0; $i -lt $L.Count; $i++) { [void]$newLines.Add($L[$i]) }

$newLines[$cssStart - 1] = '  <link rel="stylesheet" href="css/styles.css">'
for ($i = $cssStart; $i -le $cssEnd; $i++) { $newLines[$i] = $null }

$scriptTags = ($FILE_ORDER | ForEach-Object { "<script src=`"$_`"></script>" }) -join "`n"
$newLines[$jsStart - 1] = $scriptTags
for ($i = $jsStart; $i -le $jsEnd; $i++) { $newLines[$i] = $null }

$newHtml = ($newLines | Where-Object { $_ -ne $null }) -join "`n"
[System.IO.File]::WriteAllText("$repo\index.html", $newHtml, [System.Text.Encoding]::UTF8)
Write-Host "OK index.html updated"

# Summary
$mappedLines = 0
foreach ($s in $sections) { if ($s.target) { $mappedLines += $s.lines.Count } }
Write-Host ""
Write-Host "JS lines -- total: $($jsLines.Count)  mapped: $mappedLines  delta: $($jsLines.Count - $mappedLines)"
Write-Host ""
Write-Host "Sections per file:"
foreach ($file in $FILE_ORDER) {
    $names = ($sections | Where-Object { $_.target -eq $file } | ForEach-Object { $_.name }) -join ', '
    if ($names) { Write-Host "  ${file}: $names" }
}
