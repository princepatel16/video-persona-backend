# Use a standard Node.js image (Debian-based)
FROM node:20-bookworm-slim

# Install system dependencies for Remotion / Headless Chrome
# We install all the required libraries for Chromium and ffmpeg in one layer
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    fonts-liberation \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application code
COPY . .

# IMPORTANT: Download and bake the Remotion browser into the image during the build phase
# This prevents runtime downloads and high memory usage during generation
RUN npx remotion browser ensure

# Expose the application port (Railway usually provides PORT env var)
EXPOSE 8080

# Start the server
CMD ["node", "server.js"]
