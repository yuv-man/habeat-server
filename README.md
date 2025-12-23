# Habeat Server

NestJS backend server for the Habeat meal planning application.

## Quick Start

### Prerequisites

- Node.js (v18+)
- Docker and Docker Compose

### Setup

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Configure environment:**

   ```bash
   cp .env.example .env  # If you have an example file
   # Edit .env with your configuration
   ```

3. **Start MongoDB and Ollama in Docker:**

   ```bash
   # Start all services
   npm run docker:up

   # Pull a Llama model
   npm run docker:ollama:pull
   ```

4. **Start the server:**
   ```bash
   npm run start:dev
   ```

## Docker Services

**We use Docker for MongoDB and Ollama/Llama. Local installation is not required.**

See [DOCKER_SETUP.md](./DOCKER_SETUP.md) for complete Docker setup instructions.

### Quick Docker Commands

```bash
# Start all services (MongoDB + Ollama)
npm run docker:up

# Stop all services
npm run docker:down

# View logs
npm run docker:logs

# MongoDB specific
npm run docker:mongo:up
npm run docker:mongo:logs

# Ollama specific
npm run docker:ollama:up
npm run docker:ollama:pull
npm run docker:ollama:list
```

## Environment Variables

Key environment variables in `.env`:

```env
# MongoDB (Docker)
MONGO_URL_LOCAL=mongodb://root:rootpassword@localhost:27017/

# Ollama (Docker)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama2

# AI Provider (llama or gemini)
AI_PROVIDER=llama

# JWT
JWT_SECRET=your-secret-key

# Test Mode (for development)
TEST_MODE=false
```

**Note:** MongoDB credentials in Docker:

- Username: `root`
- Password: `rootpassword`
- Database: `habeat`
- Port: `27017`

## API Documentation

Once the server is running, access Swagger documentation at:

- http://localhost:5000/api/docs

## Available Scripts

### Development

- `npm run start:dev` - Start development server with watch mode
- `npm run build` - Build for production
- `npm run start:prod` - Start production server

### Docker - All Services

- `npm run docker:up` - Start all containers (MongoDB + Ollama)
- `npm run docker:down` - Stop all containers
- `npm run docker:logs` - View logs for all containers
- `npm run docker:restart` - Restart all containers

### Docker - MongoDB

- `npm run docker:mongo:up` - Start MongoDB container
- `npm run docker:mongo:logs` - View MongoDB logs
- `npm run docker:mongo:restart` - Restart MongoDB container

### Docker - Ollama

- `npm run docker:ollama:up` - Start Ollama container
- `npm run docker:ollama:down` - Stop Ollama container
- `npm run docker:ollama:logs` - View Ollama logs
- `npm run docker:ollama:pull` - Pull llama2 model
- `npm run docker:ollama:list` - List available models

## Project Structure

```
src/
├── auth/          # Authentication module
├── user/          # User management
├── generator/     # AI meal plan generation
├── plan/          # Meal plan management
├── meal/          # Meal management
├── progress/      # Progress tracking
└── goals/         # Goals management
```

## Documentation

- [DOCKER_SETUP.md](./DOCKER_SETUP.md) - Docker setup for Ollama
- [OLLAMA_SETUP.md](./OLLAMA_SETUP.md) - Legacy local setup (deprecated)
