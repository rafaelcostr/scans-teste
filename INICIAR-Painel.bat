@echo off
title DEX Scanner - Painel
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-scanner.ps1"
pause
