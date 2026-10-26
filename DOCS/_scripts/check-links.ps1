# Obsidian wikilink checker for the DOCS vault.
# Usage: powershell -ExecutionPolicy Bypass -File C:\dev\food\DOCS\_scripts\check-links.ps1
# - Reports broken [[wikilinks]] (target note not found) and duplicate note basenames.
# - Skips fenced code blocks and inline code.
# - Excludes folders: .obsidian, _templates (placeholders), 99_Archive (legacy, report only as info).
# Exit code: 0 = no broken links, 1 = broken links or duplicates found.
param(
    [string]$Vault = (Split-Path -Parent $PSScriptRoot)
)

[Console]::OutputEncoding = [Text.Encoding]::UTF8
$excludeDirs = @('.obsidian', '_templates', '99_Archive', '_scripts')

$allMd = Get-ChildItem -Path $Vault -Recurse -File -Filter *.md |
    Where-Object { $_.FullName -notmatch '\\\.obsidian\\' }

# Index notes by basename (Obsidian resolves by shortest unique name)
$index = @{}
foreach ($f in $allMd) {
    $key = $f.BaseName.ToLowerInvariant()
    if (-not $index.ContainsKey($key)) { $index[$key] = @() }
    $index[$key] += $f.FullName
}
# Also allow non-md attachments by full file name
$allFiles = Get-ChildItem -Path $Vault -Recurse -File | Where-Object { $_.FullName -notmatch '\\\.obsidian\\' }
$attachments = @{}
foreach ($f in $allFiles) { $attachments[$f.Name.ToLowerInvariant()] = $true }

$broken = @()
$linkCount = 0
$checkedFiles = 0

foreach ($f in $allMd) {
    $rel = $f.FullName.Substring($Vault.Length).TrimStart('\')
    $top = $rel.Split('\')[0]
    if ($excludeDirs -contains $top) { continue }
    $checkedFiles++
    $text = [IO.File]::ReadAllText($f.FullName, [Text.Encoding]::UTF8)
    # strip fenced code blocks and inline code
    $text = [regex]::Replace($text, '(?ms)^```.*?^```', '')
    $text = [regex]::Replace($text, '`[^`\r\n]*`', '')
    foreach ($m in [regex]::Matches($text, '!?\[\[([^\]\r\n]+?)\]\]')) {
        $linkCount++
        $raw = $m.Groups[1].Value
        $target = ($raw -split '\|')[0]
        $target = ($target -split '#')[0].Trim()
        if ($target -eq '') { continue }   # same-note heading link
        $name = Split-Path -Leaf ($target -replace '/', '\')
        $key = $name.ToLowerInvariant()
        if ($key.EndsWith('.md')) { $key = $key.Substring(0, $key.Length - 3) }
        if ($index.ContainsKey($key) -or $attachments.ContainsKey($name.ToLowerInvariant())) { continue }
        $broken += [pscustomobject]@{ File = $rel; Link = $raw }
    }
}

$dupes = $index.GetEnumerator() | Where-Object { $_.Value.Count -gt 1 }

Write-Output ("Vault: {0}" -f $Vault)
Write-Output ("Checked files: {0}, wikilinks: {1}" -f $checkedFiles, $linkCount)
if ($broken.Count -gt 0) {
    Write-Output ("BROKEN LINKS: {0}" -f $broken.Count)
    $broken | Format-Table -AutoSize | Out-String -Width 300 | Write-Output
} else {
    Write-Output "Broken links: 0"
}
if ($dupes) {
    Write-Output "DUPLICATE NOTE NAMES:"
    foreach ($d in $dupes) { Write-Output ("  {0}: {1}" -f $d.Key, ($d.Value -join ' | ')) }
} else {
    Write-Output "Duplicate note names: 0"
}
if ($broken.Count -gt 0 -or $dupes) { exit 1 } else { exit 0 }
