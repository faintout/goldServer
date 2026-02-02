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
            if (marketData) {
                const currentPrice = parseFloat(marketData.zBuyPrc);
                
                // Update High/Low
                if (!config.priceStats) config.priceStats = {};
                if (!config.priceStats.cmb) config.priceStats.cmb = { high: 0, low: 9999, date: '' };
                
                const stats = config.priceStats.cmb;
                const today = new Date().toLocaleDateString();
                
                if (stats.date !== today) {
                    stats.high = currentPrice;
                    stats.low = currentPrice;
                    stats.date = today;
                    saveConfig();
                } else {
                    let changed = false;
                    if (currentPrice > stats.high) { stats.high = currentPrice; changed = true; }
                    if (currentPrice < stats.low) { stats.low = currentPrice; changed = true; }
                    if (changed) saveConfig();
                }

                return {
                    price: currentPrice,
                    buy: marketData.zBuyPrc,
                    sell: marketData.zSelPrc,
                    high: stats.high,
                    low: stats.low,
                    open: null,
                    close: marketData.zPrvPrc,
                    change: marketData.zDvlCur,
                    changePercent: marketData.zPrcDif,
                    time: marketData.NowTime ? marketData.NowTime.split(' ')[1] : '--',
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
