const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const agent = new https.Agent({
    secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT
});

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const CONFIG_PATH = path.join(__dirname, 'config.json');

// --- Global State ---
let config = {};
let priceHistory = {
    cmb: [], // { time: ms, price: number }
    ccb: []
};
let lastAlertTimes = {}; // { bankName: timestamp }
let pollingIntervalId = null;
let lastCombinedPrice = null;

// CCB Session State
let ccbCookies = '';

// --- Helper Functions ---

// Load Config
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const data = fs.readFileSync(CONFIG_PATH, 'utf8');
            config = JSON.parse(data);
            
            // 补全可能缺失的新字段
            let updated = false;
            if (config.alertChannel === undefined) {
                config.alertChannel = 'all';
                updated = true;
            }
            
            if (updated) saveConfig();
            console.log('配置已加载:', config);
        } else {
            console.warn('配置文件不存在，使用默认值');
            config = {
                interval: 5000,
                lowThreshold: 600,
                highThreshold: 700,
                fluctuationThreshold: 0.5,
                fluctuationWindow: 5,
                fluctuationMode: 'percent', // 'percent' or 'value'
                alertChannel: 'all', // 'all' | 'cmb' | 'ccb' | 'intl'
                barkUrl: ''
            };
            saveConfig();
        }
    } catch (err) {
        console.error('加载配置失败:', err);
    }
}

// Save Config
function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        // console.log('配置已保存');
    } catch (err) {
        console.error('保存配置失败:', err);
    }
}

// Bark Notification
async function sendBarkNotification(title, body) {
    if (!config.barkUrl) return;
    
    let url = config.barkUrl;
    if (!url.endsWith('/')) url += '/';
    
    const encodedTitle = encodeURIComponent(title);
    const encodedBody = encodeURIComponent(body);
    
    const fullUrl = `${url}${encodedTitle}/${encodedBody}?group=GoldMonitor`;

    try {
        await axios.get(fullUrl);
        console.log(`Bark 通知已发送: ${title}`);
    } catch (err) {
        console.error('Bark 通知发送失败:', err.message);
    }
}

// Obfuscation Helper
function deObfuscate(str) {
    return Buffer.from(str, 'base64').toString('utf-8');
}

// --- Providers ---
const cmbProvider = require('./providers/cmb');
const ccbProvider = require('./providers/ccb');
const intlProvider = require('./providers/intl');

function cleanHistory(now, bank = 'cmb') {
    const windowMs = (config.fluctuationWindow || 5) * 60 * 1000;
    if (!priceHistory[bank]) priceHistory[bank] = [];
    priceHistory[bank] = priceHistory[bank].filter(p => now - p.time <= windowMs);
}

function checkFluctuation(currentPrice, bank = 'cmb') {
    const history = priceHistory[bank] || [];
    if (history.length < 1) return { triggered: false };
    
    const threshold = config.fluctuationThreshold || 0.5;
    const mode = config.fluctuationMode || 'percent'; 

    let maxDiffStats = null;
    let maxChange = 0; 

    for (const point of history) {
        const priceDiff = currentPrice - point.price;
        let changeValue, changeMagnitude;

        if (mode === 'value') {
            changeValue = priceDiff;
            changeMagnitude = Math.abs(priceDiff);
        } else {
            changeValue = (priceDiff / point.price) * 100;
            changeMagnitude = Math.abs(changeValue);
        }
        
        if (changeMagnitude >= threshold) {
            if (!maxDiffStats || changeMagnitude > Math.abs(maxChange)) {
                maxChange = changeValue;
                maxDiffStats = {
                    type: changeValue > 0 ? '暴涨' : '暴跌',
                    changeDisplay: mode === 'value' ? changeValue.toFixed(2) : `${changeValue.toFixed(2)}%`,
                    oldPrice: point.price,
                    currentPrice: currentPrice
                };
            }
        }
    }

    if (maxDiffStats) {
        return { triggered: true, ...maxDiffStats };
    }
    
    return { triggered: false };
}

// Monitor Logic (Generic)
function processPrice(bankData, bankId) {
    if (!bankData) return null;
    
    const now = Date.now();
    const currentPrice = parseFloat(bankData.price);
    const bankLabel = bankId.toUpperCase();
    
    if (isNaN(currentPrice)) return bankData;

    // 1. Check Thresholds
    const bankNamesMap = { 'cmb': '招商银行', 'ccb': '建设银行', 'intl': '国际金价' };
    const bankCnName = bankNamesMap[bankId] || bankLabel;
    const stats = config.priceStats?.[bankId] || {};
    const effectivePrice = currentPrice; // Use main price for thresholds

    if (effectivePrice <= config.lowThreshold) {
        throttleAlert(`${bankLabel} ${bankCnName} 价格过低预警`, `当前价格 ${effectivePrice} 低于设定阈值 ${config.lowThreshold}`, bankId);
    } else if (effectivePrice >= config.highThreshold) {
        throttleAlert(`${bankLabel} ${bankCnName} 价格过高预警`, `当前价格 ${effectivePrice} 高于设定阈值 ${config.highThreshold}`, bankId);
    }

    // 2. Check Fluctuations (Based on primary price)
    cleanHistory(now, bankId);
    const fluctuation = checkFluctuation(currentPrice, bankId);
    
    if (!priceHistory[bankId]) priceHistory[bankId] = [];
    priceHistory[bankId].push({ time: now, price: currentPrice });

    if (fluctuation.triggered) {
        const bankNamesMap = { 'cmb': '招商银行', 'ccb': '建设银行', 'intl': '国际金价' };
        const bankCnName = bankNamesMap[bankId] || bankLabel;
        const title = `${bankLabel} ${bankCnName} 价格${fluctuation.type}预警`;
        const body = `幅度: ${fluctuation.changeDisplay} (前值: ${fluctuation.oldPrice} -> 现值: ${fluctuation.currentPrice})`;
        
        // Check filtering
        const channel = config.alertChannel || 'all';
        if (channel === 'all' || channel === bankId) {
            sendBarkNotification(title, body);
        }
        
        io.emit('alert', { title, body, time: now });
        priceHistory[bankId] = []; 
    }

    return {
        ...bankData,
        processedPrice: currentPrice,
        timestamp: now
    };
}


// Renamed/Simplified: Just a wrapper now, logic moved to processPrice or simplified checks
function throttleAlert(title, body, bankId) {
    const now = Date.now();
    const lastTime = lastAlertTimes[bankId] || 0;
    
    // 使用配置中的波动窗口分钟作为预警冷却时间
    const cooldownMs = (config.fluctuationWindow || 1) * 60 * 1000;
    
    if (now - lastTime > cooldownMs) { 
        // Filter threshold alerts
        const channel = config.alertChannel || 'all';
        if (channel === 'all' || channel === bankId) {
            sendBarkNotification(title, body);
        }
        
        lastAlertTimes[bankId] = now;
        io.emit('alert', { title, body, time: now });
    }
}

// Scheduling
// Core Price Fetcher
async function fetchAndProcessAll() {
    try {
        const [cmbRaw, intlRaw, ccbRaw] = await Promise.all([
            cmbProvider(config, saveConfig),
            intlProvider(),
            ccbProvider(agent, config, saveConfig)
        ]);

        const combined = {};
        if (cmbRaw) combined.cmb = processPrice(cmbRaw, 'cmb');
        if (ccbRaw) combined.ccb = processPrice(ccbRaw, 'ccb');
        if (intlRaw) {
            combined.intl = {
                usd: intlRaw.usd,
                cny: processPrice(intlRaw.cny, 'intl')
            };
        }

        if (Object.keys(combined).length > 0) {
            lastCombinedPrice = combined;
            io.emit('priceUpdate', combined);
            
            const logTime = `[${new Date().toLocaleTimeString()}]`;
            let logStr = logTime;
            if (combined.cmb) logStr += ` 招行: ${combined.cmb.price}`;
            if (combined.ccb) logStr += ` 建行: ${combined.ccb.price}`;
            if (combined.intl) logStr += ` 国际: ${combined.intl.usd.price} USD / ${combined.intl.cny.price} CNY`;
            console.log(logStr);
        }
        return combined;
    } catch (e) {
        console.error('Fetcher Error:', e.message);
        return null;
    }
}

// Scheduling
function startScheduler() {
    if (pollingIntervalId) clearInterval(pollingIntervalId);
    
    console.log(`启动调度任务，间隔: ${config.interval}s`);

    const task = async () => {
        await fetchAndProcessAll();
    };

    task();
    pollingIntervalId = setInterval(task, config.interval * 1000);
}

// --- App Setup ---

app.use(express.static('public'));
app.use(express.json());

// API Routes
app.get('/api/config', (req, res) => {
    res.json(config);
});

app.post('/api/config', (req, res) => {
    const newConfig = req.body;
    // Basic validation
    config = { ...config, ...newConfig };
    config.interval = Math.max(3, config.interval); // 最小 3 秒
    
    saveConfig();
    startScheduler(); // Restart with new interval
    res.json({ success: true, config });
});

app.get('/api/price', async (req, res) => {
    // 无论缓存是否有值，只要请求到达，就立刻强制拉取一次最新数据
    console.log('[API] 正在实时同步最新价格...');
    const data = await fetchAndProcessAll();
    if (data && Object.keys(data).length > 0) {
        res.json({ success: true, data: data });
    } else if (lastCombinedPrice) {
        // 如果实时拉取由于网络等原因失败，降级返回最后的缓存
        res.json({ success: true, data: lastCombinedPrice, note: 'cached' });
    } else {
        res.json({ success: false, message: '数据获取失败，请稍后重试' });
    }
});

app.post('/api/test-bark', async (req, res) => {
    const { url } = req.body;
    const originalUrl = config.barkUrl;
    
    // Temporarily use the provided URL to test, or config one if empty
    if (url) {
        const tempConfig = { ...config, barkUrl: url };
        // We don't save this yet, just for testing the function logic or we pass to helper
        // But helper uses global config. Let's just update global temp? 
        // Better: allow passing url to helper but helper relies on global.
        // Let's just use the logic directly here for test.
        
        let targetUrl = url;
        if (!targetUrl.endsWith('/')) targetUrl += '/';
        const fullUrl = `${targetUrl}测试通知/这是一条来自黄金监控的测试消息?group=GoldMonitor`;
        try {
            await axios.get(fullUrl);
            res.json({ success: true, message: '发送成功' });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    }
});

// Start
loadConfig();
startScheduler();

const PORT = 8081;
server.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
});
