@echo off
title DEX Scanner - Paper Loop
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-paper-loop.ps1"
pause
