const axios = require('axios');

const deObfuscate = (str) => Buffer.from(str, 'base64').toString('utf-8');

module.exports = async (config, saveConfig) => {
    const url = deObfuscate('aHR0cHM6Ly9tYm1vZHVsZS1vcGVuYXBpLnBhYXMuY21iY2hpbmEuY29tL3Byb2R1Y3QvdjEvZnVuYy9tYXJrZXQtY2VudGVy');
    const referer = deObfuscate('aHR0cHM6Ly9tYm1vZHVsZS1vcGVuYXBpLnBhYXMuY21iY2hpbmEuY29tOjQ0My9wcm9kdWN0L3YxL2Z1bmMvbWFya2V0LWNlbnRlcg==');
    
    const reqData = [{ prdType: "H", prdCode: "" }];
    const reqHeaders = {
        headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/122.0.0.0',
            'Referer': referer,
            'Accept': 'application/json, text/plain, */*',
        }
    };

    try {
        const response = await axios.post(url, reqData, reqHeaders);
        if (response.data.success) {
            const marketData = response.data.data.FQAMBPRCZ1;
            const time = response.data.data.NowTime
            if (marketData) {
                const currentPrice = parseFloat(marketData.zBuyPrc);
                const change = parseFloat(marketData.zDvlCur) || 0;
                const calculatedPrevClose = currentPrice - change;
                
                // Update High/Low
                if (!config.priceStats) config.priceStats = {};
                if (!config.priceStats.cmb) config.priceStats.cmb = {};
                
                const stats = config.priceStats.cmb;
                // 确保新字段存在
                if (stats.high === undefined) stats.high = 0;
                if (stats.low === undefined) stats.low = 9999;
                if (stats.date === undefined) stats.date = '';
                if (stats.prevClose === undefined) stats.prevClose = 0;
                if (stats.prevHigh === undefined) stats.prevHigh = 0;
                if (stats.prevLow === undefined) stats.prevLow = 0;

                const d = new Date();
                const today = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
                
                if (stats.date === '') {
                    // 初次运行（新系统）：仅记录今日状态，不归档昨日
                    stats.high = currentPrice;
                    stats.low = currentPrice;
                    stats.date = today;
                    console.log('[CMB] 初次运行，初始化今日价格统计基准');
                    saveConfig();
                } else if (stats.date !== today) {
                    // 确认跨天：执行昨日归档结算
                    console.log(`[CMB] 监测到日期更替 (${stats.date} -> ${today})，执行每日结算...`);
                    
                    if (stats.high !== 0) stats.prevHigh = stats.high;
                    if (stats.low !== 9999) stats.prevLow = stats.low;
                    stats.prevClose = calculatedPrevClose;

                    stats.high = currentPrice;
                    stats.low = currentPrice;
                    stats.date = today;
                    saveConfig();
                } else {
                    let changed = false;
                    if (currentPrice > stats.high) { stats.high = currentPrice; changed = true; }
                    if (currentPrice < stats.low) { stats.low = currentPrice; changed = true; }
                    // 即使日期没变，为了保证基准价准确（防止API修正），也可以同步一下昨收。
                    // 但通常跨天存档一次即可。我们始终以 calculatedPrevClose 作为实时昨收展示。
                    if (changed) saveConfig();
                }

                return {
                    price: currentPrice,
                    buy: marketData.zBuyPrc,
                    sell: marketData.zSelPrc,
                    high: stats.high,
                    low: stats.low,
                    open: null,
                    close: calculatedPrevClose, // 动态计算出的昨日收盘价
                    change: marketData.zDvlCur,
                    changePercent: marketData.zPrcDif,
                    time: time ? time.split(' ')[1] : '--:--:--',
                    timestamp: Date.now(),
                    raw: marketData
                };
            }
        }
    } catch (error) {
        console.error('CMB Provider Error:', error.message);
    }
    return null;
};
