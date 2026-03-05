import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { config } from '../backend/src/config.js';
import { logger } from '../backend/src/utils/logger.js';
import { utxoRouter } from '../backend/src/routes/utxo.js';
import { consolidateRouter } from '../backend/src/routes/consolidate.js';
import { payoutRouter } from '../backend/src/routes/payout.js';
import { policyRouter } from '../backend/src/routes/policy.js';
import { deployRouter } from '../backend/src/routes/deploy.js';
import treasuryRouter from '../backend/src/routes/treasury.js';

let proxyAgent: ProxyAgent | undefined;
if (config.proxyUrl) {
    proxyAgent = new ProxyAgent(config.proxyUrl);
}

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// --- Internal Proxy for OP_NET RPC ---
app.post('/api/opnet-rpc/api/v1/json-rpc', async (req, res) => {
    try {
        const targetBaseUrl = process.env.OPNET_RPC || 'https://testnet.opnet.org';
        const targetUrl = `${targetBaseUrl}/api/v1/json-rpc`;

        const response = await undiciFetch(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'OPNET-Local-Proxy/1.0',
            },
            body: JSON.stringify(req.body),
            dispatcher: proxyAgent,
        });

        const data = await response.text();
        res.status(response.status).send(data);
    } catch (err) {
        res.status(500).json({ error: 'Proxy failed to fetch from OP_NET' });
    }
});

// --- Routes ---
app.use('/api/utxos', utxoRouter);
app.use('/api/consolidate', consolidateRouter);
app.use('/api/payout', payoutRouter);
app.use('/api/policies', policyRouter);
app.use('/api/deploy', deployRouter);
app.use('/api/treasury', treasuryRouter);

app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', version: '2.0.0-vercel', network: 'testnet' });
});

export default app;
