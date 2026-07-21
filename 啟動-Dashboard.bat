@echo off
setlocal
title Card Workspace Dashboard

cd /d "%~dp0"

if not exist "package.json" (
  echo [ERROR] package.json was not found.
  echo Run this file from the Card Workspace root directory.
  goto :failed
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH.
  echo Install Node.js 20.17 or newer, but lower than 21.
  goto :failed
)

node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 20 && minor >= 17 ? 0 : 1)" >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Unsupported Node.js version.
  echo Install Node.js 20.17 or newer, but lower than 21.
  goto :failed
)

if not exist "node_modules" (
  echo [SETUP] Installing dependencies...
  call npx --yes pnpm@10.34.5 install --frozen-lockfile
  if errorlevel 1 goto :failed
)

if not exist "apps\dashboard\dist\index.html" goto :build
if not exist "packages\cli\dist\index.js" goto :build
goto :start

:build
echo [SETUP] Building Dashboard...
call npx --yes pnpm@10.34.5 build
if errorlevel 1 goto :failed

:start
echo [START] Starting Card Workspace Dashboard...
echo Keep this window open. Press Ctrl+C to stop the server.
echo.
call npx --yes pnpm@10.34.5 dashboard
if errorlevel 1 goto :failed
goto :end

:failed
echo.
echo [ERROR] Dashboard could not be started.
pause
exit /b 1

:end
endlocal
