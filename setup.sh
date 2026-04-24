#!/bin/bash

# AR Web App - macOS/Linux Quick Start

echo ""
echo "================================"
echo "AR Web App - Quick Start"
echo "================================"
echo ""

# Check if Node is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found!"
    echo "Please download and install Node.js from https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js found"
echo ""

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm not found!"
    echo "Please install Node.js properly"
    exit 1
fi

echo "✅ npm found"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install
if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo ""
echo "✅ Dependencies installed!"
echo ""

# Start server
echo "🚀 Starting development server..."
echo ""
echo "Server will be available at: http://localhost:8080"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

npm run serve
