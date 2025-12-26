const https = require('https');

const slug = process.argv[2] || 'btc-updown-15m-1766713500';
const url = `https://gamma-api.polymarket.com/markets/slug/${slug}`;

console.error('Fetching:', url);

https.get(url, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const market = JSON.parse(data);
            
            // API returns arrays as JSON strings - need to parse them
            let tokens = market.clobTokenIds;
            let outcomes = market.outcomes;
            let prices = market.outcomePrices;
            
            if (typeof tokens === 'string') tokens = JSON.parse(tokens);
            if (typeof outcomes === 'string') outcomes = JSON.parse(outcomes);
            if (typeof prices === 'string') prices = JSON.parse(prices);
            
            let upToken, downToken, upPrice, downPrice;
            
            for (let i = 0; i < outcomes.length; i++) {
                const outcome = (outcomes[i] || '').toLowerCase();
                if (outcome.includes('up')) {
                    upToken = tokens[i];
                    upPrice = prices[i];
                } else if (outcome.includes('down')) {
                    downToken = tokens[i];
                    downPrice = prices[i];
                }
            }
            
            if (upToken && downToken) {
                console.log(JSON.stringify({
                    success: true,
                    upToken,
                    downToken,
                    upPrice: parseFloat(upPrice || 0),
                    downPrice: parseFloat(downPrice || 0),
                    question: market.question
                }));
            } else {
                console.log(JSON.stringify({success: false, error: 'Could not match up/down', outcomes}));
            }
        } catch (e) {
            console.log(JSON.stringify({success: false, error: e.message}));
        }
    });
}).on('error', e => {
    console.log(JSON.stringify({success: false, error: e.message}));
});
