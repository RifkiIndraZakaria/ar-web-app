@echo off
REM AR Web App - Windows Quick Start

echo.
echo ================================
echo AR Web App - Windows Quick Start
echo ================================
echo.

REM Check if Node is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Node.js not found!
    echo Please download and install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo ✅ Node.js found
echo.

REM Check if npm is installed
where npm >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ npm not found!
    echo Please install Node.js properly
    pause
    exit /b 1
)

echo ✅ npm found
echo.

REM Install dependencies
echo 📦 Installing dependencies...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Failed to install dependencies
    pause
    exit /b 1
)

echo.
echo ✅ Dependencies installed!
echo.

REM Start server
echo 🚀 Starting development server...
echo.
echo Server will be available at: http://localhost:8080
echo.
echo Press Ctrl+C to stop the server
echo.

call npm run serve

pause
