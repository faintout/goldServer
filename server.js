const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const CONFIG_PATH = path.join(__dirname, 'config.json');

// --- Global State ---
let config = {};
let priceHistory = []; // { time: ms, price: number }
let lastAlertTime = 0;
let pollingIntervalId = null;

// --- Helper Functions ---

// Load Config
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const data = fs.readFileSync(CONFIG_PATH, 'utf8');
            config = JSON.parse(data);
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
        console.log('配置已保存');
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

// Gold Price API
const getGoldPrice = async () => {
    const _0x1a2b = 'aHR0cHM6Ly9tYm1vZHVsZS1vcGVuYXBpLnBhYXMuY21iY2hpbmEuY29tL3Byb2R1Y3QvdjEvZnVuYy9tYXJrZXQtY2VudGVy';
    const url = deObfuscate(_0x1a2b);
    
    const data = [{
        prdType: "H",
        prdCode: ""
    }];

    const reqConfig = {
        headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/122.0.0.0',
            'Referer': 'https://mbmodule-openapi.paas.cmbchina.com:443/product/v1/func/market-center',
            'Accept': 'application/json, text/plain, */*',
        }
    };

    try {
        const response = await axios.post(url, data, reqConfig);
        if (response.data.success) {
            const marketData = response.data.data;
            if (marketData && marketData.FQAMBPRCZ1) {
                return marketData.FQAMBPRCZ1;
            }
        } else {
            console.error('业务处理失败:', response.data.msg);
        }
    } catch (error) {
        console.error('网络请求异常:', error.message);
    }
    return null;
};

function cleanHistory(now) {
    const windowMs = (config.fluctuationWindow || 5) * 60 * 1000;
    priceHistory = priceHistory.filter(p => now - p.time <= windowMs);
}

function checkFluctuation(currentPrice) {
    if (priceHistory.length < 1) return { triggered: false };
    
    const threshold = config.fluctuationThreshold || 0.5;
    const mode = config.fluctuationMode || 'percent'; // 'percent' | 'value'

    let maxDiffStats = null;
    let maxChange = 0; // percent or value

    for (const point of priceHistory) {
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

// Monitor Logic
function processPrice(data) {
    const now = Date.now();
    const currentPrice = parseFloat(data.zBuyPrc); // Use Buy Price for monitoring
    
    if (isNaN(currentPrice)) return;

    // 1. Check Thresholds
    if (currentPrice <= config.lowThreshold) {
        throttleAlert('价格过低预警', `当前价格 ${currentPrice} 低于设定阈值 ${config.lowThreshold}`);
    } else if (currentPrice >= config.highThreshold) {
        throttleAlert('价格过高预警', `当前价格 ${currentPrice} 高于设定阈值 ${config.highThreshold}`);
    }

    // 2. Check Fluctuations
    cleanHistory(now);
    
    const fluctuation = checkFluctuation(currentPrice);
    
    priceHistory.push({ time: now, price: currentPrice });

    if (fluctuation.triggered) {
        const title = `价格${fluctuation.type}预警`;
        const body = `幅度: ${fluctuation.changeDisplay} (前值: ${fluctuation.oldPrice} -> 现值: ${fluctuation.currentPrice})`;
        
        // Send Alert Immediately
        sendBarkNotification(title, body);
        io.emit('alert', { title, body, time: now });
        
        console.log(`[波动触发] ${body} - 历史数据已清空`);
        priceHistory = []; 
    }

    return {
        ...data,
        timestamp: now
    };
}


// Renamed/Simplified: Just a wrapper now, logic moved to processPrice or simplified checks
function throttleAlert(title, body) {
    const now = Date.now();
    // Keep threshold alerts throttled? 
    // I will keep threshold throttling to avoid spam on every poll for static levels, 
    // but Fluctuation alerts are now handled directly in processPrice WITHOUT throttle.
    
    if (now - lastAlertTime > 60000) { 
        sendBarkNotification(title, body);
        lastAlertTime = now;
        io.emit('alert', { title, body, time: now });
    }
}

// Scheduling
function startScheduler() {
    if (pollingIntervalId) clearInterval(pollingIntervalId);
    
    console.log(`启动调度任务，间隔: ${config.interval}ms`);
    pollingIntervalId = setInterval(async () => {
        const data = await getGoldPrice();
        if (data) {
            const processed = processPrice(data);
            io.emit('priceUpdate', processed);
            console.log(`[${new Date().toLocaleTimeString()}] 价格更新: 买入 ${data.zBuyPrc} / 卖出 ${data.zSelPrc}`);
        }
    }, config.interval);
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
    config.interval = Math.max(1000, config.interval); // Open min 1s
    
    saveConfig();
    startScheduler(); // Restart with new interval
    res.json({ success: true, config });
});

app.get('/api/price', async (req, res) => {
    const data = await getGoldPrice();
    if (data) {
        // We don't trigger alerts here to avoid side-effects on manual refresh
        res.json({ success: true, data });
    } else {
        res.status(500).json({ success: false });
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
