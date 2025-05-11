#!/usr/bin/env bash
# Script to test Docker builds locally

# Exit on error
set -e

echo "===== Testing Robo-Boy Docker Builds ====="

# Build the React app container
echo "Building React app container from Dockerfile.dev..."
docker build -t robo-boy-app -f Dockerfile.dev .
echo "✅ App container build successful"

# Build the ROS stack container
echo "Building ROS stack container from Dockerfile.ros..."
docker build -t robo-boy-ros -f Dockerfile.ros .
echo "✅ ROS stack container build successful"

# Test docker-compose build
echo "Testing full docker-compose build..."
# Check if the certs directory and files exist, create if not
if [ ! -d "certs" ]; then
  echo "Creating dummy certificate files for testing..."
  mkdir -p certs
  touch certs/local-key.pem
  touch certs/local-cert.pem
fi

# Build with docker-compose
docker compose build
echo "✅ Docker Compose build successful"

echo "===== All Docker builds completed successfully =====" 