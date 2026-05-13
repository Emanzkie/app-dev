# extract-inline-js.ps1
# Extracts inline <script>...</script> blocks from HTML files into external JS files
# and replaces them with <script src="..."></script> references.

param(
    [string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent)
)

$ErrorActionPreference = 'Stop'

# Configuration: map each HTML file to its output JS path and role directory
$mappings = @(
    # === AUTH ===
    @{ Html = "SIGN-UP,LOGIN\landing.html";       Js = "js\auth\landing.js" }
    @{ Html = "SIGN-UP,LOGIN\login.html";         Js = "js\auth\login.js" }
    @{ Html = "SIGN-UP,LOGIN\signup.html";        Js = "js\auth\signup.js" }
    @{ Html = "SIGN-UP,LOGIN\verify-email.html";  Js = "js\auth\verify-email.js" }

    # === PARENT ===
    @{ Html = "PARENT\dashboard.html";            Js = "js\parent\dashboard.js" }
    @{ Html = "PARENT\profile.html";              Js = "js\parent\profile.js" }
    @{ Html = "PARENT\screening.html";            Js = "js\parent\screening.js" }
    @{ Html = "PARENT\results.html";              Js = "js\parent\results.js" }
    @{ Html = "PARENT\recommendations.html";      Js = "js\parent\recommendations.js" }
    @{ Html = "PARENT\appointments.html";         Js = "js\parent\appointments.js" }
    @{ Html = "PARENT\chat.html";                 Js = "js\parent\chat.js" }
    @{ Html = "PARENT\settings.html";             Js = "js\parent\settings.js" }
    @{ Html = "PARENT\custom-questions.html";     Js = "js\parent\custom-questions.js" }

    # === PEDIA ===
    @{ Html = "PEDIA\pediatrician-dashboard.html";     Js = "js\pedia\pediatrician-dashboard.js" }
    @{ Html = "PEDIA\pediatrician-patients.html";      Js = "js\pedia\pediatrician-patients.js" }
    @{ Html = "PEDIA\pediatrician-appointments.html";  Js = "js\pedia\pediatrician-appointments.js" }
    @{ Html = "PEDIA\pediatrician-settings.html";      Js = "js\pedia\pediatrician-settings.js" }
    @{ Html = "PEDIA\pediatrician-profile.html";       Js = "js\pedia\pediatrician-profile.js" }
    @{ Html = "PEDIA\pedia-questions.html";            Js = "js\pedia\pedia-questions.js" }
    @{ Html = "PEDIA\pedia-chat.html";                 Js = "js\pedia\pedia-chat.js" }

    # === SECRETARY ===
    @{ Html = "SECRETARY\secretary-dashboard.html";     Js = "js\secretary\secretary-dashboard.js" }
    @{ Html = "SECRETARY\secretary-appointments.html";  Js = "js\secretary\secretary-appointments.js" }
    @{ Html = "SECRETARY\secretary-approval.html";      Js = "js\secretary\secretary-approval.js" }
    @{ Html = "SECRETARY\secretary-patients.html";      Js = "js\secretary\secretary-patients.js" }

    # === ADMIN ===
    @{ Html = "ADMIN\admin-dashboard.html";   Js = "js\admin\admin-dashboard.js" }
    @{ Html = "ADMIN\admin-users.html";       Js = "js\admin\admin-users.js" }
    @{ Html = "ADMIN\admin-settings.html";    Js = "js\admin\admin-settings.js" }
    @{ Html = "ADMIN\admin-analytics.html";   Js = "js\admin\admin-analytics.js" }
    @{ Html = "ADMIN\admin-reports.html";     Js = "js\admin\admin-reports.js" }
    @{ Html = "ADMIN\admin-training.html";    Js = "js\admin\admin-training.js" }
)

$totalExtracted = 0
$totalFailed = 0

foreach ($mapping in $mappings) {
    $htmlPath = Join-Path $ProjectRoot $mapping.Html
    $jsPath   = Join-Path $ProjectRoot $mapping.Js

    if (-not (Test-Path $htmlPath)) {
        Write-Host "SKIP: $($mapping.Html) not found" -ForegroundColor Yellow
        continue
    }

    Write-Host "`nProcessing: $($mapping.Html)" -ForegroundColor Cyan

    # Read file content as a single string to handle multi-line regex
    $content = [System.IO.File]::ReadAllText($htmlPath)

    # Find all inline <script>...</script> blocks (not ones with src="...")
    # We use a regex that matches <script> tags WITHOUT src attribute
    $pattern = '(?s)(\s*)<script>(.*?)</script>'
    $matches_found = [regex]::Matches($content, $pattern)

    if ($matches_found.Count -eq 0) {
        Write-Host "  No inline scripts found." -ForegroundColor Yellow
        continue
    }

    # Collect all inline script content
    $jsContent = @()
    $scriptCount = 0

    foreach ($match in $matches_found) {
        $scriptBody = $match.Groups[2].Value.Trim()
        if ($scriptBody.Length -gt 0) {
            $jsContent += "// === Extracted from $($mapping.Html) (script block $($scriptCount + 1)) ==="
            $jsContent += $scriptBody
            $jsContent += ""
            $scriptCount++
        }
    }

    if ($scriptCount -eq 0) {
        Write-Host "  Only empty inline scripts found, skipping." -ForegroundColor Yellow
        continue
    }

    # Write the combined JS content to the external file
    $jsOutput = $jsContent -join "`r`n"
    [System.IO.File]::WriteAllText($jsPath, $jsOutput, [System.Text.Encoding]::UTF8)
    Write-Host "  Created: $($mapping.Js) ($scriptCount script block(s), $($jsOutput.Length) chars)" -ForegroundColor Green

    # Now replace inline scripts in the HTML with a single external reference
    # Strategy:
    #   1. Remove all inline <script>...</script> blocks
    #   2. Add a single <script src="/js/..."></script> reference before </body>

    $newContent = $content

    # Remove inline script blocks (preserve <script src="..."></script> tags)
    foreach ($match in $matches_found) {
        $scriptBody = $match.Groups[2].Value.Trim()
        if ($scriptBody.Length -gt 0) {
            $newContent = $newContent.Replace($match.Value, '')
        }
    }

    # Build the script src path (always absolute from root since static serves from __dirname)
    $jsSrcPath = "/" + ($mapping.Js -replace '\\', '/')

    # Find the position to insert the script tag (before </body>)
    # We need to add it before any existing external script tags that come right before </body>
    # or just before </body>

    # Check if there's already a reference to this JS file
    if ($newContent -notmatch [regex]::Escape($jsSrcPath)) {
        # Insert before </body>
        $insertTag = "<script src=`"$jsSrcPath`"></script>`r`n"
        
        # Find the best insertion point - before existing trailing external scripts or before </body>
        # Look for the pattern of </body> and insert before it
        $bodyClosePattern = '</body>'
        $bodyCloseIdx = $newContent.LastIndexOf($bodyClosePattern)
        
        if ($bodyCloseIdx -ge 0) {
            $newContent = $newContent.Insert($bodyCloseIdx, $insertTag)
        }
    }

    # Clean up any resulting multiple blank lines
    $newContent = [regex]::Replace($newContent, '(\r?\n){3,}', "`r`n`r`n")

    # Write updated HTML
    [System.IO.File]::WriteAllText($htmlPath, $newContent, [System.Text.Encoding]::UTF8)
    Write-Host "  Updated: $($mapping.Html) (inline scripts removed, external ref added)" -ForegroundColor Green
    $totalExtracted++
}

Write-Host "`n============================================" -ForegroundColor White
Write-Host "Extraction complete: $totalExtracted files processed" -ForegroundColor Green
if ($totalFailed -gt 0) {
    Write-Host "Failed: $totalFailed files" -ForegroundColor Red
}
