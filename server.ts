const express = require("express");
const cors = require("cors");
const { getHistoricalRates } = require("dukascopy-node");

const app = express();

app.use(express.json());
app.use(cors());

app.get('/', (req: any, res: any) => {
    res.json({ message: "Dukascopy Backend Setup!" });
});

app.get('/api/historical', async (req: any, res: any) => {
    try {
        const { symbol, timestamp } = req.query;

        if (!symbol || !timestamp) {
            return res.status(400).json({ error: "Missing required query parameters: symbol, timestamp" });
        }

        const sym = String(symbol).toLowerCase();
        let instrument = sym;
        if (!sym.endsWith('usd')) {
            instrument = `${sym}usd`;
        }

        let tsInMs = Number(timestamp);
        if (isNaN(tsInMs)) {
            return res.status(400).json({ error: "Invalid timestamp: Must be a valid number" });
        }
        
        // Convert epoch seconds to milliseconds if necessary
        // Timestamps below 20000000000 typically represent seconds since epoch
        if (tsInMs < 20000000000) {
            tsInMs = tsInMs * 1000;
        }

        // Use h1 (hourly) with a tight ±2h window so we always hit the right candle
        // regardless of what time of day the transaction happened — and it's fast.
        const fromDate = new Date(tsInMs - 1 * 60 * 60 * 1000); // 2 hours before
        const toDate   = new Date(tsInMs + 1 * 60 * 60 * 1000); // 2 hours after

        const config = {
            instrument: instrument,
            dates: {
                from: fromDate,
                to: toDate
            },
            timeframe: "h1",
            format: "json",
            priceType: "bid",
        };

        // Race against a 15-second timeout to avoid indefinite hangs
        const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Dukascopy request timed out after 15s')), 15000)
        );

        const data = await Promise.race([getHistoricalRates(config), timeoutPromise]);
        console.log(`Dukascopy [${instrument}] ${fromDate.toISOString()} → ${toDate.toISOString()}:`, data);

        let price = 0;
        if (Array.isArray(data) && data.length > 0) {
            // Pick the candle closest to the requested timestamp
            const target = tsInMs;
            const closest = data.reduce((prev: any, curr: any) => {
                const prevDiff = Math.abs(new Date(prev.timestamp).getTime() - target);
                const currDiff = Math.abs(new Date(curr.timestamp).getTime() - target);
                return currDiff < prevDiff ? curr : prev;
            });
            price = closest.close;
        }

        return res.json({
            symbol: sym.toUpperCase(),
            timestamp: tsInMs,
            price: price,
            raw: data // for debugging visually in response
        });
    } catch (e) {
        const error = e as any;
        const isTimeout = error?.message?.includes('timed out');
        console.error("Error from Dukascopy node module:", error.message || error);
        return res.status(isTimeout ? 504 : 500).json({ error: error.message || 'Unknown error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server actively running on port ${PORT}`);
    console.log(`Test link: http://localhost:${PORT}/api/historical?symbol=btc&timestamp=1617062400000`);
});
