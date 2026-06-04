@echo off
title DEX Scanner
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\menu-inicializador.ps1"
if errorlevel 1 pause
