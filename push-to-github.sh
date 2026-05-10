#!/bin/bash
cd ~/powercut-aggregator
git remote remove origin 2>/dev/null || true
git remote add origin git@github.com:fushtik/powercut-aggregator.git
git branch -M master main 2>/dev/null || git branch -M main main 2>/dev/null || true
git push -u origin main
