# Ollama Setup Guide for Habeat Server

> **⚠️ DEPRECATED: Use Docker Instead**
>
> **This local installation guide is deprecated. We now use Docker for Ollama.**
>
> **👉 Please use [DOCKER_SETUP.md](./DOCKER_SETUP.md) instead.**
>
> If you have Ollama installed locally and want to remove it, run:
>
> ```bash
> ./scripts/remove-local-ollama.sh
> ```

---

## Legacy Local Installation Guide

> This section is kept for reference only. Docker is the recommended approach.

This guide will help you set up and start Ollama locally to use Llama models for meal plan generation.

## Step 1: Install Ollama

### macOS

```bash
# Using Homebrew
brew install ollama

# Or download from: https://ollama.ai/download
```

### Linux

```bash
curl -fsSL https://ollama.ai/install.sh | sh
```

### Windows

Download the installer from: https://ollama.ai/download

## Step 2: Start Ollama Service

### macOS/Linux

```bash
# Start Ollama service (runs in background)
ollama serve

# Or run in foreground to see logs
ollama serve
```

### Windows

Ollama should start automatically after installation. If not, run:

```bash
ollama serve
```

## Step 3: Download/Pull a Llama Model

You need to download a Llama model before you can use it. The default is `llama2`:

```bash
# Pull the default llama2 model (recommended, ~4GB)
ollama pull llama2

# Or use a smaller/faster model
ollama pull llama2:7b  # Smaller, faster version

# Or use a newer model
ollama pull llama3
ollama pull llama3.1
```

**Note**: The first time you pull a model, it will download several GB of data. Make sure you have:

- Stable internet connection
- Enough disk space (at least 4-8GB free)
- Patience (download can take 10-30 minutes depending on your connection)

## Step 4: Verify Ollama is Running

### Check if Ollama is running:

```bash
# Test the API
curl http://localhost:11434/api/tags

# Or check if the service is running
curl http://localhost:11434/api/version
```

### List available models:

```bash
ollama list
```

### Test a model:

```bash
ollama run llama2 "Hello, how are you?"
```

## Step 5: Configure Your .env File

Make sure your `.env` file has the correct configuration:

```env
# AI Provider - set to llama (default)
AI_PROVIDER=llama

# Ollama Base URL
# For local: http://localhost:11434
# For remote: http://192.168.1.100:11434 (your current setting)
OLLAMA_BASE_URL=http://192.168.1.100:11434

# Ollama Model Name (default: llama2)
OLLAMA_MODEL=llama2
```

## Step 6: Test Connection from Your Server

Test if your server can connect to Ollama:

```bash
# If Ollama is on localhost
curl http://localhost:11434/api/tags

# If Ollama is on remote server (192.168.1.100)
curl http://192.168.1.100:11434/api/tags
```

## Troubleshooting

### Issue: "Ollama is not running"

**Solution**:

1. Make sure Ollama service is started: `ollama serve`
2. Check if the port is correct (default: 11434)
3. Verify the OLLAMA_BASE_URL in your .env matches where Ollama is running

### Issue: "Cannot connect to Ollama"

**Solution**:

1. If using remote server, make sure:
   - Ollama is running on that server
   - Firewall allows connections on port 11434
   - The IP address is correct
2. Test connection: `curl http://YOUR_OLLAMA_URL/api/tags`

### Issue: "Model not found"

**Solution**:

1. Pull the model: `ollama pull llama2`
2. Verify it's available: `ollama list`
3. Check OLLAMA_MODEL in .env matches the model name

### Issue: Slow generation

**Solution**:

1. Use a smaller model: `ollama pull llama2:7b`
2. Update OLLAMA_MODEL in .env to `llama2:7b`
3. Make sure you have enough RAM (models need 4-8GB+)

## Running Ollama on a Remote Server

If you're running Ollama on a different machine (like `192.168.1.100`):

1. **On the remote server**, start Ollama:

   ```bash
   ollama serve
   ```

2. **Make sure the server is accessible** from your application server:

   ```bash
   # From your app server, test connection
   curl http://192.168.1.100:11434/api/tags
   ```

3. **Configure firewall** if needed:
   ```bash
   # Allow port 11434 (example for Ubuntu/Debian)
   sudo ufw allow 11434/tcp
   ```

## Quick Start Commands

```bash
# 1. Install Ollama (if not installed)
brew install ollama  # macOS
# or
curl -fsSL https://ollama.ai/install.sh | sh  # Linux

# 2. Start Ollama
ollama serve

# 3. Pull a model (in a new terminal)
ollama pull llama2

# 4. Verify it works
ollama list
ollama run llama2 "test"

# 5. Your server should now be able to use Llama!
```

## Model Recommendations

- **llama2** (default): Good balance of quality and speed (~4GB)
- **llama2:7b**: Faster, smaller version (~4GB)
- **llama3**: Newer, better quality (~4.7GB)
- **llama3.1**: Latest version with improved performance

Choose based on your hardware capabilities and quality requirements.
