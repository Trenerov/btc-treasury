import { Router } from 'express';
import { deploymentService } from '../services/deployment.service.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * POST /api/treasury/fund-psbt
 * Generates an unsigned PSBT for depositing BTC into the treasury.
 */
router.post('/fund-psbt', async (req, res) => {
    try {
        const { senderAddress, publicKeyHex, toAddress, amountSats, walletUtxos } = req.body;

        if (!senderAddress || !publicKeyHex || !toAddress || !amountSats) {
            return res.status(400).json({ error: 'Missing required parameters: senderAddress, publicKeyHex, toAddress, amountSats' });
        }

        logger.info(`Generating funding PSBT for ${senderAddress} -> ${toAddress} (${amountSats} sats)`);

        const result = await deploymentService.generateFundingPSBT(
            senderAddress,
            publicKeyHex,
            toAddress,
            BigInt(amountSats),
            walletUtxos
        );

        res.json(result);
    } catch (error: any) {
        logger.error(`Failed to generate funding PSBT: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/treasury/broadcast
 * Broadcasts a signed transaction (hex or PSBT).
 */
router.post('/broadcast', async (req, res) => {
    try {
        const { signedHex } = req.body;
        if (!signedHex) {
            return res.status(400).json({ error: 'Missing signedHex' });
        }

        // We can reuse the broadcast logic from deployment service
        // but since we only have one TX here, we'll just handle it simply.
        const { getProvider } = await import('../utils/provider.js');
        const { Psbt, networks } = await import('@btc-vision/bitcoin');
        const { network } = await import('../utils/provider.js');

        const provider = getProvider();
        let rawTx = signedHex;

        // Detect PSBT format: hex magic "70736274" or base64 magic "cHNid"
        if (signedHex.toLowerCase().startsWith('70736274')) {
            const psbt = Psbt.fromHex(signedHex, { network });
            psbt.finalizeAllInputs();
            rawTx = psbt.extractTransaction().toHex();
        } else if (signedHex.startsWith('cHNid')) {
            const psbt = Psbt.fromBase64(signedHex, { network });
            psbt.finalizeAllInputs();
            rawTx = psbt.extractTransaction().toHex();
        }

        const result = await provider.sendRawTransaction(rawTx, false);
        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }

        res.json({ txId: result.result });
    } catch (error: any) {
        logger.error(`Failed to broadcast: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

export default router;
