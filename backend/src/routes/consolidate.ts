import { Router, Request, Response } from 'express';
import {
    estimateConsolidation,
    executeConsolidation,
    createConsolidationPSBT,
} from '../services/consolidation.service.js';
import { logger } from '../utils/logger.js';

export const consolidateRouter = Router();

consolidateRouter.post('/estimate', async (req: Request, res: Response) => {
    try {
        const threshold = BigInt(req.body.threshold || '10000');
        const feeRate = req.body.feeRate || 5;
        const estimate = await estimateConsolidation(threshold, feeRate);
        res.json(estimate);
    } catch (err: any) {
        logger.error('Consolidation estimate failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

consolidateRouter.post('/execute', async (req: Request, res: Response) => {
    try {
        const threshold = BigInt(req.body.threshold || '10000');
        const maxUTXOs = req.body.maxUTXOs || 100;
        const feeRate = req.body.feeRate || 5;
        const result = await executeConsolidation(threshold, maxUTXOs, feeRate);
        res.json(result);
    } catch (err: any) {
        logger.error('Consolidation execute failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});
consolidateRouter.post('/create-psbt', async (req: Request, res: Response) => {
    try {
        const threshold = BigInt(req.body.threshold || '10000');
        const maxUTXOs = req.body.maxUTXOs || 100;
        const feeRate = req.body.feeRate || 5;
        const result = await createConsolidationPSBT(threshold, maxUTXOs, feeRate);
        res.json(result);
    } catch (err: any) {
        logger.error('Consolidation PSBT creation failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});
