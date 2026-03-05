import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger.js';
import { getProvider } from '../utils/provider.js';
import { deploymentService } from '../services/deployment.service.js';

import { readFileSync } from 'fs';
import path from 'path';

export const deployRouter = Router();

deployRouter.post('/', async (req: Request, res: Response) => {
    try {
        const walletAddress = req.body.address || req.query.address;
        const publicKeyHex = req.body.publicKey;

        if (!walletAddress || !publicKeyHex) {
            res.status(400).json({
                error: 'Wallet address and public key are required. Connect your OP_WALLET first.'
            });
            return;
        }

        const result = await deploymentService.generateDeploymentPSBTs(walletAddress, publicKeyHex);

        res.json({
            success: true,
            bytecodeSize: result.bytecodeSize,
            utxoCount: result.utxoCount,
            contractAddress: result.contractAddress,
            deploymentData: {
                fundingPsbt: result.fundingPsbt,
                revealPsbt: result.revealPsbt
            },
        });
    } catch (err: any) {
        logger.error('Deploy error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/deploy/status — check if a contract exists at an address
deployRouter.post('/broadcast', async (req: Request, res: Response) => {
    try {
        const { signedFundingHex, signedRevealHex } = req.body;

        if (!signedFundingHex || !signedRevealHex) {
            res.status(400).json({ error: 'signedFundingHex and signedRevealHex are required' });
            return;
        }

        const result = await deploymentService.broadcastDeployment(signedFundingHex, signedRevealHex);

        res.json({
            success: true,
            fundingTxId: result.fundingTxId,
            revealTxId: result.revealTxId,
        });
    } catch (err: any) {
        logger.error('Broadcast error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/deploy/params - returns WASM bytecode for native OP_WALLET deployment
deployRouter.get('/params', async (req: Request, res: Response) => {
    try {
        const wasmPath = path.join(process.cwd(), 'contract', 'build', 'PolicyVault.wasm');
        const bytecode = readFileSync(wasmPath);

        res.json({
            success: true,
            bytecodeBase64: bytecode.toString('base64'),
        });
    } catch (err: any) {
        logger.error('Failed to get deployment params:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/deploy/status — check if a contract exists at an address
deployRouter.get('/status', async (req: Request, res: Response) => {
    try {
        const address = req.query.address as string;
        if (!address) {
            res.status(400).json({ error: 'address query param required' });
            return;
        }

        const provider = getProvider();
        try {
            const code = await provider.getCode(address, true);
            const hasCode = Buffer.isBuffer(code)
                ? code.length > 0
                : !!(code as any).bytecode?.length;
            res.json({ deployed: hasCode });
        } catch (err: any) {
            logger.warn(`Failed to check contract code at ${address}: ${err.message}`);
            res.json({ deployed: false });
        }
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});
