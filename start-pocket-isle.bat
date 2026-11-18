@echo off
chcp 65001 >nul
cd /d "%~dp0"
wscript.exe //nologo "%~dp0start-pocket-isle.vbs"
exit /b
