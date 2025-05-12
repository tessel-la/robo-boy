@echo off
:: Script to test Docker builds locally

echo ===== Testing Robo-Boy Docker Builds =====

:: Move to the project root directory
cd /d "%~dp0\.."

:: Build the React app container
echo Building React app container from Dockerfile.dev...
docker build -t robo-boy-app -f Dockerfile.dev .
if %ERRORLEVEL% neq 0 (
  echo Failed to build React app container!
  exit /b %ERRORLEVEL%
)
echo App container build successful

:: Build the ROS stack container
echo Building ROS stack container from Dockerfile.ros...
docker build -t robo-boy-ros -f Dockerfile.ros .
if %ERRORLEVEL% neq 0 (
  echo Failed to build ROS stack container!
  exit /b %ERRORLEVEL%
)
echo ROS stack container build successful

:: Test docker-compose build
echo Testing full docker-compose build...
:: Check if the certs directory exists, create if not
if not exist certs (
  echo Creating dummy certificate files for testing...
  mkdir certs
  type nul > certs\local-key.pem
  type nul > certs\local-cert.pem
)

:: Build with docker-compose
docker compose build
if %ERRORLEVEL% neq 0 (
  echo Failed to build with docker-compose!
  exit /b %ERRORLEVEL%
)
echo Docker Compose build successful

echo ===== All Docker builds completed successfully ===== 