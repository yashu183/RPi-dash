# Gunicorn configuration file for Raspberry Pi Dashboard

# Server socket
bind = "0.0.0.0:5555"
backlog = 2048

# Worker processes
workers = 2
worker_class = "sync"
worker_connections = 1000
timeout = 30
keepalive = 2

# Restart workers after this many requests, to prevent memory leaks
max_requests = 1000
max_requests_jitter = 50

# Logging
accesslog = "logs/access.log"
errorlog = "logs/error.log"
loglevel = "info"
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s"'

# Process naming
proc_name = "rpi-dashboard"

# Daemon mode (uncomment for background running)
daemon = True
pidfile = "logs/gunicorn.pid"

# User/group to run as (uncomment and modify as needed)
# user = "pi"
# group = "pi"

# Preload app for better performance
preload_app = True

# Graceful timeout
graceful_timeout = 30