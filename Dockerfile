# Stage 1: Build the React application
FROM node:20-alpine as builder
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
# Use npm ci for clean installs in CI/CD environments
RUN npm ci

# Copy the rest of the application code
COPY . .

# Build the application
# This runs 'tsc && vite build' as defined in package.json
RUN npm run build

# Stage 2: Serve the application using Nginx
FROM nginx:stable-alpine

# Copy built assets from the builder stage to Nginx's web root
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose port 80 for Nginx
EXPOSE 80

# Start Nginx and keep it in the foreground
CMD ["nginx", "-g", "daemon off;"] 