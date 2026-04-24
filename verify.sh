#!/bin/bash

# AR Web App - Project Setup Verification Script

echo "🔍 AR Web App - Project Structure Verification"
echo "==============================================="
echo ""

# Check project structure
check_file() {
    if [ -f "$1" ]; then
        echo "✅ $1"
    else
        echo "❌ $1 (MISSING)"
    fi
}

check_dir() {
    if [ -d "$1" ]; then
        echo "📁 $1/"
    else
        echo "❌ $1/ (MISSING)"
    fi
}

echo "📦 Checking Project Files..."
echo ""

check_dir "public"
check_file "public/index.html"
check_file "public/example-config.json"
check_dir "public/js"
check_file "public/js/ar-viewer.js"
check_file "public/js/qr-scanner.js"
check_file "public/js/audio-manager.js"
check_dir "public/models"
check_file "public/models/MODELS.md"
check_dir "public/audio"
check_file "public/audio/README.md"
check_dir "public/qr"
check_dir "scripts"
check_file "scripts/generateQR.js"
check_file "package.json"
check_file "README.md"
check_file "QUICKSTART.md"
check_file "ADVANCED.html"
check_file ".env"
check_file ".gitignore"

echo ""
echo "✨ Project Structure Verification Complete!"
echo ""
echo "🚀 Next Steps:"
echo "1. npm install"
echo "2. npm run serve"
echo "3. Open http://localhost:8080"
