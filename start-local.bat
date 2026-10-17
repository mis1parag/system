@echo off
cd /d "%~dp0"
echo Starting MIDAP on your PC. Open http://localhost:3000 when it says Ready. Close this window to stop.
npm run local
pause
