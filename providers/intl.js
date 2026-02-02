const axios = require('axios');

module.exports = async () => {
    const codes = 'JO_92233';
    const head = {
        'Referer': 'https://m.cngold.org/',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1'
    };

    const parseQuote = (jsString) => {
        try {
            const start = jsString.indexOf('{');
            const end = jsString.lastIndexOf('}');
            if (start !== -1 && end !== -1) {
                const jsonStr = jsString.substring(start, end + 1);
                const data = JSON.parse(jsonStr);
                return data[codes];
            }
        } catch (e) {
            console.error('Parse Error:', e.message);
        }
        return null;
    };

    try {
        const [resUsd, resCny] = await Promise.all([
            axios.get(`https://api.jijinhao.com/quoteCenter/realTime.htm?codes=${codes}`, { headers: head }),
            axios.get(`https://api.jijinhao.com/quoteCenter/realTime.htm?codes=${codes}&isCalc=true`, { headers: head })
        ]);

        const usdData = parseQuote(resUsd.data);
        const cnyData = parseQuote(resCny.data);

        if (usdData && cnyData) {
            return {
                usd: {
                    price: usdData.q63,
                    high: usdData.q3,
                    low: usdData.q4,
                    open: usdData.q1,
                    close: usdData.q2,
                    change: usdData.q70,
                    changePercent: usdData.q80,
                    time: usdData.time,
                    timestamp: Date.now()
                },
                cny: {
                    price: cnyData.q63,
                    high: cnyData.q3,
                    low: cnyData.q4,
                    open: cnyData.q1,
                    close: cnyData.q2,
                    change: cnyData.q70,
                    changePercent: cnyData.q80,
                    time: cnyData.time,
                    timestamp: Date.now()
                }
            };
        }
    } catch (error) {
        console.error('Intl Provider Error:', error.message);
    }
    return null;
};
