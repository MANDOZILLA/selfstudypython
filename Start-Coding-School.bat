@echo off
REM Zero-setup launcher for Coding School (double-click this file).
REM - Uses your Node.js 20.9+ if you have one.
REM - Otherwise downloads a portable Node automatically (no admin rights needed).
REM - Installs app dependencies if missing, then starts the school and opens it.
REM
REM Style note: this file deliberately uses flat "if ... goto" lines and no
REM multi-line (...) blocks. cmd.exe misparses quoted parentheses and ||/&&
REM chains inside skipped blocks, which breaks exactly the fallback paths.
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "APP_DIR=%~dp0coding-school"
set "TOOLS_DIR=%~dp0.tools"
set "NODE_DIR=%TOOLS_DIR%\node"

REM 1. Prefer a good-enough system Node.
where node >nul 2>nul
if %errorlevel% neq 0 goto :portable_node
node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>20||(v[0]===20&&v[1]>=9)?0:1)" >nul 2>nul
if %errorlevel%==0 goto :have_node
echo System Node.js is too old. Getting a portable one instead...

:portable_node
REM 2. Fall back to a portable Node inside .tools (downloaded once, reused).
REM The newest LTS version is resolved live from nodejs.org, so this never
REM goes stale. Everything happens inside one PowerShell call: fetch the
REM release index, download the matching portable zip, extract it, and rename
REM the versioned folder to "node".
if exist "%NODE_DIR%\node.exe" goto :node_ready
echo Downloading portable Node.js LTS (one-time, ~30 MB)...
if not exist "%TOOLS_DIR%" mkdir "%TOOLS_DIR%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$idx = Invoke-WebRequest -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing | ConvertFrom-Json; $v = ($idx | Where-Object { $_.lts } | Select-Object -First 1 -ExpandProperty version); Invoke-WebRequest -Uri ('https://nodejs.org/dist/' + $v + '/node-' + $v + '-win-x64.zip') -OutFile '%TOOLS_DIR%\node.zip'; Expand-Archive -Path '%TOOLS_DIR%\node.zip' -DestinationPath '%TOOLS_DIR%' -Force; Remove-Item '%TOOLS_DIR%\node.zip'; Get-ChildItem '%TOOLS_DIR%' -Directory -Filter 'node-v*-win-x64' | Rename-Item -NewName 'node'"
if %errorlevel% neq 0 goto :download_failed
:node_ready
set "PATH=%NODE_DIR%;%PATH%"

:have_node
echo Found a working Node.js. Using it.
node --version
if %errorlevel% neq 0 goto :no_node

REM 3. Install everything the app needs (skipped automatically when up to date).
echo.
node "%APP_DIR%\scripts\setup.mjs"
if %errorlevel% neq 0 goto :setup_failed

REM 4. Start the school and open it in the browser.
echo.
echo Starting Coding School...
if defined CODING_SCHOOL_DRYRUN echo DRYRUN: setup passed - would open http://127.0.0.1:3000 and run "npm run dev" here.
if defined CODING_SCHOOL_DRYRUN goto :eof
start "" http://127.0.0.1:3000
pushd "%APP_DIR%"
call npm run dev
popd
goto :eof

:download_failed
echo.
echo Could not download Node.js. Check your internet connection and try again.
echo If it keeps failing, install Node.js 20.9+ from https://nodejs.org/ and re-run this file.
pause
exit /b 1

:no_node
echo.
echo Node.js is not available and the portable download is missing.
echo Install Node.js 20.9+ from https://nodejs.org/ and re-run this file.
pause
exit /b 1

:setup_failed
echo.
echo Setup did not finish. Read the error above, fix it, and double-click again.
pause
exit /b 1
