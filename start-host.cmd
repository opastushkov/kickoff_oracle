@echo off
rem ============================================================
rem  Kickoff Oracle - HOST launcher (the main laptop, runs the AI)
rem  Double-click this file. It opens the helper + the app,
rem  then opens the browser for you.
rem ============================================================
cd /d "%~dp0"
git pull

cd frontend\sidecar
if not exist node_modules call npm install
start "Kickoff Helper (AI + P2P)" cmd /k "npm start"

cd ..
if not exist node_modules call npx pnpm@11 install
start "" cmd /c "timeout /t 20 >nul && start http://localhost:5173"
call npx pnpm@11 dev
