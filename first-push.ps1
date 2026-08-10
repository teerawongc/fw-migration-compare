# first-push.ps1 - push project to GitHub (run once)
#
# Usage (PowerShell in this folder):
#   powershell -ExecutionPolicy Bypass -File .\first-push.ps1
#
# NOTE: ASCII only on purpose. Windows PowerShell 5.1 reads .ps1 files as ANSI,
# so Thai characters get mangled and break the parser.
#
# After this, just use: git add -A ; git commit -m "..." ; git push
# You can delete this file afterwards.

Set-Location $PSScriptRoot
$ErrorActionPreference = 'Continue'

$RepoUrl = 'https://github.com/teerawongc/fw-migration-compare.git'

function Say($msg, $color = 'Cyan') { Write-Host $msg -ForegroundColor $color }

# --- 1. Clean up incomplete .git ------------------------------------------
# (left behind by a sandbox that could not delete files; no commits yet so
#  removing it is safe)
if (Test-Path .git) {
    git rev-parse --verify HEAD 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Say "Existing commits found - keeping .git" 'Yellow'
    } else {
        Say "Removing incomplete .git ..."
        Remove-Item .git -Recurse -Force
    }
}

# --- 2. git identity ------------------------------------------------------
$who = git config --global user.email
if (-not $who) {
    git config --global user.email "teerawong.c@gmail.com"
    git config --global user.name  "Teerawong Chomosot"
    Say "git identity configured"
}

# --- 3. init + stage ------------------------------------------------------
if (-not (Test-Path .git)) {
    git init -b main | Out-Null
    if ($LASTEXITCODE -ne 0) { git init | Out-Null; git branch -M main }
}
git add -A

Write-Host ""
Say "=== Files going to GitHub ===" 'Green'
git diff --cached --name-only
Write-Host ""

# Safety net: never push real firewall exports (customer IPs / full policy)
$danger = git diff --cached --name-only |
    Where-Object { $_ -match '\.(xml|rar|zip)$|^fmc_|^bulk_|^compare_|\.dev\.vars$' }
if ($danger) {
    Say "STOP - these files must not go to GitHub:" 'Red'
    $danger | ForEach-Object { Write-Host "   $_" -ForegroundColor Red }
    Say "Fix .gitignore then run again." 'Red'
    exit 1
}

# --- 4. commit ------------------------------------------------------------
$msg = "v3.7.0 - merge FMT split rules + rule order check, move password to Cloudflare Secret, add CI"
git commit -q -m $msg
if ($LASTEXITCODE -ne 0) { Say "Nothing to commit (or commit failed) - continuing" 'Yellow' }

# --- 5. push --------------------------------------------------------------
$hasOrigin = (git remote) -contains 'origin'
if (-not $hasOrigin) { git remote add origin $RepoUrl }

Say "Pushing to $RepoUrl ..."
git push -u origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Say "Push failed. Common causes:" 'Red'
    Say "  - Not logged in: a browser window should open, or install GitHub CLI" 'Red'
    Say "  - Repo already has commits: git pull --rebase origin main   then push again" 'Red'
    exit 1
}

Write-Host ""
Say "Done." 'Green'
Say "Next steps:" 'Yellow'
Say "  1) Add GitHub Secrets: CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID" 'Yellow'
Say "  2) Run: npx wrangler secret put APP_PASSWORD" 'Yellow'
Say "  See SETUP.md for details." 'Yellow'
