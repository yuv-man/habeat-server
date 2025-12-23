# Docker Setup for Ollama/Llama and MongoDB

> **✅ This is the recommended and primary method for running Ollama/Llama and MongoDB**

This guide explains how to run Ollama/Llama and MongoDB in Docker. Docker is the preferred method as it:

- Keeps your system clean (no local installation)
- Easy to manage and update
- Isolated from your system
- Works consistently across different environments
- All services in one place

## Prerequisites

- Docker installed on your system
- Docker Compose installed (usually comes with Docker Desktop)

## Quick Start

### 1. Start All Services (MongoDB + Ollama)

```bash
# Start both MongoDB and Ollama containers
npm run docker:up

# Or using docker-compose directly
docker-compose up -d
```

### 2. Start Individual Services

```bash
# Start only MongoDB
npm run docker:mongo:up

# Start only Ollama
npm run docker:ollama:up
```

### 2. Verify MongoDB is Running

```bash
# Check MongoDB container status
docker ps | grep mongodb

# View MongoDB logs
npm run docker:mongo:logs

# Test MongoDB connection
docker exec -it habeat-mongodb mongosh -u root -p rootpassword --authenticationDatabase admin
```

### 3. Pull a Llama Model

```bash
# Pull the default llama2 model
npm run docker:ollama:pull

# Or manually
docker exec habeat-ollama ollama pull llama2

# Pull other models
docker exec habeat-ollama ollama pull llama3
docker exec habeat-ollama ollama pull llama3.1
```

### 4. Verify It's Working

```bash
# List available models
npm run docker:ollama:list

# Or manually
docker exec habeat-ollama ollama list

# Test the API
curl http://localhost:11434/api/tags
```

### 5. Update Your .env File

Make sure your `.env` file has:

```env
# MongoDB (Docker)
MONGO_URL_LOCAL=mongodb://root:rootpassword@localhost:27017/

# Ollama (Docker)
OLLAMA_BASE_URL=http://localhost:11434

# Ollama model name
OLLAMA_MODEL=llama2

# AI Provider
AI_PROVIDER=llama
```

**Note:** If your NestJS app is also running in Docker, you can use container names:

```env
MONGO_URL_LOCAL=mongodb://root:rootpassword@mongodb:27017/
OLLAMA_BASE_URL=http://ollama:11434
```

## Available NPM Scripts

### All Services

- `npm run docker:up` - Start all containers (MongoDB + Ollama)
- `npm run docker:down` - Stop and remove all containers
- `npm run docker:logs` - View logs for all containers
- `npm run docker:restart` - Restart all containers

### MongoDB

- `npm run docker:mongo:up` - Start MongoDB container
- `npm run docker:mongo:down` - Stop MongoDB container
- `npm run docker:mongo:logs` - View MongoDB logs
- `npm run docker:mongo:restart` - Restart MongoDB container

### Ollama

- `npm run docker:ollama:up` - Start Ollama container
- `npm run docker:ollama:down` - Stop Ollama container
- `npm run docker:ollama:logs` - View Ollama logs
- `npm run docker:ollama:restart` - Restart Ollama container
- `npm run docker:ollama:pull` - Pull llama2 model
- `npm run docker:ollama:list` - List available models

## Docker Commands

### Start/Stop Containers

```bash
# Start all services
docker-compose up -d

# Start specific service
docker-compose up -d mongodb
docker-compose up -d ollama

# Stop all services
docker-compose down

# Stop specific service
docker-compose stop mongodb
docker-compose stop ollama

# View logs
docker-compose logs -f              # All services
docker-compose logs -f mongodb      # MongoDB only
docker-compose logs -f ollama        # Ollama only

# Restart
docker-compose restart              # All services
docker-compose restart mongodb      # MongoDB only
docker-compose restart ollama       # Ollama only
```

### MongoDB Commands

```bash
# Access MongoDB shell
docker exec -it habeat-mongodb mongosh -u root -p rootpassword --authenticationDatabase admin

# List databases
docker exec -it habeat-mongodb mongosh -u root -p rootpassword --authenticationDatabase admin --eval "show dbs"

# Backup database
docker exec habeat-mongodb mongodump -u root -p rootpassword --authenticationDatabase admin --db habeat --out /data/backup

# Restore database
docker exec habeat-mongodb mongorestore -u root -p rootpassword --authenticationDatabase admin --db habeat /data/backup/habeat
```

### Manage Models

```bash
# Pull a model
docker exec habeat-ollama ollama pull llama2
docker exec habeat-ollama ollama pull llama3

# List models
docker exec habeat-ollama ollama list

# Remove a model
docker exec habeat-ollama ollama rm llama2

# Test a model
docker exec -it habeat-ollama ollama run llama2 "Hello, test message"
```

### Access Container Shell

```bash
docker exec -it habeat-ollama /bin/bash
```

## Configuration

### Port Configuration

The default port is `11434`. If you need to change it, edit `docker-compose.yml`:

```yaml
ports:
  - "11435:11434" # Change host port to 11435
```

Then update `.env`:

```env
OLLAMA_BASE_URL=http://localhost:11435
```

### Volume Persistence

Models are stored in a Docker volume (`ollama-data`). This means:

- Models persist even if you stop/remove the container
- Models are shared across container restarts
- To remove all models, delete the volume: `docker volume rm habeat-server_ollama-data`

### GPU Support (Optional)

If you have an NVIDIA GPU and want to use it:

1. Install [nvidia-docker](https://github.com/NVIDIA/nvidia-docker)

2. Uncomment the GPU section in `docker-compose.yml`:

```yaml
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: 1
          capabilities: [gpu]
```

3. Restart the container:

```bash
docker-compose down
docker-compose up -d ollama
```

## Troubleshooting

### MongoDB Container Won't Start

```bash
# Check if port is already in use
lsof -i :27017

# View MongoDB logs
docker-compose logs mongodb

# Check container status
docker ps -a | grep mongodb

# Test MongoDB connection
docker exec -it habeat-mongodb mongosh -u root -p rootpassword --authenticationDatabase admin
```

### Ollama Container Won't Start

```bash
# Check if port is already in use
lsof -i :11434

# View container logs
docker-compose logs ollama

# Check container status
docker ps -a | grep ollama
```

### Can't Connect to MongoDB

1. Verify container is running:

   ```bash
   docker ps | grep mongodb
   ```

2. Test MongoDB connection:

   ```bash
   docker exec -it habeat-mongodb mongosh -u root -p rootpassword --authenticationDatabase admin
   ```

3. Verify .env configuration:

   ```bash
   cat .env | grep MONGO_URL_LOCAL
   ```

   Should be: `MONGO_URL_LOCAL=mongodb://root:rootpassword@localhost:27017/`

4. Check if MongoDB port is accessible:
   ```bash
   lsof -i :27017
   ```

### Can't Connect to Ollama

1. Verify container is running:

   ```bash
   docker ps | grep ollama
   ```

2. Check if port is accessible:

   ```bash
   curl http://localhost:11434/api/tags
   ```

3. Verify .env configuration:
   ```bash
   cat .env | grep OLLAMA
   ```

### Models Not Loading

```bash
# Check if model is downloaded
docker exec habeat-ollama ollama list

# Re-pull the model
docker exec habeat-ollama ollama pull llama2

# Check container logs
docker-compose logs ollama
```

### Out of Memory

If you get out of memory errors:

1. Use a smaller model:

   ```bash
   docker exec habeat-ollama ollama pull llama2:7b
   ```

2. Update `.env`:

   ```env
   OLLAMA_MODEL=llama2:7b
   ```

3. Increase Docker memory limit in Docker Desktop settings

## Migration from Local Ollama

If you were running Ollama locally:

1. Stop local Ollama:

   ```bash
   # macOS/Linux
   pkill ollama

   # Or stop the service
   brew services stop ollama  # macOS
   ```

2. Start Docker container:

   ```bash
   npm run docker:ollama:up
   ```

3. Pull models in Docker:

   ```bash
   npm run docker:ollama:pull
   ```

4. Update `.env`:
   ```env
   OLLAMA_BASE_URL=http://localhost:11434
   ```

## Network Configuration

If your NestJS app is also running in Docker, you can use the container name:

```yaml
# In your app's docker-compose.yml
services:
  app:
    # ... your app config
    environment:
      - OLLAMA_BASE_URL=http://ollama:11434
    networks:
      - habeat-network
```

## Clean Up

To completely remove Ollama Docker setup:

```bash
# Stop and remove container
docker-compose down

# Remove volume (deletes all models)
docker volume rm habeat-server_ollama-data

# Remove image (optional)
docker rmi ollama/ollama:latest
```

## Performance Tips

1. **Use appropriate model size**: Smaller models (7b) are faster but less capable
2. **Allocate enough memory**: Ensure Docker has at least 8GB RAM available
3. **Use GPU if available**: Significantly faster inference
4. **Keep container running**: Avoid frequent start/stop to reduce cold start time

## Next Steps

After setting up Docker:

1. Start the container: `npm run docker:ollama:up`
2. Pull a model: `npm run docker:ollama:pull`
3. Verify: `npm run docker:ollama:list`
4. Update `.env` with `OLLAMA_BASE_URL=http://localhost:11434`
5. Start your NestJS server and test meal plan generation
