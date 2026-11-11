/**
 * Raspberry Pi Dashboard - Client-side JavaScript
 * Polls the API, renders tiles/lists, and keeps a short in-browser history for sparklines.
 */

// API Configuration - Change this to match your setup
const API_BASE = 'https://dash.yashu.fun/api';

const REFRESH_MS = 30000;
const HISTORY_LEN = 60;            // 60 samples × 30 s = last 30 minutes
const HISTORY_KEY = 'rpi-dash-history';

// Thresholds: [warning, critical]
const PCT_LIMITS = [75, 90];
const TEMP_LIMITS = [60, 70];
const TEMP_SCALE = [20, 85];        // range drawn by the temperature meter

const $ = (id) => document.getElementById(id);
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const num = (v, digits = 1) =>
    Number.isFinite(v) ? v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';

/** Create an element with text content (never innerHTML for server data). */
function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else node.setAttribute(k, v);
    }
    for (const child of children) if (child != null) node.append(child);
    return node;
}

function levelFor(value, [warn, crit]) {
    if (!Number.isFinite(value)) return 'normal';
    if (value >= crit) return 'crit';
    if (value >= warn) return 'warn';
    return 'normal';
}

/** "3 days, 04 hrs, 12 mins, 05 secs" → "3d 4h 12m" */
function compactUptime(text) {
    if (typeof text !== 'string') return '—';
    const m = text.match(/(\d+) days?, (\d+) hrs, (\d+) mins/);
    if (!m) return text;
    const [d, h, min] = m.slice(1).map(Number);
    return d > 0 ? `${d}d ${h}h ${min}m` : h > 0 ? `${h}h ${min}m` : `${min}m`;
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

async function getJSON(path) {
    const res = await fetch(`${API_BASE}${path}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`);
    return res.json();
}

async function fetchSystemData() {
    try {
        return await getJSON('/all');
    } catch (error) {
        console.warn('Combined endpoint failed, falling back to individual calls:', error);
        const parts = ['system', 'cpu', 'memory', 'disk', 'docker', 'cloudflared', 'services'];
        const results = await Promise.allSettled(parts.map((p) => getJSON(`/${p}`)));
        if (results.every((r) => r.status === 'rejected')) throw results[0].reason;
        return Object.fromEntries(parts.map((p, i) => [p, results[i].status === 'fulfilled' ? results[i].value : null]));
    }
}

const history = loadHistory();

function loadHistory() {
    const empty = { cpu: [], temp: [], mem: [] };
    try {
        const saved = JSON.parse(sessionStorage.getItem(HISTORY_KEY));
        if (saved && Array.isArray(saved.cpu)) return { ...empty, ...saved };
    } catch { /* storage unavailable */ }
    return empty;
}

function pushHistory(key, value) {
    if (!Number.isFinite(value)) return;
    const series = history[key];
    series.push({ t: Date.now(), v: value });
    if (series.length > HISTORY_LEN) series.splice(0, series.length - HISTORY_LEN);
    try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* KPI tiles                                                           */
/* ------------------------------------------------------------------ */

function setTile(id, { value, digits = 1, sub, foot, meterPct, meterNow, level, flagText }) {
    const tile = $(id);
    tile.querySelector('[data-value]').textContent = num(value, digits);
    if (sub != null) tile.querySelector('[data-sub]').textContent = sub;
    if (foot != null) tile.querySelector('[data-foot]').textContent = foot;

    const meter = tile.querySelector('.meter');
    const pct = Math.max(0, Math.min(100, Number.isFinite(meterPct) ? meterPct : 0));
    meter.querySelector('[data-bar]').style.width = `${pct}%`;
    meter.setAttribute('aria-valuenow', String(Number.isFinite(meterNow) ? meterNow : 0));
    meter.setAttribute('aria-valuetext', Number.isFinite(value) ? `${num(value, digits)}${flagText ? `, ${flagText}` : ''}` : 'No data');
    meter.dataset.state = level;

    const flag = tile.querySelector('[data-flag]');
    flag.hidden = level === 'normal';
    flag.dataset.state = level;
    flag.textContent = level === 'crit' ? '▲ Critical' : level === 'warn' ? '▲ High' : '';
}

function updateCPU(cpu) {
    if (!cpu) return;
    const level = levelFor(cpu.usage, PCT_LIMITS);
    const freq = Number.isFinite(cpu.frequency) ? `${Math.round(cpu.frequency).toLocaleString()} MHz` : 'freq n/a';
    setTile('tileCpu', {
        value: cpu.usage, meterPct: cpu.usage, meterNow: cpu.usage, level,
        sub: `${cpu.cores ?? '—'} cores · ${freq}`,
    });
    pushHistory('cpu', cpu.usage);

    const temp = cpu.temperature;
    const tLevel = levelFor(temp, TEMP_LIMITS);
    const [lo, hi] = TEMP_SCALE;
    setTile('tileTemp', {
        value: temp, level: tLevel, meterNow: temp,
        meterPct: Number.isFinite(temp) ? ((temp - lo) / (hi - lo)) * 100 : 0,
        sub: temp == null ? 'Sensor not available' : `Warns at ${TEMP_LIMITS[0]} °C · throttles at 80 °C`,
    });
    pushHistory('temp', temp);
}

function updateMemory(mem) {
    if (!mem) return;
    setTile('tileMem', {
        value: mem.percent, meterPct: mem.percent, meterNow: mem.percent,
        level: levelFor(mem.percent, PCT_LIMITS),
        sub: `${num(mem.used, 2)} of ${num(mem.total, 2)} GB used`,
    });
    pushHistory('mem', mem.percent);
}

/** Usage objects can be the string 'unavailable' from the API — treat anything else as missing. */
const validUsage = (u) => u && typeof u === 'object' && Number.isFinite(u.percent);

function updateRootStorage(disk) {
    if (!disk) return;
    const parts = [];
    for (const device of disk.devices || []) {
        if (validUsage(device.usage) && device.mountpoint === '/') parts.push(device.usage);
        for (const child of device.children || []) {
            const mp = child.mountpoint || '';
            if ((mp === '/' || mp.startsWith('/boot')) && validUsage(child.usage)) parts.push(child.usage);
        }
    }
    if (!parts.length) {
        setTile('tileDisk', { value: NaN, level: 'normal', sub: 'Root partition not found', foot: '' });
        return;
    }
    const used = parts.reduce((s, u) => s + u.used, 0);
    const total = parts.reduce((s, u) => s + u.total, 0);
    const free = parts.reduce((s, u) => s + u.free, 0);
    const pct = total > 0 ? (used / total) * 100 : 0;
    setTile('tileDisk', {
        value: pct, meterPct: pct, meterNow: Math.round(pct),
        level: levelFor(pct, PCT_LIMITS),
        sub: `${num(used)} of ${num(total)} GB used`,
        foot: `${num(free)} GB free · root + boot`,
    });
}

/* ------------------------------------------------------------------ */
/* Sparklines                                                          */
/* ------------------------------------------------------------------ */

const SVG_NS = 'http://www.w3.org/2000/svg';
const sparkKeys = { tileCpu: 'cpu', tileTemp: 'temp', tileMem: 'mem' };

function svg(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
}

function renderSpark(container, series) {
    container.replaceChildren();
    if (series.length < 2) {
        container.append(el('p', { class: 'spark-empty', text: 'Trend appears after a few refreshes' }));
        return;
    }
    const w = container.clientWidth;
    const h = container.clientHeight;
    const pad = 4;                                  // room for the end-dot ring
    const values = series.map((p) => p.v);
    let lo, hi;
    if (container.dataset.max) {
        lo = 0; hi = Number(container.dataset.max);
    } else {
        lo = Math.min(...values) - 2; hi = Math.max(...values) + 2;
    }
    const x = (i) => pad + (i / (series.length - 1)) * (w - pad * 2);
    const y = (v) => h - pad - ((v - lo) / (hi - lo || 1)) * (h - pad * 2);

    const pts = series.map((p, i) => [x(i), y(p.v)]);
    const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
    const area = `${line}L${pts.at(-1)[0].toFixed(1)},${h}L${pts[0][0].toFixed(1)},${h}Z`;

    const root = svg('svg', { viewBox: `0 0 ${w} ${h}`, 'aria-hidden': 'true' });
    root.append(
        svg('path', { class: 'area', d: area }),
        svg('path', { class: 'line', d: line }),
    );
    const guide = svg('line', { class: 'guide', y1: 0, y2: h, visibility: 'hidden' });
    const dot = svg('circle', { class: 'dot', r: 4, cx: pts.at(-1)[0], cy: pts.at(-1)[1] });
    root.append(guide, dot);
    container.append(root);

    container._spark = { pts, series, guide, dot };
}

function renderAllSparks() {
    for (const [tileId, key] of Object.entries(sparkKeys)) {
        renderSpark($(tileId).querySelector('[data-spark]'), history[key]);
    }
}

function wireSparkHover() {
    const tip = $('sparkTip');
    document.querySelectorAll('[data-spark]').forEach((container) => {
        const reset = () => {
            tip.hidden = true;
            const s = container._spark;
            if (!s) return;
            s.guide.setAttribute('visibility', 'hidden');
            s.dot.setAttribute('cx', s.pts.at(-1)[0]);
            s.dot.setAttribute('cy', s.pts.at(-1)[1]);
        };
        container.addEventListener('pointermove', (e) => {
            const s = container._spark;
            if (!s) return;
            const rect = container.getBoundingClientRect();
            const px = e.clientX - rect.left;
            let best = 0;
            s.pts.forEach(([x], i) => { if (Math.abs(x - px) < Math.abs(s.pts[best][0] - px)) best = i; });
            const [bx, by] = s.pts[best];
            s.guide.setAttribute('x1', bx); s.guide.setAttribute('x2', bx);
            s.guide.setAttribute('visibility', 'visible');
            s.dot.setAttribute('cx', bx); s.dot.setAttribute('cy', by);

            const p = s.series[best];
            tip.replaceChildren(el('strong', { text: `${num(p.v)}${container.dataset.unit}` }), ` · ${timeFmt.format(p.t)}`);
            tip.style.left = `${rect.left + bx}px`;
            tip.style.top = `${rect.top + by}px`;
            tip.hidden = false;
        });
        container.addEventListener('pointerleave', reset);
    });
    new ResizeObserver(() => renderAllSparks()).observe($('tileCpu'));
}

/* ------------------------------------------------------------------ */
/* Status cards                                                        */
/* ------------------------------------------------------------------ */

function setStatus(node, state, label) {
    node.dataset.state = state;
    node.textContent = label;
}

function updateSystem(system) {
    if (!system) return;
    $('hostname').textContent = system.hostname || 'Raspberry Pi';
    document.title = `${system.hostname || 'Raspberry Pi'} · Dashboard`;
    $('uptime').textContent = compactUptime(system.uptime);
    $('uptime').title = system.uptime || '';
    $('platform').textContent = system.platform || '—';
    $('platform').title = system.platform || '';
    $('architecture').textContent = system.architecture || '—';
    $('serverTime').textContent = system.date || '—';
    $('hostMeta').textContent = [system.platform, system.architecture, system.uptime && `up ${compactUptime(system.uptime)}`]
        .filter(Boolean).join(' · ');
}

function updateDocker(docker) {
    if (!docker) return;
    const running = docker.status === 'running';
    setStatus($('dockerStatus'), running ? 'good' : docker.status === 'stopped' ? 'crit' : 'unknown',
        running ? 'Running' : docker.status === 'stopped' ? 'Stopped' : 'Unknown');
    $('dockerRunning').textContent = docker.running ?? 0;
    $('dockerTotal').textContent = docker.containers ?? 0;

    const list = $('containerList');
    const containers = [...(docker.container_list || [])]
        .sort((a, b) => (a.status === 'running') - (b.status === 'running') || a.name.localeCompare(b.name));
    list.replaceChildren(...containers.map((c) => {
        const state = c.status === 'running' ? 'good' : c.status === 'exited' || c.status === 'dead' ? 'crit' : 'warn';
        const label = c.status ? c.status[0].toUpperCase() + c.status.slice(1) : 'Unknown';
        return el('li', {},
            el('span', { class: 'c-name' }, el('b', { text: c.name, translate: 'no' }), el('small', { text: c.image, translate: 'no' })),
            el('span', { class: 'status', dataset: { state }, text: label }));
    }));
    if (running && !containers.length) list.append(el('li', { class: 'empty', text: 'No containers' }));

    const err = $('dockerError');
    err.hidden = !docker.error;
    err.textContent = docker.error ? `Docker unavailable: ${docker.error}` : '';
}

function updateTunnel(cf) {
    if (!cf) return;
    const map = { connected: ['good', 'Connected'], disconnected: ['crit', 'Disconnected'] };
    const [state, label] = map[cf.status] || ['warn', cf.status === 'error' ? 'Error' : 'Unknown'];
    setStatus($('tunnelStatus'), state, label);
    $('tunnelName').textContent = cf.tunnel || '—';
    $('tunnelUptime').textContent = compactUptime(cf.uptime);
    $('tunnelUptime').title = cf.uptime || '';
}

function updateServices(services) {
    if (!Array.isArray(services)) return;
    const list = $('servicesList');
    const up = services.filter((s) => s.status === 'running' || s.status === 'active').length;
    $('servicesSummary').textContent = services.length ? `${up} of ${services.length} running` : '';

    if (!services.length) {
        list.replaceChildren(el('li', { class: 'empty', text: 'No services configured in config/services.json' }));
        return;
    }
    list.replaceChildren(...services.map((s) => {
        const [state, label] =
            s.status === 'running' || s.status === 'active' ? ['good', 'Running'] :
            s.status === 'stopped' || s.status === 'inactive' ? ['crit', 'Stopped'] : ['unknown', 'Unknown'];
        return el('li', {},
            el('span', { class: 's-name' },
                el('b', { text: s.display_name || s.name, translate: 'no' }),
                s.description ? el('small', { text: s.description, title: s.description }) : null),
            el('span', { class: 'status', dataset: { state }, text: label }));
    }));
}

function updateDevices(disk) {
    if (!disk) return;
    const container = $('deviceList');
    // The SD card (mmcblk*) is already summarised in the Root storage tile.
    const devices = (disk.devices || []).filter((d) => !d.name.startsWith('mmcblk'));
    if (!devices.length) {
        container.replaceChildren(el('p', { class: 'empty', text: 'No external drives attached.' }));
        return;
    }
    container.replaceChildren(...devices.map((device) => {
        const parts = device.children?.length ? device.children : [device];
        return el('div', { class: 'device' },
            el('div', { class: 'device-head' },
                el('b', { text: device.name, translate: 'no' }),
                el('span', { text: `${device.size}${device.type ? ` · ${device.type}` : ''}` })),
            el('div', { class: 'partitions' }, ...parts.map((p) => {
                const u = validUsage(p.usage) ? p.usage : null;
                const level = u ? levelFor(u.percent, PCT_LIMITS) : 'normal';
                const name = el('span', { class: 'p-name' },
                    el('b', { text: p.name, translate: 'no' }),
                    el('small', { text: p.mountpoint ? `${p.mountpoint} · ${p.size}` : `Not mounted · ${p.size}` }));
                if (!u) return el('div', { class: 'partition' }, name, el('span', { class: 'p-none', text: 'No usage data' }), el('span'));
                const meter = el('div', {
                    class: 'meter', role: 'meter', 'aria-label': `${p.name} usage`,
                    'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(u.percent),
                    dataset: { state: level },
                }, el('span', { style: `width:${Math.min(100, u.percent)}%` }));
                const fig = el('span', { class: 'p-fig' }, `${num(u.used)} / ${num(u.total)} GB`, el('strong', { text: `${num(u.percent)}%` }));
                return el('div', { class: 'partition' }, name, meter, fig);
            })));
    }));
}

/* ------------------------------------------------------------------ */
/* Overall health                                                      */
/* ------------------------------------------------------------------ */

function updateHealth(data) {
    const issues = [];
    let worst = 'good';
    const flag = (level, msg) => {
        if (level === 'normal') return;
        issues.push(msg);
        if (level === 'crit' || worst !== 'crit') worst = level === 'crit' ? 'crit' : 'warn';
    };
    if (data.cpu) {
        flag(levelFor(data.cpu.temperature, TEMP_LIMITS), `CPU at ${data.cpu.temperature} °C`);
        flag(levelFor(data.cpu.usage, PCT_LIMITS), `CPU usage ${data.cpu.usage}%`);
    }
    if (data.memory) flag(levelFor(data.memory.percent, PCT_LIMITS), `Memory ${data.memory.percent}%`);
    for (const s of data.services || []) {
        if (s.status === 'stopped' || s.status === 'inactive') flag('crit', `${s.display_name || s.name} stopped`);
    }
    if (data.docker && data.docker.status !== 'running') flag('crit', 'Docker not running');
    if (data.cloudflared && data.cloudflared.status !== 'connected') flag('crit', 'Tunnel not connected');

    const health = $('health');
    health.dataset.state = worst;
    $('healthText').textContent = issues.length === 0 ? 'All systems normal'
        : issues.length === 1 ? issues[0] : `${issues.length} issues`;
    health.title = issues.join('\n');
}

/* ------------------------------------------------------------------ */
/* Refresh loop                                                        */
/* ------------------------------------------------------------------ */

let timer = null;
let nextAt = 0;
let inFlight = false;
let lastSuccess = 0;

async function updateDashboard() {
    if (inFlight) return;
    inFlight = true;
    clearTimeout(timer);
    const btn = $('refreshBtn');
    btn.disabled = true;
    btn.classList.add('is-spinning');
    $('lastUpdated').textContent = 'Updating…';

    try {
        const data = await fetchSystemData();
        updateSystem(data.system);
        updateCPU(data.cpu);
        updateMemory(data.memory);
        updateRootStorage(data.disk);
        updateDocker(data.docker);
        updateTunnel(data.cloudflared);
        updateServices(data.services);
        updateDevices(data.disk);
        updateHealth(data);
        renderAllSparks();

        lastSuccess = Date.now();
        $('errorBanner').hidden = true;
        $('main').setAttribute('aria-busy', 'false');
    } catch (error) {
        console.error('Failed to update dashboard:', error);
        $('errorText').textContent = lastSuccess
            ? `Can’t reach the Pi (${error.message}). Showing data from ${timeFmt.format(lastSuccess)}; retrying automatically.`
            : `Can’t reach the Pi (${error.message}). Check that the API is running at ${API_BASE}; retrying automatically.`;
        $('errorBanner').hidden = false;
        $('health').dataset.state = 'crit';
        $('healthText').textContent = 'Offline';
    } finally {
        inFlight = false;
        btn.disabled = false;
        btn.classList.remove('is-spinning');
        $('lastUpdated').textContent = lastSuccess ? `Updated ${timeFmt.format(lastSuccess)}` : 'Not updated yet';
        schedule();
    }
}

function schedule() {
    clearTimeout(timer);
    if (document.hidden) return;            // resume on visibilitychange
    nextAt = Date.now() + REFRESH_MS;
    timer = setTimeout(updateDashboard, REFRESH_MS);
}

function tickCountdown() {
    const secs = Math.max(0, Math.ceil((nextAt - Date.now()) / 1000));
    $('nextRefresh').textContent = inFlight || document.hidden || !nextAt ? '' : `next in ${secs}s`;
}

document.addEventListener('DOMContentLoaded', () => {
    $('year').textContent = new Date().getFullYear();
    $('refreshBtn').addEventListener('click', updateDashboard);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) clearTimeout(timer);
        else if (Date.now() - lastSuccess > REFRESH_MS) updateDashboard();
        else schedule();
    });
    setInterval(tickCountdown, 1000);
    wireSparkHover();
    renderAllSparks();
    updateDashboard();
});
