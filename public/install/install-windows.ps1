$ErrorActionPreference = 'Stop'

# Claude Code on Windows requires Git. Install via winget if missing.
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "==> Git not found. Installing via winget..."
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Error "winget is not available on this system. Please install Git for Windows manually from https://git-scm.com and re-run this script."
        exit 1
    }
    winget install --id Git.Git --silent --accept-source-agreements --accept-package-agreements
}

Write-Host "==> Installing Claude Code..."
Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression

$claudeBin = Join-Path $env:USERPROFILE '.local\bin\claude.exe'
if (-not (Test-Path $claudeBin)) {
    Write-Error "Install finished but $claudeBin is missing. See https://code.claude.com/docs/en/quickstart for help."
    exit 1
}

Write-Host ""
Write-Host "==> Claude Code installed: $(& $claudeBin --version)"
Write-Host ""
Write-Host "==> Generating your setup token..."
Write-Host "    A browser window will open. Log in with your Claude account."
Write-Host "    After authorizing, copy the token printed below and paste it"
Write-Host "    back into the app."
Write-Host ""
& $claudeBin setup-token
