@echo off
title Criar ficheiro .env
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\criar-env.ps1"
pause
