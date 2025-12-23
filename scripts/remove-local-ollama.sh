#!/bin/bash

# Script to remove local Ollama installation and models

set -e

echo "🗑️  Removing local Ollama installation..."

# Check if Ollama is installed
if ! command -v ollama &> /dev/null; then
    echo "ℹ️  Ollama is not installed locally. Nothing to remove."
    exit 0
fi

echo "📍 Found Ollama at: $(which ollama)"

# Stop Ollama service
echo "🛑 Stopping Ollama service..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS - try to stop via brew services
    if command -v brew &> /dev/null; then
        brew services stop ollama 2>/dev/null || true
    fi
    # Kill any running ollama processes
    pkill -f ollama 2>/dev/null || true
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux - stop systemd service if exists
    systemctl stop ollama 2>/dev/null || true
    # Kill any running ollama processes
    pkill -f ollama 2>/dev/null || true
fi

sleep 2

# Remove models
echo "🗑️  Removing Ollama models..."
OLLAMA_HOME="${HOME}/.ollama"
if [ -d "$OLLAMA_HOME" ]; then
    echo "   Removing models from: $OLLAMA_HOME"
    rm -rf "$OLLAMA_HOME"
    echo "   ✅ Models removed"
else
    echo "   ℹ️  No models directory found"
fi

# Uninstall Ollama
echo "🗑️  Uninstalling Ollama..."

if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS - try to uninstall via brew
    if command -v brew &> /dev/null; then
        if brew list ollama &> /dev/null; then
            echo "   Uninstalling via Homebrew..."
            brew uninstall ollama 2>/dev/null || true
            echo "   ✅ Ollama uninstalled via Homebrew"
        else
            echo "   ℹ️  Ollama not installed via Homebrew"
        fi
    fi
    
    # Remove Ollama binary if exists
    if [ -f "/usr/local/bin/ollama" ]; then
        echo "   Removing binary from /usr/local/bin/ollama"
        sudo rm -f /usr/local/bin/ollama 2>/dev/null || true
    fi
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux - remove via package manager or manual install
    if command -v apt-get &> /dev/null; then
        sudo apt-get remove -y ollama 2>/dev/null || true
    elif command -v yum &> /dev/null; then
        sudo yum remove -y ollama 2>/dev/null || true
    fi
    
    # Remove binary if exists
    if [ -f "/usr/local/bin/ollama" ]; then
        sudo rm -f /usr/local/bin/ollama 2>/dev/null || true
    fi
fi

# Remove Ollama config directory
if [ -d "${HOME}/.ollama" ]; then
    echo "   Removing config directory..."
    rm -rf "${HOME}/.ollama"
fi

# Verify removal
if command -v ollama &> /dev/null; then
    echo "⚠️  Warning: Ollama binary still found at: $(which ollama)"
    echo "   You may need to remove it manually"
else
    echo "✅ Ollama binary removed"
fi

echo ""
echo "🎉 Local Ollama installation removed!"
echo ""
echo "Next steps:"
echo "1. Use Docker instead: npm run docker:ollama:up"
echo "2. Pull models in Docker: npm run docker:ollama:pull"
echo "3. Update .env: OLLAMA_BASE_URL=http://localhost:11434"
echo ""
echo "See DOCKER_SETUP.md for Docker setup instructions."

