/**
 * Raspberry Pi Dashboard - Client-side JavaScript
 * Handles real-time system monitoring and UI updates
 */

// API Configuration - Change this to match your setup
const API_BASE = 'http(s)://YOUR_PI_IP:5555/api';

// Track if this is the first load
let isFirstLoad = true;

/**
 * Fetch real data from API using the combined endpoint
 */
async function fetchSystemData() {
    try {
        const response = await fetch(`${API_BASE}/all`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching system data:', error);
        // Fallback to individual API calls if /all endpoint fails
        return await fetchSystemDataIndividually();
    }
}

/**
 * Fallback: fetch data from individual endpoints
 */
async function fetchSystemDataIndividually() {
    const [system, cpu, memory, disk, docker, cloudflared, services] = await Promise.all([
        fetch(`${API_BASE}/system`).then(r => r.json()),
        fetch(`${API_BASE}/cpu`).then(r => r.json()),
        fetch(`${API_BASE}/memory`).then(r => r.json()),
        fetch(`${API_BASE}/disk`).then(r => r.json()),
        fetch(`${API_BASE}/docker`).then(r => r.json()),
        fetch(`${API_BASE}/cloudflared`).then(r => r.json()),
        fetch(`${API_BASE}/services`).then(r => r.json())
    ]);

    return { system, cpu, memory, disk, docker, cloudflared, services };
}

/**
 * Update system information section
 */
function updateSystemInfo(data) {
    // Update "Last updated" with server time (when data was fetched)
    const serverTime = data.timestamp || data.system.date;
    document.getElementById('lastUpdated').textContent = `Last updated: ${serverTime}`;

    // Update current system date with real-time
    const currentTime = new Date().toLocaleString('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).replace(',', '');

    // Update the system date field to show current time
    document.getElementById('currentDate').textContent = currentTime;

    // System info
    document.getElementById('hostname').textContent = data.system.hostname;
    document.getElementById('uptime').textContent = data.system.uptime;
    document.getElementById('platform').textContent = data.system.platform;
    document.getElementById('architecture').textContent = data.system.architecture;
}

/**
 * Update CPU information and visual indicators
 */
function updateCPUInfo(data) {
    const cpuTemp = data.cpu.temperature;
    const cpuUsage = data.cpu.usage;

    if (cpuTemp !== null) {
        const tempElement = document.getElementById('cpuTemp');
        tempElement.textContent = `${cpuTemp}°C`;
        // Simple color coding for CPU temp
        if (cpuTemp > 70) {
            tempElement.className = 'status-error';
        } else if (cpuTemp > 60) {
            tempElement.className = 'status-warn';
        } else {
            tempElement.className = '';
        }
    } else {
        document.getElementById('cpuTemp').textContent = 'N/A';
    }

    document.getElementById('cpuCores').textContent = data.cpu.cores;
    document.getElementById('cpuFreq').textContent = `${data.cpu.frequency} MHz`;
    document.getElementById('cpuPercent').textContent = `${cpuUsage}%`;
    
    // Update modern progress bar
    document.getElementById('cpuBar').style.width = `${cpuUsage}%`;
}

/**
 * Update memory information and progress bar
 */
function updateMemoryInfo(data) {
    const memUsedGB = data.memory.used;
    const memTotalGB = data.memory.total;
    const memAvailableGB = data.memory.available;
    const memPercent = data.memory.percent;

    document.getElementById('memUsed').textContent = `${memUsedGB.toFixed(2)} GB`;
    document.getElementById('memFree').textContent = `${memAvailableGB.toFixed(2)} GB`;
    document.getElementById('memTotal').textContent = `${memTotalGB.toFixed(2)} GB`;
    document.getElementById('memPercent').textContent = `${memPercent.toFixed(1)}%`;
    
    // Update modern progress bar
    document.getElementById('memBar').style.width = `${memPercent}%`;
}

/**
 * Update storage information for root and boot partitions
 */
function updateStorageInfo(data) {
    // Find all relevant partitions (root and boot)
    const relevantPartitions = [];

    data.disk.devices.forEach(device => {
        if (device.children) {
            device.children.forEach(child => {
                if (child.mountpoint === '/' || (child.mountpoint && child.mountpoint.startsWith('/boot'))) {
                    relevantPartitions.push(child);
                }
            });
        }
    });

    if (relevantPartitions.length > 0) {
        // Combine usage statistics from all relevant partitions
        let totalUsed = 0;
        let totalFree = 0;
        let totalSize = 0;

        relevantPartitions.forEach(partition => {
            if (partition.usage) {
                totalUsed += partition.usage.used;
                totalFree += partition.usage.free;
                totalSize += partition.usage.total;
            }
        });

        const combinedPercent = totalSize > 0 ? (totalUsed / totalSize) * 100 : 0;

        document.getElementById('diskUsed').textContent = `${totalUsed.toFixed(1)} GB`;
        document.getElementById('diskFree').textContent = `${totalFree.toFixed(1)} GB`;
        document.getElementById('diskTotal').textContent = `${totalSize.toFixed(1)} GB`;
        document.getElementById('diskPercent').textContent = `${combinedPercent.toFixed(1)}%`;
        
        // Update modern progress bar
        document.getElementById('diskBar').style.width = `${combinedPercent}%`;
    } else {
        document.getElementById('diskUsed').textContent = 'N/A';
        document.getElementById('diskFree').textContent = 'N/A';
        document.getElementById('diskTotal').textContent = 'N/A';
        document.getElementById('diskPercent').textContent = '0%';
        
        // Update modern progress bar
        document.getElementById('diskBar').style.width = '0%';
    }
}

/**
 * Update Docker status and container information
 */
function updateDockerInfo(data) {
    const dockerStatusText = document.getElementById('dockerStatusText');

    if (data.docker.status === 'running') {
        dockerStatusText.textContent = 'Running';
        dockerStatusText.className = 'text-emerald-400 font-medium font-mono text-sm';
    } else if (data.docker.status === 'stopped') {
        dockerStatusText.textContent = 'Stopped';
        dockerStatusText.className = 'text-red-400 font-medium font-mono text-sm';
    } else {
        dockerStatusText.textContent = 'Unknown';
        dockerStatusText.className = 'text-gray-400 font-medium font-mono text-sm';
    }

    // Update container counts with colors
    const dockerContainersEl = document.getElementById('dockerContainers');
    const dockerRunningEl = document.getElementById('dockerRunning');
    
    const totalContainers = data.docker.containers || 0;
    const runningContainers = data.docker.running || 0;
    const stoppedContainers = totalContainers - runningContainers;
    
    dockerContainersEl.textContent = totalContainers;
    dockerContainersEl.className = 'text-white font-medium font-mono text-sm';
    
    // Show running containers in green
    dockerRunningEl.innerHTML = `<span class="text-emerald-400">${runningContainers}</span>`;
    
    // Add stopped/exited containers display if there are any
    if (stoppedContainers > 0) {
        dockerRunningEl.innerHTML += ` / <span class="text-red-400">${stoppedContainers} stopped</span>`;
    }

    // Show Docker error if present
    const dockerErrorEl = document.getElementById('dockerError');
    if (data.docker.error) {
        dockerErrorEl.textContent = data.docker.error;
        dockerErrorEl.style.display = 'block';
    } else {
        dockerErrorEl.style.display = 'none';
    }
}

/**
 * Update Cloudflared tunnel status
 */
function updateCloudflaredInfo(data) {
    const cloudflaredStatusText = document.getElementById('cloudflaredStatusText');

    if (data.cloudflared.status === 'connected') {
        cloudflaredStatusText.textContent = 'Connected';
        cloudflaredStatusText.className = 'text-emerald-400 font-medium font-mono text-sm';
    } else if (data.cloudflared.status === 'disconnected') {
        cloudflaredStatusText.textContent = 'Disconnected';
        cloudflaredStatusText.className = 'text-red-400 font-medium font-mono text-sm';
    } else {
        cloudflaredStatusText.textContent = 'Unknown';
        cloudflaredStatusText.className = 'text-gray-400 font-medium font-mono text-sm';
    }

    document.getElementById('cloudflaredTunnel').textContent = data.cloudflared.tunnel;
    document.getElementById('cloudflaredUptime').textContent = data.cloudflared.uptime;
}

/**
 * Update services status list
 */
function updateServicesInfo(data) {
    const servicesList = document.getElementById('servicesList');
    servicesList.innerHTML = '';

    data.services.forEach(service => {
        const serviceEl = document.createElement('div');
        serviceEl.className = 'bg-black/20 border border-white/10 rounded-lg p-3 flex justify-between items-center hover:bg-black/30 transition-colors duration-200';

        let statusDot, statusText;
        
        // Simple status indicators
        switch(service.status) {
            case 'running':
            case 'active':
                statusDot = '<div class="w-2 h-2 bg-emerald-500 rounded-full"></div>';
                statusText = '<span class="text-emerald-400 font-medium text-xs">Running</span>';
                break;
            case 'stopped':
            case 'inactive':
                statusDot = '<div class="w-2 h-2 bg-red-500 rounded-full"></div>';
                statusText = '<span class="text-red-400 font-medium text-xs">Stopped</span>';
                break;
            default:
                statusDot = '<div class="w-2 h-2 bg-gray-500 rounded-full"></div>';
                statusText = '<span class="text-gray-400 font-medium text-xs">Unknown</span>';
        }

        serviceEl.innerHTML = `
            <span class="text-white font-medium text-sm">${service.display_name}</span>
            <div class="flex items-center gap-2">
                ${statusDot}
                ${statusText}
            </div>
        `;
        servicesList.appendChild(serviceEl);
    });
}

/**
 * Update disk devices information (excluding mmcblk devices shown in root storage)
 */
function updateDiskDevicesInfo(data) {
    const diskDevicesList = document.getElementById('diskDevicesList');
    let html = `
        <div class="overflow-x-auto">
            <table class="w-full text-sm">
                <thead>
                    <tr class="text-gray-400 border-b border-white/10">
                        <th class="text-left py-3 font-medium">Device</th>
                        <th class="text-left py-3 font-medium">Size</th>
                        <th class="text-left py-3 font-medium">Mount Point</th>
                        <th class="text-left py-3 font-medium">Usage</th>
                    </tr>
                </thead>
                <tbody>
    `;

    data.disk.devices.filter(device => !device.name.startsWith('mmcblk')).forEach(device => {
        html += `
            <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td class="py-3 text-white font-mono font-semibold">${device.name}</td>
                <td class="py-3 text-gray-300">${device.size}</td>
            </tr>
        `;
        
        if (device.children && device.children.length > 0) {
            device.children.forEach(partition => {
                const usage = partition.usage;
                const usagePercent = usage ? parseFloat(usage.percent.toFixed(1)) : 0;
                const mountpoint = partition.mountpoint || 'Not mounted';
                const usageText = usage ? `${usage.used.toFixed(1)}GB / ${usage.total.toFixed(1)}GB` : 'No data';
                
                // Determine progress bar color based on usage percentage
                let progressColor = 'from-emerald-500 to-emerald-600'; // Default green
                if (usagePercent > 80) {
                    progressColor = 'from-red-500 to-red-600'; // High usage - red
                } else if (usagePercent > 60) {
                    progressColor = 'from-amber-500 to-orange-600'; // Medium usage - orange
                } else if (usagePercent > 40) {
                    progressColor = 'from-yellow-500 to-yellow-600'; // Low-medium usage - yellow
                }
                
                html += `
                    <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td class="py-4 text-gray-300 font-mono pl-4">├─ ${partition.name}</td>
                        <td class="py-4 text-gray-300">${partition.size}</td>
                        <td class="py-4 text-gray-400">${mountpoint}</td>
                        <td class="py-4">
                            <div class="space-y-2">
                                <div class="flex justify-between items-center">
                                    <span class="text-gray-300 font-mono text-xs">${usageText}</span>
                                    <span class="text-white font-medium text-xs">${usagePercent}%</span>
                                </div>
                                ${usage ? `
                                <div class="w-full h-2 bg-white/10 rounded-full overflow-hidden relative">
                                    <div class="h-full bg-gradient-to-r ${progressColor} rounded-full transition-all duration-700 ease-out relative" style="width: ${usagePercent}%">
                                        <div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer"></div>
                                    </div>
                                </div>
                                ` : '<div class="text-gray-500 text-xs">No usage data</div>'}
                            </div>
                        </td>
                    </tr>
                `;
            });
        }
    });
    
    html += '</tbody></table></div>';
    diskDevicesList.innerHTML = html;
}

/**
 * Hide initial loading screen
 */
function hideInitialLoader() {
    if (isFirstLoad) {
        const initialLoader = document.getElementById('initialLoader');
        initialLoader.style.opacity = '0';
        initialLoader.style.transition = 'opacity 0.5s ease-out';
        setTimeout(() => {
            initialLoader.style.display = 'none';
        }, 500);
        isFirstLoad = false;
    }
}

/**
 * Main dashboard update function
 */
async function updateDashboard() {
    const refreshBtn = document.getElementById('refreshBtn');

    // Only show refresh button loading state if not first load
    if (!isFirstLoad) {
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = `
            <svg class="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
        `;
    }

    try {
        const data = await fetchSystemData();

        // Update all dashboard sections
        updateSystemInfo(data);
        updateCPUInfo(data);
        updateMemoryInfo(data);
        updateStorageInfo(data);
        updateDockerInfo(data);
        updateCloudflaredInfo(data);
        updateServicesInfo(data);
        updateDiskDevicesInfo(data);

        // Hide initial loader on first successful load
        hideInitialLoader();

    } catch (error) {
        console.error('Failed to update dashboard:', error);
        // Show error in the UI
        document.getElementById('lastUpdated').textContent = `Error: ${error.message}`;
    } finally {
        // Only update refresh button if not first load
        if (!isFirstLoad) {
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = `
                <svg class="w-5 h-5 transition-transform duration-300 group-hover:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                </svg>
            `;
        }
    }
}

/**
 * Initialize dashboard when DOM is loaded
 */
document.addEventListener('DOMContentLoaded', function() {
    // Event listeners
    document.getElementById('refreshBtn').addEventListener('click', updateDashboard);

    // Auto-refresh every 30 seconds
    setInterval(updateDashboard, 30000);

    // Initial load
    updateDashboard();
});
