#!/bin/bash

# Script to kill all NestJS server processes and free up port 5000

PORT=${PORT:-5000}

echo "Killing processes on port $PORT..."

# Kill process using the port
PORT_PID=$(lsof -ti:$PORT 2>/dev/null)
if [ ! -z "$PORT_PID" ]; then
  echo "Killing process $PORT_PID using port $PORT"
  kill -9 $PORT_PID 2>/dev/null
fi

# Kill all nest watch processes related to habeat-server
echo "Killing NestJS watch processes..."
pkill -f "habeat-server.*nest.*watch" 2>/dev/null

# Kill any remaining node processes running main.js from this project
echo "Killing Node.js server processes..."
pkill -f "habeat-server.*node.*main" 2>/dev/null

# Wait a moment for processes to die
sleep 1

# Check if port is free
if lsof -ti:$PORT > /dev/null 2>&1; then
  echo "Warning: Port $PORT is still in use. Trying force kill..."
  lsof -ti:$PORT | xargs kill -9 2>/dev/null
  sleep 1
fi

# Final check
if lsof -ti:$PORT > /dev/null 2>&1; then
  echo "Error: Port $PORT is still in use. You may need to manually kill the process."
  echo "Run: lsof -ti:$PORT | xargs kill -9"
  exit 1
else
  echo "✓ Port $PORT is now free!"
  echo "✓ All server processes killed successfully"
  exit 0
fi
