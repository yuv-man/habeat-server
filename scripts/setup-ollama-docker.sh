#!/bin/bash

# Setup script for MongoDB and Ollama Docker containers

set -e

echo "🚀 Setting up MongoDB and Ollama in Docker..."

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "   Visit: https://www.docker.com/get-started"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Start the containers
echo "📦 Starting MongoDB and Ollama containers..."
docker-compose up -d

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 5

# Check if MongoDB is running
if docker ps | grep -q habeat-mongodb; then
    echo "✅ MongoDB container is running!"
    # Wait a bit more for MongoDB to be ready
    sleep 3
else
    echo "❌ MongoDB failed to start. Check logs with: docker-compose logs mongodb"
    exit 1
fi

# Check if Ollama is running
if ! curl -s http://localhost:11434/api/tags > /dev/null; then
    echo "⚠️  Ollama might not be ready yet. Waiting a bit more..."
    sleep 5
fi

# Verify Ollama is running
if curl -s http://localhost:11434/api/tags > /dev/null; then
    echo "✅ Ollama is running!"
else
    echo "❌ Ollama failed to start. Check logs with: docker-compose logs ollama"
    exit 1
fi

# Ask which model to pull
echo ""
echo "Which Llama model would you like to pull?"
echo "1) llama2 (default, ~4GB)"
echo "2) llama2:7b (smaller, faster, ~4GB)"
echo "3) llama3 (~4.7GB)"
echo "4) llama3.1 (latest, ~4.7GB)"
echo "5) Skip (pull manually later)"
read -p "Enter choice [1-5] (default: 1): " choice

case ${choice:-1} in
    1)
        MODEL="llama2"
        ;;
    2)
        MODEL="llama2:7b"
        ;;
    3)
        MODEL="llama3"
        ;;
    4)
        MODEL="llama3.1"
        ;;
    5)
        echo "⏭️  Skipping model pull. Pull manually with: docker exec habeat-ollama ollama pull <model>"
        MODEL=""
        ;;
    *)
        MODEL="llama2"
        ;;
esac

if [ -n "$MODEL" ]; then
    echo "📥 Pulling $MODEL model (this may take 10-30 minutes)..."
    docker exec habeat-ollama ollama pull "$MODEL"
    echo "✅ Model $MODEL pulled successfully!"
fi

# List available models
echo ""
echo "📋 Available models:"
docker exec habeat-ollama ollama list

# Update .env file
echo ""
echo "📝 Updating .env file..."
if [ -f .env ]; then
    # Update MongoDB URL
    if grep -q "MONGO_URL_LOCAL" .env; then
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' 's|MONGO_URL_LOCAL=.*|MONGO_URL_LOCAL=mongodb://root:rootpassword@localhost:27017/|' .env
        else
            sed -i 's|MONGO_URL_LOCAL=.*|MONGO_URL_LOCAL=mongodb://root:rootpassword@localhost:27017/|' .env
        fi
        echo "✅ Updated MONGO_URL_LOCAL in .env"
    else
        echo "" >> .env
        echo "# MongoDB Docker Configuration" >> .env
        echo "MONGO_URL_LOCAL=mongodb://root:rootpassword@localhost:27017/" >> .env
        echo "✅ Added MONGO_URL_LOCAL to .env"
    fi
    
    # Check if OLLAMA_BASE_URL exists
    if grep -q "OLLAMA_BASE_URL" .env; then
        # Update existing entry
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            sed -i '' 's|OLLAMA_BASE_URL=.*|OLLAMA_BASE_URL=http://localhost:11434|' .env
        else
            # Linux
            sed -i 's|OLLAMA_BASE_URL=.*|OLLAMA_BASE_URL=http://localhost:11434|' .env
        fi
        echo "✅ Updated OLLAMA_BASE_URL in .env"
    else
        echo "" >> .env
        echo "# Ollama Docker Configuration" >> .env
        echo "OLLAMA_BASE_URL=http://localhost:11434" >> .env
        echo "✅ Added OLLAMA_BASE_URL to .env"
    fi
    
    # Update OLLAMA_MODEL if model was pulled
    if [ -n "$MODEL" ]; then
        if grep -q "OLLAMA_MODEL" .env; then
            if [[ "$OSTYPE" == "darwin"* ]]; then
                sed -i '' "s|OLLAMA_MODEL=.*|OLLAMA_MODEL=$MODEL|" .env
            else
                sed -i "s|OLLAMA_MODEL=.*|OLLAMA_MODEL=$MODEL|" .env
            fi
        else
            echo "OLLAMA_MODEL=$MODEL" >> .env
        fi
        echo "✅ Updated OLLAMA_MODEL in .env"
    fi
else
    echo "⚠️  .env file not found. Create it manually with:"
    echo "   MONGO_URL_LOCAL=mongodb://root:rootpassword@localhost:27017/"
    echo "   OLLAMA_BASE_URL=http://localhost:11434"
    if [ -n "$MODEL" ]; then
        echo "   OLLAMA_MODEL=$MODEL"
    fi
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "1. Verify MongoDB is running: docker ps | grep mongodb"
echo "2. Verify Ollama is running: curl http://localhost:11434/api/tags"
echo "3. Start your NestJS server: npm run start:dev"
echo "4. Test meal plan generation"
echo ""
echo "Useful commands:"
echo "  - Start all: npm run docker:up"
echo "  - Stop all: npm run docker:down"
echo "  - View logs: npm run docker:logs"
echo "  - MongoDB logs: npm run docker:mongo:logs"
echo "  - Ollama logs: npm run docker:ollama:logs"
echo "  - List models: npm run docker:ollama:list"

