const socket = io();

// Elements
const elBuyPrice = document.getElementById('buy-price');
const elSellPrice = document.getElementById('sell-price');
const elTime = document.getElementById('update-time');
const elStatus = document.getElementById('status-indicator');
const elLog = document.getElementById('log-container');
const form = document.getElementById('config-form');

// Inputs
const inpInterval = document.getElementById('interval');
const inpLow = document.getElementById('lowThreshold');
const inpHigh = document.getElementById('highThreshold');
const inpFlucThresh = document.getElementById('fluctuationThreshold');
const inpFlucWindow = document.getElementById('fluctuationWindow');
const inpBark = document.getElementById('barkUrl');
const radiosMode = document.getElementsByName('fluctuationMode');
const elThresholdUnit = document.getElementById('threshold-unit');
const btnTestBark = document.getElementById('test-bark');

// State
let currentConfig = {};

// Helper: Add Log
function addLog(msg, type = 'info') {
    const div = document.createElement('div');
    div.className = `log-item ${type}`;
    div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    elLog.prepend(div);
    if (elLog.children.length > 50) elLog.lastChild.remove();
}

// Helper: Update UI
function updatePriceUI(data) {
    elBuyPrice.textContent = data.zBuyPrc;
    elSellPrice.textContent = data.zSelPrc;
    elTime.textContent = data.NowTime || new Date().toLocaleTimeString();
    
    // Simple visual flash
    document.querySelector('.price-card').style.borderColor = 'var(--accent-color)';
    setTimeout(() => {
        document.querySelector('.price-card').style.borderColor = 'var(--border-color)';
    }, 300);
}

// Initial Load
async function fetchPrice() {
    try {
        const res = await fetch('/api/price');
        const json = await res.json();
        if (json.success && json.data) {
            updatePriceUI(json.data);
            addLog('已获取最新价格');
        }
    } catch (err) {
        console.error('Initial fetch failed', err);
    }
}

// Socket Events
socket.on('connect', () => {
    elStatus.textContent = '已连接';
    elStatus.classList.add('connected');
    addLog('服务器已连接');
    loadConfig();
    fetchPrice(); // Fetch immediately on connect
});

socket.on('disconnect', () => {
    elStatus.textContent = '断开连接';
    elStatus.classList.remove('connected');
    addLog('服务器断开连接', 'alert');
});

socket.on('priceUpdate', (data) => {
    updatePriceUI(data);
});

socket.on('alert', (alert) => {
    addLog(`${alert.title}: ${alert.body}`, 'alert');
});

// UI Logic: Toggle Unit
radiosMode.forEach(radio => {
    radio.addEventListener('change', (e) => {
        if (e.target.checked) {
            elThresholdUnit.textContent = e.target.value === 'percent' ? '(%)' : '(元)';
        }
    });
});

// Config Logic
async function loadConfig() {
    try {
        const res = await fetch('/api/config');
        const config = await res.json();
        currentConfig = config;
        
        inpInterval.value = config.interval;
        inpLow.value = config.lowThreshold;
        inpHigh.value = config.highThreshold;
        inpFlucThresh.value = config.fluctuationThreshold;
        inpFlucWindow.value = config.fluctuationWindow;
        inpBark.value = config.barkUrl || '';

        // Set Radio
        const mode = config.fluctuationMode || 'percent'; // default
        radiosMode.forEach(r => {
            if (r.value === mode) r.checked = true;
        });
        elThresholdUnit.textContent = mode === 'percent' ? '(%)' : '(元)';

    } catch (err) {
        addLog('加载配置失败', 'alert');
    }
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    let selectedMode = 'percent';
    radiosMode.forEach(r => { if (r.checked) selectedMode = r.value; });

    const newConfig = {
        interval: parseInt(inpInterval.value),
        lowThreshold: parseFloat(inpLow.value),
        highThreshold: parseFloat(inpHigh.value),
        fluctuationThreshold: parseFloat(inpFlucThresh.value),
        fluctuationWindow: parseFloat(inpFlucWindow.value),
        fluctuationMode: selectedMode,
        barkUrl: inpBark.value.trim()
    };

    try {
        const res = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newConfig)
        });
        const data = await res.json();
        if (data.success) {
            addLog('配置已保存并生效');
            currentConfig = data.config;
        } else {
            addLog('保存配置失败', 'alert');
        }
    } catch (err) {
        addLog('保存请求异常', 'alert');
    }
});

btnTestBark.addEventListener('click', async () => {
    const url = inpBark.value.trim();
    addLog('正在发送测试通知...');
    try {
        const res = await fetch('/api/test-bark', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const data = await res.json();
        if (data.success) {
            addLog('测试通知发送成功');
        } else {
            addLog(`测试通知发送失败: ${data.message}`, 'alert');
        }
    } catch (err) {
        addLog(`网络异常: ${err.message}`, 'alert');
    }
});
