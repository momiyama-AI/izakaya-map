@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0resolve-node.ps1" %*
