@echo off
chcp 65001 >nul
cd /d "%~dp0"
wscript.exe //nologo "%~dp0启动停靠岛.vbs"
exit /b
