const socket = io();

const btnTestBark = document.getElementById('test-bark');

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
const radiosChannel = document.getElementsByName('alertChannel');
const elThresholdUnit = document.getElementById('threshold-unit');

// Intl Elements
const elIntlCard = document.getElementById('intl-price-card');
const elIntlUsd = document.getElementById('intl-price-usd');
const elIntlCnyPrice = document.getElementById('intl-price-cny');
const elIntlChangeVal = document.getElementById('intl-change-val');
const elIntlChangePercent = document.getElementById('intl-change-percent');
const elIntlHighUsd = document.getElementById('intl-high-usd');
const elIntlHighCny = document.getElementById('intl-high-cny');
const elIntlLowUsd = document.getElementById('intl-low-usd');
const elIntlLowCny = document.getElementById('intl-low-cny');
const elIntlTime = document.getElementById('intl-time');
const elIntlStatus = document.getElementById('intl-status');


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

// Helper: Update Individual Gold Card
function updateCard(cardId, data, elements) {
    const card = document.getElementById(cardId);
    if (!card) return;

    // 1. Set Prices and Changes (Fixed to 2 decimals)
    const setVal = (el, val, prefix = '') => {
        if (!el) return;
        const num = parseFloat(val);
        el.textContent = isNaN(num) ? '--.--' : (prefix + num.toFixed(2));
    };

    setVal(elements.price, data.price);
    setVal(elements.change, data.change, data.change >= 0 ? '+' : '');
    setVal(elements.percent, data.changePercent, data.changePercent >= 0 ? '+' : '');

    // 2. Set Grid Info
    if (elements.grid) {
        for (const [key, el] of Object.entries(elements.grid)) {
            if (el) setVal(el, data[key]);
        }
    }

    // 3. Set Color State
    card.classList.remove('up', 'down');
    const change = parseFloat(data.change);
    if (change > 0) card.classList.add('up');
    else if (change < 0) card.classList.add('down');

    // 4. Flash Effect
    card.classList.add('flash');
    setTimeout(() => card.classList.remove('flash'), 400);
}

// Helper: Update UI
function updatePriceUI(data) {
    // 1. International USD
    if (data.intl && data.intl.usd) {
        updateCard('card-intl-usd', data.intl.usd, {
            price: document.getElementById('intl-price-usd'),
            change: document.getElementById('intl-change-usd'),
            percent: document.getElementById('intl-percent-usd'),
            grid: {
                high: document.getElementById('intl-high-usd'),
                low: document.getElementById('intl-low-usd'),
                open: document.getElementById('intl-open-usd'),
                close: document.getElementById('intl-close-usd'),
            }
        });
        document.getElementById('intl-time-usd').textContent = `更新: ${data.intl.usd.time|| '--'}`;
    }

    // 2. International CNY
    if (data.intl && data.intl.cny) {
        updateCard('card-intl-cny', data.intl.cny, {
            price: document.getElementById('intl-price-cny'),
            change: document.getElementById('intl-change-cny'),
            percent: document.getElementById('intl-percent-cny'),
            grid: {
                high: document.getElementById('intl-high-cny'),
                low: document.getElementById('intl-low-cny'),
                open: document.getElementById('intl-open-cny'),
                close: document.getElementById('intl-close-cny'),
            }
        });
        document.getElementById('intl-time-cny').textContent = `更新: ${data.intl.cny.time}`;
    }

    // 3. CMB Gold
    if (data.cmb) {
        updateCard('card-cmb', data.cmb, {
            price: document.getElementById('cmb-price'),
            change: document.getElementById('cmb-change'),
            percent: document.getElementById('cmb-percent'),
            grid: {
                buy: document.getElementById('cmb-buy'),
                sell: document.getElementById('cmb-sell'),
                high: document.getElementById('cmb-high'),
                low: document.getElementById('cmb-low'),
                close: document.getElementById('cmb-close'),
            }
        });
        document.getElementById('cmb-time').textContent = `更新: ${data.cmb.time || '--'}`;
    }

    // 4. CCB Gold
    if (data.ccb) {
        updateCard('card-ccb', data.ccb, {
            price: document.getElementById('ccb-price'),
            change: document.getElementById('ccb-change'),
            percent: document.getElementById('ccb-percent'),
            grid: {
                buy: document.getElementById('ccb-buy'),
                sell: document.getElementById('ccb-sell'),
                high: document.getElementById('ccb-high'),
                low: document.getElementById('ccb-low'),
                close: document.getElementById('ccb-close'),
            }
        });
        document.getElementById('ccb-time').textContent = `更新: ${data.ccb.time|| '--'}`;
    }
}

// Initial Load
async function fetchPrice() {
    try {
        elStatus.textContent = '实时同步中...';
        const res = await fetch('/api/price');
        const json = await res.json();
        if (json.success && json.data) {
            updatePriceUI(json.data);
            addLog('已实时同步最新价格');
        }
        elStatus.textContent = '已连接';
    } catch (err) {
        console.error('Initial fetch failed', err);
        elStatus.textContent = '同步失败';
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

const barkListContainer = document.getElementById('bark-url-list');
const btnAddBark = document.getElementById('add-bark-url');

function createBarkItem(value = '') {
    const div = document.createElement('div');
    div.className = 'dynamic-item';
    div.innerHTML = `
        <div class="box-style" style="flex:1"><input type="text" class="bark-url-input" placeholder="Bark 链接" value="${value}"></div>
        <button type="button" class="btn-remove">X</button>
    `;
    div.querySelector('.btn-remove').onclick = () => div.remove();
    barkListContainer.appendChild(div);
}

btnAddBark.onclick = () => createBarkItem();

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
        
        // 重试配置
        document.getElementById('alertRetryCount').value = config.alertRetryCount || 0;
        document.getElementById('alertRetryInterval').value = config.alertRetryInterval || 5;

        // 加载列表
        barkListContainer.innerHTML = '';
        const urls = Array.isArray(config.barkUrl) ? config.barkUrl : (config.barkUrl ? [config.barkUrl] : []);
        if (urls.length === 0) createBarkItem();
        else urls.forEach(u => createBarkItem(u));

        // Set Radio
        const mode = config.fluctuationMode || 'percent'; // default
        radiosMode.forEach(r => {
            if (r.value === mode) r.checked = true;
        });
        elThresholdUnit.textContent = mode === 'percent' ? '(%)' : '(元)';
        
        // Set Channel Radio
        const channel = config.alertChannel || 'all';
        radiosChannel.forEach(r => {
            if (r.value === channel) r.checked = true;
        });

    } catch (err) {
        addLog('加载配置失败', 'alert');
    }
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    let selectedMode = 'percent';
    radiosMode.forEach(r => { if (r.checked) selectedMode = r.value; });

    // 收集地址
    const barkUrls = Array.from(document.querySelectorAll('.bark-url-input'))
        .map(i => i.value.trim())
        .filter(v => v !== '');

    const newConfig = {
        interval: parseInt(inpInterval.value),
        lowThreshold: parseFloat(inpLow.value),
        highThreshold: parseFloat(inpHigh.value),
        fluctuationThreshold: parseFloat(inpFlucThresh.value),
        fluctuationWindow: parseFloat(inpFlucWindow.value),
        fluctuationMode: selectedMode,
        alertChannel: Array.from(radiosChannel).find(r => r.checked)?.value || 'all',
        barkUrl: barkUrls,
        alertRetryCount: parseInt(document.getElementById('alertRetryCount').value),
        alertRetryInterval: parseInt(document.getElementById('alertRetryInterval').value)
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
    const barkUrls = Array.from(document.querySelectorAll('.bark-url-input'))
        .map(i => i.value.trim())
        .filter(v => v !== '');

    if (barkUrls.length === 0) {
        addLog('请先输入 Bark URL', 'alert');
        return;
    }

    addLog('正在发送测试通知...');
    try {
        const res = await fetch('/api/test-bark', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls: barkUrls })
        });
        const data = await res.json();
        if (data.success) {
            const failCount = data.results.filter(r => !r.success).length;
            addLog(`测试完成: ${data.results.length - failCount} 成功, ${failCount} 失败`);
        } else {
            addLog(`测试发送请求失败`, 'alert');
        }
    } catch (err) {
        addLog(`网络异常: ${err.message}`, 'alert');
    }
});
