import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { utxoRouter } from './routes/utxo.js';
import { consolidateRouter } from './routes/consolidate.js';
import { payoutRouter } from './routes/payout.js';
import { policyRouter } from './routes/policy.js';
import { deployRouter } from './routes/deploy.js';
import treasuryRouter from './routes/treasury.js';

let proxyAgent: ProxyAgent | undefined;
if (config.proxyUrl) {
    proxyAgent = new ProxyAgent(config.proxyUrl);
    logger.info(`[Proxy] Local proxy route enabled for OP_NET RPC via ${config.proxyUrl}`);
}

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// --- Internal Proxy for OP_NET RPC ---
// opnet SDK's JSONRpcProvider automatically appends /api/v1/json-rpc
app.post('/opnet-rpc/api/v1/json-rpc', async (req, res) => {
    try {
        const targetBaseUrl = process.env.OPNET_RPC_URL || 'https://testnet.opnet.org';
        const targetUrl = `${targetBaseUrl}/api/v1/json-rpc`;
        logger.info(`[Proxy] Forwarding request to: ${targetUrl}`);

        const response = await undiciFetch(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'OPNET-Local-Proxy/1.0',
            },
            body: JSON.stringify(req.body),
            dispatcher: proxyAgent, // Use the proxy if configured
        });

        const data = await response.text();
        res.status(response.status).send(data);
    } catch (err: any) {
        logger.error(`Proxy error: ${err.message}`);
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

// Health check
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', version: '2.0.0', network: 'testnet' });
});

// --- Start ---
app.listen(config.port, () => {
    logger.info(`Treasury backend running on http://localhost:${config.port}`);
    logger.info('Dynamic wallet mode: Treasury address provided by connected client');
});
