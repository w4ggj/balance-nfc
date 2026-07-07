@echo off
REM Balance Gaming FL — TOM watcher launcher
REM Double-click to start watching TOM's reports and mirroring them to Firebase.
REM Leave this window open during the event; close it to stop.
cd /d "%~dp0"
echo Starting TOM watcher... (leave this window open during the event)
node watcher.js
pause
