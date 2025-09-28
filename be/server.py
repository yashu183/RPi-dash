#!/usr/bin/env python3
"""
Raspberry Pi Dashboard API Server
Provides real system metrics via REST endpoints
"""

from flask import Flask, jsonify
from flask_cors import CORS
import psutil
import subprocess
import json
import socket
import datetime
import os
import docker
import time
from pathlib import Path

app = Flask(__name__)
CORS(app)  # Enable CORS for web dashboard

# Default services list used as fallback
DEFAULT_SERVICES = [
    {'name': 'ssh', 'display_name': 'SSH Server', 'description': 'Secure Shell daemon for remote access'},
    {'name': 'nginx', 'display_name': 'Nginx', 'description': 'Web server and reverse proxy'},
    {'name': 'docker', 'display_name': 'Docker', 'description': 'Container runtime platform'},
    {'name': 'cloudflared', 'display_name': 'Cloudflared', 'description': 'Cloudflare tunnel daemon'}
]

def load_services_config():
    """Load services configuration from JSON file"""
    config_path = Path(__file__).parent / 'config' / 'services.json'
    try:
        with open(config_path, 'r') as f:
            config = json.load(f)
            services = config.get('services')
            if services is None:
                print("Warning: 'services' key not found in config file")
                print("Using default services list")
                return DEFAULT_SERVICES
            return services
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"Warning: Could not load services config ({e})")
        print("Using default services list")
        return DEFAULT_SERVICES

def get_cpu_temperature():
    """Get CPU temperature from thermal zone"""
    try:
        with open('/sys/class/thermal/thermal_zone0/temp', 'r') as f:
            temp = int(f.read()) / 1000.0
            return round(temp, 1)
    except:
        return None

def get_uptime():
    """Get system uptime"""
    try:
        with open('/proc/uptime', 'r') as f:
            uptime_seconds = float(f.readline().split()[0])
            days = int(uptime_seconds // 86400)
            hours = int((uptime_seconds % 86400) // 3600)
            minutes = int((uptime_seconds % 3600) // 60)
            seconds = int(uptime_seconds % 60)
            return f"{days} days, {hours:02d} hrs, {minutes:02d} mins, {seconds:02d} secs"
    except:
        return "Unknown"

def get_os_info():
    """Get OS distribution information"""
    try:
        with open('/etc/os-release', 'r') as f:
            os_release = {}
            for line in f:
                if '=' in line:
                    key, value = line.strip().split('=', 1)
                    os_release[key] = value.strip('"')
            
            # Get pretty name or fall back to name
            if 'PRETTY_NAME' in os_release:
                return os_release['PRETTY_NAME']
            elif 'NAME' in os_release:
                return os_release['NAME']
    except:
        return "Unknown"

def get_docker_info():
    """Get Docker status and container information"""
    try:
        client = docker.from_env()
        containers = client.containers.list(all=True)
        running = [c for c in containers if c.status == 'running']
        
        return {
            'status': 'running',
            'containers': len(containers),
            'running': len(running),
            'container_list': [
                {
                    'name': c.name,
                    'status': c.status,
                    'image': c.image.tags[0] if c.image.tags else 'unknown'
                } for c in containers
            ]
        }
    except Exception as e:
        return {
            'status': 'stopped',
            'containers': 0,
            'running': 0,
            'error': str(e)
        }

def get_service_status(service_name):
    """Check if a systemd service is running"""
    try:
        result = subprocess.run(
            ['systemctl', 'is-active', service_name],
            capture_output=True,
            text=True,
            timeout=5
        )
        return 'running' if result.stdout.strip() == 'active' else 'stopped'
    except:
        return 'unknown'

def get_cloudflared_status():
    """Get Cloudflared tunnel status"""
    try:
        # Check if cloudflared service is running
        service_status = get_service_status('cloudflared')
        
        if service_status == 'running':
            # Try to get tunnel info from cloudflared
            result = subprocess.run(
                ['cloudflared', 'tunnel', 'list'],
                capture_output=True,
                text=True,
                timeout=10
            )
            
            # Parse tunnel information (this is basic parsing)
            tunnel_name = 'Unknown'
            if result.returncode == 0 and result.stdout:
                lines = result.stdout.strip().split('\n')
                if len(lines) > 2:  # Skip header
                    tunnel_name = lines[2].split()[1] if len(lines[2].split()) > 1 else 'Unknown'
            
            return {
                'status': 'connected',
                'tunnel': tunnel_name,
                'uptime': get_process_uptime('cloudflared')
            }
        else:
            return {
                'status': 'disconnected',
                'tunnel': 'N/A',
                'uptime': 'N/A'
            }
    except Exception as e:
        return {
            'status': 'error',
            'tunnel': 'Error',
            'uptime': 'N/A',
            'error': str(e)
        }

def get_process_uptime(process_name):
    """Get uptime for a specific process"""
    try:
        for proc in psutil.process_iter(['pid', 'name', 'create_time']):
            if process_name in proc.info['name']:
                create_time = proc.info['create_time']
                uptime_seconds = time.time() - create_time
                days = int(uptime_seconds // 86400)
                hours = int((uptime_seconds % 86400) // 3600)
                minutes = int((uptime_seconds % 3600) // 60)
                return f"{days} days, {hours:02d} hrs, {minutes:02d} mins"
        return "Not running"
    except:
        return "Unknown"

@app.route('/api/system')
def get_system_info():
    """Get basic system information"""
    return jsonify({
        'hostname': socket.gethostname(),
        'uptime': get_uptime(),
        'date': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'platform': get_os_info(),
        'architecture': os.uname().machine
    })

@app.route('/api/cpu')
def get_cpu_info():
    """Get CPU information"""
    cpu_percent = psutil.cpu_percent(interval=1)
    cpu_temp = get_cpu_temperature()
    
    return jsonify({
        'usage': round(cpu_percent, 1),
        'temperature': cpu_temp,
        'cores': psutil.cpu_count(),
        'frequency': psutil.cpu_freq().current if psutil.cpu_freq() else None
    })

@app.route('/api/memory')
def get_memory_info():
    """Get memory information"""
    memory = psutil.virtual_memory()
    
    return jsonify({
        'total': round(memory.total / (1024**3), 2),  # GB
        'used': round(memory.used / (1024**3), 2),   # GB
        'available': round(memory.available / (1024**3), 2),  # GB
        'percent': round(memory.percent, 1)
    })

@app.route('/api/disk')
def get_disk_info():
    """Get disk usage information for all available devices"""
    devices = []
    
    try:
        # Get all block devices with their information
        result = subprocess.run(
            ['lsblk', '-J', '-o', 'NAME,SIZE,TYPE,MOUNTPOINT'],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        if result.returncode == 0:
            lsblk_data = json.loads(result.stdout)
            
            for device in lsblk_data.get('blockdevices', []):
                device_info = process_device(device)
                if device_info:
                    devices.append(device_info)
        
        return jsonify({
            'devices': devices,
            'total_devices': len(devices)
        })
        
    except Exception as e:
        # Fallback to root filesystem only
        disk = psutil.disk_usage('/')
        return jsonify({
            'devices': [{
                'name': 'root',
                'size': f"{round(disk.total / (1024**3), 1)}G",
                'type': 'disk',
                'mountpoint': '/',
                'usage': {
                    'total': round(disk.total / (1024**3), 1),
                    'used': round(disk.used / (1024**3), 1),
                    'free': round(disk.free / (1024**3), 1),
                    'percent': round((disk.used / disk.total) * 100, 1)
                }
            }],
            'total_devices': 1,
            'error': str(e)
        })

def process_device(device):
    """Process a device from lsblk output and get its usage info"""
    device_name = device.get('name', 'unknown')
    device_size = device.get('size', 'unknown')
    device_type = device.get('type', 'unknown')
    
    # Process main device
    device_info = {
        'name': device_name,
        'size': device_size,
        'type': device_type,
        'children': []
    }
    
    # Check if this device or its children have mountpoints
    mountpoints = []
    if device.get('mountpoint'):
        mountpoints.append(device.get('mountpoint'))
    
    # Process children (partitions)
    children = device.get('children', [])
    for child in children:
        child_info = {
            'name': child.get('name', 'unknown'),
            'size': child.get('size', 'unknown'),
            'type': child.get('type', 'unknown'),
            'mountpoint': child.get('mountpoint')
        }
        
        # Get usage info if mounted
        if child.get('mountpoint'):
            try:
                usage = psutil.disk_usage(child.get('mountpoint'))
                child_info['usage'] = {
                    'total': round(usage.total / (1024**3), 1),
                    'used': round(usage.used / (1024**3), 1),
                    'free': round(usage.free / (1024**3), 1),
                    'percent': round((usage.used / usage.total) * 100, 1)
                }
            except:
                child_info['usage'] = 'unavailable'
        
        device_info['children'].append(child_info)
        
        if child.get('mountpoint'):
            mountpoints.append(child.get('mountpoint'))
    
    # If main device is mounted, get its usage
    if device.get('mountpoint'):
        try:
            usage = psutil.disk_usage(device.get('mountpoint'))
            device_info['usage'] = {
                'total': round(usage.total / (1024**3), 1),
                'used': round(usage.used / (1024**3), 1),
                'free': round(usage.free / (1024**3), 1),
                'percent': round((usage.used / usage.total) * 100, 1)
            }
        except:
            device_info['usage'] = 'unavailable'
    
    device_info['mountpoints'] = mountpoints
    return device_info

@app.route('/api/docker')
def get_docker_status():
    """Get Docker status and container information"""
    return jsonify(get_docker_info())

@app.route('/api/cloudflared')
def get_cloudflared_info():
    """Get Cloudflared tunnel status"""
    return jsonify(get_cloudflared_status())

@app.route('/api/services')
def get_services_status():
    """Get status of important services"""
    services_config = load_services_config()

    service_status = []
    for service_config in services_config:
        service_name = service_config['name']
        status = get_service_status(service_name)
        service_status.append({
            'name': service_name,
            'display_name': service_config.get('display_name', service_name),
            'description': service_config.get('description', ''),
            'status': status
        })

    return jsonify(service_status)

@app.route('/api/all')
def get_all_data():
    """Get all system data in one request"""
    try:
        return jsonify({
            'system': get_system_info().get_json(),
            'cpu': get_cpu_info().get_json(),
            'memory': get_memory_info().get_json(),
            'disk': get_disk_info().get_json(),
            'docker': get_docker_info(),
            'cloudflared': get_cloudflared_status(),
            'services': get_services_status().get_json()
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/health')
def health_check():
    """Simple health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.datetime.now().isoformat()
    })

if __name__ == '__main__':
    print("Starting Raspberry Pi Dashboard API Server...")
    print("Access the API at: http://localhost:5555")
    print("Health check: http://localhost:5555/api/health")
    app.run(host='0.0.0.0', port=5555, debug=False)
