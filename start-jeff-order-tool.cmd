@echo off
setlocal

cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;D:\Program Files\Git\cmd;D:\Program Files\Git\bin;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js LTS first.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Please reinstall Node.js LTS.
  pause
  exit /b 1
)

start "Jeff Order Tool Server" /min cmd /k "cd /d ""%~dp0"" && npm run dev:lan"
timeout /t 3 /nobreak >nul
start "" "http://localhost:3000"

exit /b 0
