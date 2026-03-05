import { Router, Request, Response } from 'express';
import { getAllUTXOs, analyzeUTXOs } from '../services/utxo.service.js';
import { logger } from '../utils/logger.js';

export const utxoRouter = Router();

utxoRouter.get('/', async (req: Request, res: Response) => {
    try {
        const address = req.query.address as string;
        if (!address) {
            res.status(400).json({ error: 'address query param required' });
            return;
        }
        const utxos = await getAllUTXOs(address);
        res.json({ address, utxos });
    } catch (err: any) {
        logger.error('Failed to fetch UTXOs:', err.message);
        res.status(500).json({ error: err.message });
    }
});

utxoRouter.get('/analysis', async (req: Request, res: Response) => {
    try {
        const address = req.query.address as string;
        if (!address) {
            res.status(400).json({ error: 'address query param required' });
            return;
        }
        const analysis = await analyzeUTXOs(address);
        res.json({ address, ...analysis });
    } catch (err: any) {
        logger.error('Failed to analyze UTXOs:', err.message);
        res.status(500).json({ error: err.message });
    }
});
