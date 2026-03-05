import { Router, Request, Response } from 'express';
import {
    parseCsv,
    validatePayouts,
    executeBatchPayout,
    createPayoutPSBT,
    broadcastTransaction,
} from '../services/payout.service.js';
import {
    checkPayment,
    recordPayment,
} from '../services/policy.service.js';
import { logger } from '../utils/logger.js';

export const payoutRouter = Router();

payoutRouter.post('/validate', async (req: Request, res: Response) => {
    try {
        const csvText = req.body.csv || '';
        const payouts = parseCsv(csvText);

        if (payouts.length === 0) {
            res.status(400).json({ error: 'No valid payouts found in CSV' });
            return;
        }

        // Check each payout against policies
        for (const payout of payouts) {
            const check = await checkPayment(payout.address, BigInt(payout.amountSats));
            payout.status = check.statusText as any;
            payout.reason = check.reason;
        }

        const estimate = await validatePayouts(payouts);
        // Override statuses from policy check
        estimate.payouts = payouts;
        estimate.allAllowed = payouts.every((p) => p.status === 'allowed');

        res.json(estimate);
    } catch (err: any) {
        logger.error('Payout validation failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

payoutRouter.post('/execute', async (req: Request, res: Response) => {
    try {
        const csvText = req.body.csv || '';
        const feeRate = req.body.feeRate || 5;
        const payouts = parseCsv(csvText);

        if (payouts.length === 0) {
            res.status(400).json({ error: 'No valid payouts found in CSV' });
            return;
        }

        // Final policy check before execution
        for (const payout of payouts) {
            const check = await checkPayment(payout.address, BigInt(payout.amountSats));
            if (check.status !== 0) {
                res.status(403).json({
                    error: `Policy violation for ${payout.address}`,
                    details: check,
                });
                return;
            }
        }

        const result = await executeBatchPayout(payouts, feeRate);

        // Record all payments against daily cap
        for (const payout of payouts) {
            await recordPayment(payout.address, BigInt(payout.amountSats));
        }

        res.json(result);
    } catch (err: any) {
        logger.error('Batch payout failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

payoutRouter.post('/create-psbt', async (req: Request, res: Response) => {
    try {
        const csvText = req.body.csv || '';
        const treasuryAddress = (req.query.address as string) || (req.body.address as string);
        const feeRate = req.body.feeRate || 5;

        if (!treasuryAddress) {
            res.status(400).json({ error: 'Treasury address is required' });
            return;
        }

        const payouts = parseCsv(csvText);
        if (payouts.length === 0) {
            res.status(400).json({ error: 'No valid payouts found in CSV' });
            return;
        }

        // Policy check
        for (const payout of payouts) {
            const check = await checkPayment(payout.address, BigInt(payout.amountSats));
            if (check.status !== 0) {
                res.status(403).json({
                    error: `Policy violation for ${payout.address}`,
                    details: check,
                });
                return;
            }
        }

        const result = await createPayoutPSBT(payouts, treasuryAddress, feeRate);
        res.json(result);
    } catch (err: any) {
        logger.error('PSBT creation failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

payoutRouter.post('/broadcast', async (req: Request, res: Response) => {
    try {
        const { signedHex, csv } = req.body;

        if (!signedHex) {
            res.status(400).json({ error: 'Signed transaction hex is required' });
            return;
        }

        const txId = await broadcastTransaction(signedHex);

        // Record payments if CSV provided
        if (csv) {
            const payouts = parseCsv(csv);
            for (const payout of payouts) {
                await recordPayment(payout.address, BigInt(payout.amountSats));
            }
        }

        res.json({ transactionId: txId });
    } catch (err: any) {
        logger.error('Broadcast failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});
