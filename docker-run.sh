#!/bin/bash

# Simple Docker run script for Raspberry Pi Dashboard Backend

echo "Building Raspberry Pi Dashboard Backend..."
docker build -t rpi-dashboard-api .

echo "Starting container..."
docker run -d \
  --name rpi-dashboard-api \
  --restart unless-stopped \
  -p 5555:5555 \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /sys/class/thermal:/sys/class/thermal:ro \
  -v /proc:/proc \
  -v $(pwd)/be/config:/app/config:ro \
  --cap-add SYS_ADMIN \
  --device /dev/mem:/dev/mem:r \
  --privileged \
  rpi-dashboard-api

echo "Dashboard API started!"
echo "Access at: http://$(hostname -I | awk '{print $1}'):5555"
echo "Health check: http://$(hostname -I | awk '{print $1}'):5555/api/health"
echo ""
echo "To stop: docker stop rpi-dashboard-api"
echo "To remove: docker rm rpi-dashboard-api"