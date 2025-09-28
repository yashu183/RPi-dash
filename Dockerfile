# Dockerfile for Raspberry Pi Dashboard Backend
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies needed for monitoring
RUN apt-get update && apt-get install -y \
    util-linux \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY be/requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY be/ .

# Create logs directory
RUN mkdir -p logs

# Create non-root user for security
RUN useradd --create-home --shell /bin/bash app && \
    chown -R app:app /app
USER app

# Expose port
EXPOSE 5555

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:5555/api/health')"

# Run with gunicorn
CMD ["gunicorn", "--config", "gunicorn.conf.py", "server:app"]