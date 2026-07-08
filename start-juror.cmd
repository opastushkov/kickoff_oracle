@echo off
rem ============================================================
rem  Kickoff Oracle - JUROR launcher (a second laptop that JUDGES)
rem  Double-click this file. Same as the viewer, but it also runs
rem  the on-device AI so this laptop can cast its own juror verdict
rem  (the two-device, different-model jury). It still JOINS the
rem  host's room by invite key - it just brings its own brain.
rem  First run downloads the model (needs internet once), then
rem  judges fully offline. Requires Smart App Control to be OFF.
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
