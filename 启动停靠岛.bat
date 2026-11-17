@echo off
chcp 65001 >nul
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0"
if exist "electron.vite.config.ts" del /q "electron.vite.config.ts" >nul 2>&1
call npm.cmd run build
taskkill /F /IM electron.exe >nul 2>&1
start "" "node_modules\electron\dist\electron.exe" .
