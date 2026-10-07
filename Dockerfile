# REXON Enterprise Multi-Platform Container
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Copy application files
COPY . .

# Expose HTTP port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => { if (r.statusCode !== 200) process.exit(1); });"

# Start the unified server (Web + REST API + Telegram Bot Gateway)
CMD ["node", "server.js"]
