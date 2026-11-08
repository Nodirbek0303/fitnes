@echo off
cd /d "%~dp0"
set "NODE_EXE="
for /f "delims=" %%N in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%N"
if not defined NODE_EXE (
  for /d %%D in ("%LOCALAPPDATA%\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_*") do (
    for /d %%V in ("%%D\node-v*-win-x64") do if exist "%%V\node.exe" set "NODE_EXE=%%V\node.exe"
  )
)
if not defined NODE_EXE (
  echo Node.js 22.13 or newer is required.
  echo Install the current Node.js LTS release, then run this file again.
  pause
  exit /b 1
)
"%NODE_EXE%" server.js
pause
