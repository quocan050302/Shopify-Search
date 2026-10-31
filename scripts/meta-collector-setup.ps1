# SWAI V11 — Self-Hosted MetaAdsCollector Setup Script for Windows PowerShell
$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path "$PSScriptRoot\.."
$ServiceDir = Join-Path $ProjectRoot "services\meta-ads-collector"
$VenvDir = Join-Path $ServiceDir ".venv"
$RequirementsFile = Join-Path $ServiceDir "requirements.txt"

Write-Host "=== SWAI V11 — MetaAdsCollector Setup (PowerShell) ==="
Write-Host "Project Root: $ProjectRoot"
Write-Host "Service Dir:  $ServiceDir"

# 1. Locate Python 3.10+
$PythonCmd = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $PythonCmd) {
    $PythonCmd = (Get-Command py -ErrorAction SilentlyContinue).Source
}
if (-not $PythonCmd) {
    Write-Error "Python was not found in PATH. Please install Python 3.10+."
    exit 1
}

$PyVersion = & $PythonCmd -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
Write-Host "Detected Python: $PythonCmd ($PyVersion)"

$PyCheck = & $PythonCmd -c "import sys; print(1 if sys.version_info >= (3, 10) else 0)"
if ($PyCheck -ne "1") {
    Write-Error "Python 3.10+ is required by MetaAdsCollector MCP. Detected $PyVersion."
    exit 1
}

# 2. Create virtual environment
if (-not (Test-Path $ServiceDir)) {
    New-Item -ItemType Directory -Path $ServiceDir -Force | Out-Null
}
$DataDir = Join-Path $ServiceDir "data"
if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
if (-not (Test-Path $VenvPython)) {
    $VenvPython = Join-Path $VenvDir "bin\python"
}

if (-not (Test-Path $VenvPython)) {
    Write-Host "Creating virtual environment in $VenvDir..."
    & $PythonCmd -m venv --clear $VenvDir
} else {
    Write-Host "Virtual environment already exists in $VenvDir."
}

# 3. Pip install pinned dependencies
Write-Host "Upgrading pip..."
& $VenvPython -m pip install --upgrade pip

if (Test-Path $RequirementsFile) {
    Write-Host "Installing pinned dependencies from $RequirementsFile..."
    & $VenvPython -m pip install -r $RequirementsFile
} else {
    Write-Host "Installing meta-ads-collector[mcp]==1.7.0..."
    & $VenvPython -m pip install "meta-ads-collector[mcp]==1.7.0"
}

# 4. Verify discovery
Write-Host "Verifying local MCP server discovery..."
& $VenvPython -m meta_ads_collector_mcp discover | Out-Null
Write-Host "✓ MetaAdsCollector MCP verified successfully!"
Write-Host "Ready for SWAI discovery operations."
