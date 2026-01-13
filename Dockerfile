# Dockerfile for BROEN-LAB Chat Proxy
FROM node:18-slim

# Add non-root user for security
RUN groupadd -g 1001 nodejs && \
    useradd -m -u 1001 -g nodejs nodejs

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# Copy application files
COPY server.js ./
COPY lib/ ./lib/
COPY index.html ./
COPY chat.html ./
COPY chat.bundle.air.js ./

# Set ownership
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/healthz', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Environment variables (defaults; override at runtime)
ENV NODE_ENV=production \
    PORT=3000

# Start the application
CMD ["node", "server.js"]
