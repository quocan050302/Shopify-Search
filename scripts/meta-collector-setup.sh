#!/usr/bin/env bash
# SWAI V11 — Self-Hosted MetaAdsCollector Setup Script
# Target: macOS / Linux (Posix) & Windows Git Bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVICE_DIR="${PROJECT_ROOT}/services/meta-ads-collector"
VENV_DIR="${SERVICE_DIR}/.venv"
REQUIREMENTS_FILE="${SERVICE_DIR}/requirements.txt"

echo "=== SWAI V11 — MetaAdsCollector Setup ==="
echo "Project Root: ${PROJECT_ROOT}"
echo "Service Dir:  ${SERVICE_DIR}"

# 1. Check Python version
PYTHON_CMD=""
if command -v python3 >/dev/null 2>&1; then
  PYTHON_CMD="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_CMD="python"
else
  echo "[ERROR] Python 3 was not found in PATH. Please install Python 3.10+." >&2
  exit 1
fi

PY_VERSION=$("${PYTHON_CMD}" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo "Detected Python: ${PYTHON_CMD} (${PY_VERSION})"

PY_CHECK=$("${PYTHON_CMD}" -c "import sys; print(1 if sys.version_info >= (3, 10) else 0)")
if [ "${PY_CHECK}" != "1" ]; then
  echo "[ERROR] Python 3.10+ is required by MetaAdsCollector MCP. Detected ${PY_VERSION}." >&2
  exit 1
fi

# 2. Create project-specific virtual environment
mkdir -p "${SERVICE_DIR}"
mkdir -p "${SERVICE_DIR}/data"

if [ ! -d "${VENV_DIR}" ]; then
  echo "Creating virtual environment in ${VENV_DIR}..."
  "${PYTHON_CMD}" -m venv "${VENV_DIR}"
else
  echo "Virtual environment already exists in ${VENV_DIR}."
fi

# Determine python and pip binary inside venv
VENV_PYTHON="${VENV_DIR}/bin/python"
if [ ! -f "${VENV_PYTHON}" ] && [ -f "${VENV_DIR}/Scripts/python.exe" ]; then
  VENV_PYTHON="${VENV_DIR}/Scripts/python.exe"
fi

# 3. Upgrade pip and install pinned requirements
echo "Upgrading pip..."
"${VENV_PYTHON}" -m pip install --upgrade pip

if [ -f "${REQUIREMENTS_FILE}" ]; then
  echo "Installing pinned dependencies from ${REQUIREMENTS_FILE}..."
  "${VENV_PYTHON}" -m pip install -r "${REQUIREMENTS_FILE}"
else
  echo "Installing meta-ads-collector[mcp]==1.7.0..."
  "${VENV_PYTHON}" -m pip install "meta-ads-collector[mcp]==1.7.0"
fi

# 4. Verify MCP discovery
echo "Verifying local MCP server discovery..."
"${VENV_PYTHON}" -m meta_ads_collector_mcp discover >/dev/null
echo "✓ MetaAdsCollector MCP verified successfully!"
echo "Ready for SWAI discovery operations."
