@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo DASHBOARD_NODE_MISSING: Node.js was not found. Install Node.js and add it to PATH.
  pause
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo DASHBOARD_PNPM_MISSING: pnpm was not found. Install pnpm and add it to PATH.
  pause
  exit /b 1
)

if not exist "node_modules\tsx" (
  echo DASHBOARD_DEPENDENCY_MISSING: tsx was not found. Run pnpm install first.
  pause
  exit /b 1
)

echo Building ST Workspace runtime...
call pnpm -r build
if errorlevel 1 (
  echo DASHBOARD_BUILD_FAILED: workspace build failed. Dashboard was not started.
  pause
  exit /b 1
)

node --import tsx/esm tools/dashboard-launcher.ts
set "DASHBOARD_EXIT=%ERRORLEVEL%"
if not "%DASHBOARD_EXIT%"=="0" pause
exit /b %DASHBOARD_EXIT%
