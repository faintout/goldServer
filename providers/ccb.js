const axios = require('axios');

module.exports = async (agent, config, saveConfig) => {
    const cookieUrl = 'https://gold2.ccb.com/tran/WCCMainPlatV5?CCB_IBSVersion=V5&SERVLET_NAME=WCCMainPlatV5&TXCODE=NDPD03&Cst_ID=LjmSsj6PPAUes%2Bb5BKsRVXi43b2kVGpq&Chnl_ID=0009&Clmn_ID=17015&Tsk_Ind=Y&SYS_CODE=1000&MP_CODE=00&APP_NAME=COM.NETBANK&SEC_VERSION=1.0.0';
    const priceUrl = `https://gold2.ccb.com/tran/WCCMainPlatV5?CCB_IBSVersion=V5&SERVLET_NAME=WCCMainPlatV5&TXCODE=NGJS01&_=${Date.now()}`;
    
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    const fetchPriceData = async (retry = false) => {
        let cookies = config.ccbCookies || '';

        try {
            // 1. Initialize Cookie if missing
            if (!cookies) {
                const res1 = await axios.get(cookieUrl, { headers, httpsAgent: agent });
                const setCookie = res1.headers['set-cookie'];
                if (setCookie) {
                    cookies = setCookie.map(c => c.split(';')[0]).join('; ');
                    config.ccbCookies = cookies;
                    saveConfig();
                }
            }

            // 2. Fetch Price
            const res2 = await axios.get(priceUrl, {
                headers: {
                    ...headers,
                    'Cookie': cookies,
                    'Referer': 'https://gold2.ccb.com/chn/home/gold_new/gjssy/index.shtml',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                httpsAgent: agent
            });

            const data = res2.data;
            if (data && data.Cst_Buy_Prc) {
                const currentPrice = parseFloat(data.Cst_Buy_Prc);
                
                // 3. Update High/Low and LastPrice from config
                if (!config.priceStats) config.priceStats = {};
                if (!config.priceStats.ccb) config.priceStats.ccb = {};
                
                const stats = config.priceStats.ccb;
                // 确保新字段存在
                if (stats.high === undefined) stats.high = 0;
                if (stats.low === undefined) stats.low = 9999;
                if (stats.date === undefined) stats.date = '';
                if (stats.prevClose === undefined) stats.prevClose = 0;
                if (stats.prevHigh === undefined) stats.prevHigh = 0;
                if (stats.prevLow === undefined) stats.prevLow = 0;
                if (stats.lastPrice === undefined) stats.lastPrice = 0;
                
                const d = new Date();
                const today = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
                
                if (stats.date !== today) {
                    // 今日第一次运行或跨天：存档昨日数据
                    if (stats.lastPrice) stats.prevClose = stats.lastPrice;
                    if (stats.high !== 0) stats.prevHigh = stats.high;
                    if (stats.low !== 9999) stats.prevLow = stats.low;

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

                // 实时更新当前最后价格（用于跨天存档）
                if (stats.lastPrice !== currentPrice) {
                    stats.lastPrice = currentPrice;
                    saveConfig();
                }

                // 4. Calculate change based on prevClose
                let change = 0;
                let changePercent = 0;
                if (stats.prevClose) {
                    change = currentPrice - stats.prevClose;
                    changePercent = (change / stats.prevClose) * 100;
                }

                return {
                    price: currentPrice,
                    buy: data.Cst_Buy_Prc,
                    sell: data.Cst_Sell_Prc,
                    high: stats.high,
                    low: stats.low,
                    open: null,
                    close: stats.prevClose || null, // 展示昨日最后价格
                    change: change,
                    changePercent: changePercent,
                    time: data.Tms ? data.Tms.split(' ')[1].split('.')[0] : '--:--:--',
                    timestamp: Date.now(),
                    raw: data
                };
            } else if (typeof data === 'string' && (data.includes('WCCMainPlatV5') || data.includes('网上银行'))) {
                // Session expired
                config.ccbCookies = '';
                saveConfig();
                
                if (!retry) {
                    console.log('检测到建行 Cookie 失效，正在立即尝试重新初始化并重试...');
                    return await fetchPriceData(true); // Retry once
                }
            }
        } catch (error) {
            console.error('建行请求失败:', error.message);
            if (error.response && error.response.status === 403) {
                config.ccbCookies = '';
                saveConfig();
                if (!retry) return await fetchPriceData(true);
            }
        }
        return null;
    };

    return await fetchPriceData();
};
