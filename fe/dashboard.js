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
        document.getElementById('cpuTemp').textContent = `${cpuTemp}°C`;
        // Color coding for CPU temp
        const tempElement = document.getElementById('cpuTemp');
        if (cpuTemp > 70) {
            tempElement.className = 'font-mono text-red-400';
        } else if (cpuTemp > 60) {
            tempElement.className = 'font-mono text-yellow-400';
        } else {
            tempElement.className = 'font-mono text-green-400';
        }
    } else {
        document.getElementById('cpuTemp').textContent = 'N/A';
        document.getElementById('cpuTemp').className = 'font-mono text-gray-400';
    }

    document.getElementById('cpuUsage').textContent = `${cpuUsage}%`;
    document.getElementById('cpuCores').textContent = data.cpu.cores;
    document.getElementById('cpuFreq').textContent = `${data.cpu.frequency} MHz`;
    document.getElementById('cpuBar').style.width = `${cpuUsage}%`;
    document.getElementById('cpuPercent').textContent = `${cpuUsage}%`;
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
    document.getElementById('memBar').style.width = `${memPercent}%`;
    document.getElementById('memPercent').textContent = `${memPercent.toFixed(1)}%`;
}

/**
 * Update storage information for root partition
 */
function updateStorageInfo(data) {
    // Find root partition data
    const rootPartition = data.disk.devices.find(device =>
        device.children && device.children.some(child => child.mountpoint === '/')
    )?.children.find(child => child.mountpoint === '/');

    if (rootPartition) {
        const diskUsedGB = rootPartition.usage.used;
        const diskFreeGB = rootPartition.usage.free;
        const diskPercent = rootPartition.usage.percent;

        document.getElementById('diskUsed').textContent = `${diskUsedGB.toFixed(1)} GB`;
        document.getElementById('diskFree').textContent = `${diskFreeGB.toFixed(1)} GB`;
        document.getElementById('diskBar').style.width = `${diskPercent}%`;
        document.getElementById('diskPercent').textContent = `${diskPercent.toFixed(1)}%`;
    } else {
        document.getElementById('diskUsed').textContent = 'N/A';
        document.getElementById('diskFree').textContent = 'N/A';
        document.getElementById('diskBar').style.width = '0%';
        document.getElementById('diskPercent').textContent = '0%';
    }
}

/**
 * Update Docker status and container information
 */
function updateDockerInfo(data) {
    const dockerStatusEl = document.getElementById('dockerStatus');
    const dockerStatusText = document.getElementById('dockerStatusText');

    if (data.docker.status === 'running') {
        dockerStatusEl.className = 'w-3 h-3 bg-green-500 rounded-full animate-pulse-slow';
        dockerStatusText.textContent = 'Running';
        dockerStatusText.className = 'text-green-400';
    } else if (data.docker.status === 'stopped') {
        dockerStatusEl.className = 'w-3 h-3 bg-red-500 rounded-full';
        dockerStatusText.textContent = 'Stopped';
        dockerStatusText.className = 'text-red-400';
    } else {
        dockerStatusEl.className = 'w-3 h-3 bg-gray-500 rounded-full';
        dockerStatusText.textContent = 'Unknown';
        dockerStatusText.className = 'text-gray-400';
    }

    document.getElementById('dockerContainers').textContent = data.docker.containers;
    document.getElementById('dockerRunning').textContent = data.docker.running;

    // Show Docker error if present
    const dockerErrorEl = document.getElementById('dockerError');
    if (data.docker.error) {
        dockerErrorEl.textContent = data.docker.error;
        dockerErrorEl.classList.remove('hidden');
    } else {
        dockerErrorEl.classList.add('hidden');
    }
}

/**
 * Update Cloudflared tunnel status
 */
function updateCloudflaredInfo(data) {
    const cloudflaredStatusEl = document.getElementById('cloudflaredStatus');
    const cloudflaredStatusText = document.getElementById('cloudflaredStatusText');

    if (data.cloudflared.status === 'connected') {
        cloudflaredStatusEl.className = 'w-3 h-3 bg-green-500 rounded-full animate-pulse-slow';
        cloudflaredStatusText.textContent = 'Connected';
        cloudflaredStatusText.className = 'text-green-400';
    } else if (data.cloudflared.status === 'disconnected') {
        cloudflaredStatusEl.className = 'w-3 h-3 bg-red-500 rounded-full';
        cloudflaredStatusText.textContent = 'Disconnected';
        cloudflaredStatusText.className = 'text-red-400';
    } else {
        cloudflaredStatusEl.className = 'w-3 h-3 bg-gray-500 rounded-full';
        cloudflaredStatusText.textContent = 'Unknown';
        cloudflaredStatusText.className = 'text-gray-400';
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
        serviceEl.className = 'flex justify-between items-center p-4 bg-gray-700/30 backdrop-blur-sm rounded-lg border border-gray-600/30 hover:bg-gray-600/40 transition-all duration-300';

        let statusClass, statusIcon;
        switch(service.status) {
            case 'running':
            case 'active':
                statusClass = 'text-green-400';
                statusIcon = '●';
                break;
            case 'stopped':
            case 'inactive':
                statusClass = 'text-red-400';
                statusIcon = '○';
                break;
            default:
                statusClass = 'text-gray-400';
                statusIcon = '?';
        }

        serviceEl.innerHTML = `
            <span>${service.name}</span>
            <span class="${statusClass}">${statusIcon} ${service.status}</span>
        `;
        servicesList.appendChild(serviceEl);
    });
}

/**
 * Update disk devices information (excluding mmcblk devices shown in root storage)
 */
function updateDiskDevicesInfo(data) {
    const diskDevicesList = document.getElementById('diskDevicesList');
    diskDevicesList.innerHTML = '';

    data.disk.devices.filter(device => !device.name.startsWith('mmcblk')).forEach(device => {
        const deviceEl = document.createElement('div');
        deviceEl.className = 'bg-gray-700/30 backdrop-blur-sm rounded-xl p-5 border border-gray-600/30 hover:border-gray-500/50 transition-all duration-300';

        let deviceInfo = `
            <div class="flex justify-between items-center mb-3">
                <h3 class="text-lg font-medium">${device.name}</h3>
                <span class="text-sm text-gray-400">${device.size}</span>
            </div>
        `;

        if (device.children && device.children.length > 0) {
            device.children.forEach(partition => {
                const usage = partition.usage;
                const usagePercent = usage ? usage.percent : 0;
                const mountpoint = partition.mountpoint || 'Not mounted';

                deviceInfo += `
                    <div class="mb-3 p-4 bg-gray-600/40 backdrop-blur-sm rounded-lg border border-gray-500/20">
                        <div class="flex justify-between items-center mb-2">
                            <span class="font-medium">${partition.name}</span>
                            <span class="text-sm text-gray-300">${partition.size}</span>
                        </div>
                        <div class="text-sm text-gray-400 mb-2">
                            Mount: ${mountpoint}
                        </div>
                        ${usage ? `
                            <div class="flex justify-between text-sm mb-1">
                                <span>Used: ${usage.used.toFixed(1)}GB</span>
                                <span>Free: ${usage.free.toFixed(1)}GB</span>
                            </div>
                            <div class="w-full bg-gray-800/50 rounded-full h-2.5 shadow-inner">
                                <div class="bg-gradient-to-r from-cyan-400 to-blue-500 h-2.5 rounded-full transition-all duration-500" style="width: ${usagePercent}%"></div>
                            </div>
                            <div class="text-xs text-gray-400 mt-1">${usagePercent.toFixed(1)}% used</div>
                        ` : '<div class="text-sm text-gray-400">No usage data</div>'}
                    </div>
                `;
            });
        }

        deviceEl.innerHTML = deviceInfo;
        diskDevicesList.appendChild(deviceEl);
    });
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
        refreshBtn.textContent = 'Loading...';
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
            refreshBtn.textContent = 'Refresh Data';
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
