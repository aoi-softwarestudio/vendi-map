@echo off
title AI Business Empire Command Center Launcher
chcp 65001 > nul
cls

echo ========================================================================
echo       VENTURE OS & SaaS SUITE SECURE CLOUD TUNNEL RUNNER
echo ========================================================================
echo.

:: Check if Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in system PATH.
    echo Please install Python and try again.
    echo.
    pause
    exit /b 1
)

:: Run the orchestrator
python start_empire.py

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] The orchestrator closed with an error code.
    echo.
    pause
)
