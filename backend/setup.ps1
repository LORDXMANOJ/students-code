# Code Tracker - Quick Setup Script
# Run this from the backend directory

Write-Host "=== Code Tracker Setup ===" -ForegroundColor Cyan
Write-Host ""

# Check if in backend directory
if (-not (Test-Path package.json)) {
    Write-Host "ERROR: Please run this script from the backend directory" -ForegroundColor Red
    exit 1
}

# Step 1: Install dependencies
Write-Host "Step 1: Installing dependencies..." -ForegroundColor Yellow
npm install

# Step 2: Setup database schema
Write-Host "`nStep 2: Setting up database schema..." -ForegroundColor Yellow
npx prisma db push

# Step 3: Seed database
Write-Host "`nStep 3: Seeding database with students..." -ForegroundColor Yellow
npx tsx seed.ts

Write-Host "`n=== Setup Complete! ===" -ForegroundColor Green
Write-Host "`nTo start the backend server, run:" -ForegroundColor Cyan
Write-Host "  npm run server" -ForegroundColor White
Write-Host "`nThen in another terminal, start the frontend:" -ForegroundColor Cyan
Write-Host "  cd frontend" -ForegroundColor White
Write-Host "  npm start" -ForegroundColor White
