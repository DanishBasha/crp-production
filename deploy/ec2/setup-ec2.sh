#!/bin/bash
# ==============================================================================
# Communication Readiness Platform - EC2 Provisioning & Deployment Script
# Target OS: Ubuntu 22.04 LTS / 24.04 LTS or Amazon Linux 2023
# ==============================================================================

set -e

echo "=========================================================="
echo " Starting CRP Backend & AI-Service EC2 Setup"
echo "=========================================================="

# 1. Update OS and install prerequisites
echo "--> Updating system packages..."
if command -v apt-get &> /dev/null; then
    sudo apt-get update -y
    sudo apt-get install -y ca-certificates curl gnupg lsb-release git ufw
elif command -v dnf &> /dev/null; then
    sudo dnf update -y
    sudo dnf install -y git curl
fi

# 2. Install Docker & Docker Compose
if ! command -v docker &> /dev/null; then
    echo "--> Installing Docker Engine..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    rm -f get-docker.sh
    sudo usermod -aG docker "$USER"
    echo "Docker installed successfully."
else
    echo "--> Docker is already installed."
fi

# 3. Ensure Docker service is running
sudo systemctl enable docker
sudo systemctl start docker

# 4. Check .env files in backend and ai-service
echo "--> Checking environment configuration..."
if [ ! -f "backend/.env" ]; then
    echo "WARNING: backend/.env not found! Creating from template..."
    cat << 'EOF' > backend/.env
PORT=5000
NODE_ENV=production
AI_SERVICE_URL=http://ai-service:8000
CORS_ORIGIN=*
JWT_SECRET=crp-prod-secret-change-in-production-min-32-chars
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
JWT_EXPIRES_IN=7d
DATABASE_URL=your_supabase_database_url_here
UPLOAD_MAX_FILE_SIZE_MB=5
UPLOAD_DIR=uploads
AI_INTERNAL_KEY=crp-internal-dev-key-change-in-prod
DEEPGRAM_API_KEY=your_deepgram_api_key_here
EMAIL_PROVIDER=gmail
SMTP_USER=danishbasha18@gmail.com
SMTP_PASS=your_gmail_app_password_here
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
RESEND_API_KEY=your_resend_api_key_here
RESEND_FROM_EMAIL=onboarding@resend.dev
EOF
    echo "backend/.env created with placeholders. Please update with real credentials."
fi

if [ ! -f "ai-service/.env" ]; then
    echo "WARNING: ai-service/.env not found! Creating from template..."
    cat << 'EOF' > ai-service/.env
LLM_PROVIDER=groq
LLM_API_KEY=your_groq_api_key_here
LLM_MODEL=openai/gpt-oss-120b
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=openai/gpt-oss-120b
DEBUG=false
INTERNAL_API_KEY=crp-internal-dev-key-change-in-prod
DATABASE_URL=your_supabase_database_url_here
REDIS_URL=redis://redis:6379/0
MODULE3_PERFORMANCE_CACHE_TTL=600
MODULE3_SKILL_GAP_CACHE_TTL=600
MODULE3_KNOWLEDGE_CACHE_TTL=3600
EOF
    echo "ai-service/.env created with placeholders. Please update with real credentials."
fi

# 5. Build and launch containers
echo "--> Building and starting Docker containers..."
sudo docker compose -f docker-compose.prod.yml down --remove-orphans || true
sudo docker compose -f docker-compose.prod.yml up -d --build

# 6. Verify health
echo "--> Waiting for services to initialize..."
sleep 10

echo "--> Checking system health..."
sudo docker compose -f docker-compose.prod.yml ps

echo "--> Testing Nginx gateway health endpoint:"
curl -s http://localhost/health || echo "Failed to reach /health"
echo ""

echo "=========================================================="
echo " CRP All-in-One EC2 Deployment Complete!"
echo " Web Application: http://<EC2-PUBLIC-IP>/"
echo " Backend API:     http://<EC2-PUBLIC-IP>/api/"
echo " AI Service:      http://<EC2-PUBLIC-IP>/ai/"
echo " Health Status:   http://<EC2-PUBLIC-IP>/health"
echo "=========================================================="
