@echo off
cd /d "%~dp0"
echo LIVE data on your PC. Open http://localhost:3000 when it says Ready. Close this window to stop.
npm run local:live
pause
