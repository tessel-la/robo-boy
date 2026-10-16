# Stage 1: Build the React application
FROM node:20-alpine as builder
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
# Use npm ci for clean installs in CI/CD environments
RUN npm ci

# Copy the rest of the application code
COPY . .

ARG VITE_ENTERPRISE_LOGIN=false
ARG VITE_ENTERPRISE_SERVER_URL=
ARG ROBOBOY_BRANDING_FILE=
ENV VITE_ENTERPRISE_LOGIN=${VITE_ENTERPRISE_LOGIN}
ENV VITE_ENTERPRISE_SERVER_URL=${VITE_ENTERPRISE_SERVER_URL}
ENV ROBOBOY_BRANDING_FILE=${ROBOBOY_BRANDING_FILE}

# Build the application
# This runs 'tsc && vite build' as defined in package.json
RUN npm run build

# Stage 2: Serve the application using Nginx
FROM nginx:stable-alpine

# Copy built assets from the builder stage to Nginx's web root
COPY --from=builder /app/dist /usr/share/nginx/html
COPY infra/enterprise/nginx.conf /etc/nginx/enterprise.conf

# Expose port 80 for Nginx
EXPOSE 80

# Start Nginx and keep it in the foreground
CMD ["nginx", "-g", "daemon off;"]
