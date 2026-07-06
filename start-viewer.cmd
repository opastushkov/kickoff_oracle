@echo off
rem ============================================================
rem  Kickoff Oracle - VIEWER launcher (the second laptop)
rem  Double-click this file. No AI download on this machine -
rem  it joins rooms, bets, and watches. Browser opens by itself.
rem ============================================================
cd /d "%~dp0"
git pull

cd frontend\sidecar
if not exist node_modules call npm install
start "Kickoff Helper (P2P only)" cmd /k "set QVAC_DISABLE_LLM=1&& npm start"

cd ..
if not exist node_modules call npx pnpm@11 install
start "" cmd /c "timeout /t 20 >nul && start http://localhost:5173"
call npx pnpm@11 dev
