import { Router, Request, Response } from 'express';
import {
    getPolicies as getMockPolicies,
    checkPayment as checkMockPayment,
    addToWhitelist,
    removeFromWhitelist,
    setDailyCap,
    setTimelockThreshold,
    generateChallenge,
    verifySignature,
} from '../services/policy.service.js';
import { contractService } from '../services/contract.service.js';
import { logger } from '../utils/logger.js';

export const policyRouter = Router();

policyRouter.get('/challenge', async (req: Request, res: Response) => {
    try {
        const { address } = req.query;
        if (!address) {
            res.status(400).json({ error: 'address required' });
            return;
        }
        const challenge = generateChallenge(address as string);
        res.json({ challenge });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

policyRouter.get('/', async (req: Request, res: Response) => {
    try {
        const { address } = req.query;
        if (address && typeof address === 'string') {
            try {
                // Contract address came from frontend (post-deploy) — treat as deployed
                const policies = await contractService.getPolicies(address);
                res.json({ ...policies, contractDeployed: true });
            } catch (err) {
                // Contract address was provided but call failed (e.g. RPC issue) —
                // still mark as deployed so the UI doesn't show the "Deploy Now" banner
                logger.warn(`Contract call failed for ${address}, using local fallback but keeping contractDeployed=true`);
                const mock = await getMockPolicies();
                res.json({
                    ...mock,
                    contractDeployed: true,
                });
            }
        } else {
            // No address = no contract connected
            const policies = await getMockPolicies();
            res.json({ ...policies, contractDeployed: false });
        }
    } catch (err: any) {
        logger.error('Failed to get policies:', err.message);
        res.status(500).json({ error: err.message });
    }
});

policyRouter.post('/check', async (req: Request, res: Response) => {
    try {
        const { address, amount, treasuryAddress } = req.body;
        if (!address || !amount) {
            res.status(400).json({ error: 'address and amount required' });
            return;
        }

        if (treasuryAddress) {
            try {
                const contractPolicies = await contractService.getPolicies(treasuryAddress);
                const isWhitelisted = await contractService.isWhitelisted(treasuryAddress, address);

                const amt = BigInt(amount);
                const cap = BigInt(contractPolicies.dailyCap);
                const spent = BigInt(contractPolicies.dailySpent);
                const threshold = BigInt(contractPolicies.timelockThreshold);

                // Replicate contract logic for simulation
                if (spent + amt > cap) {
                    res.json({ allowed: false, reason: 'Daily cap exceeded' });
                } else if (amt > threshold) {
                    res.json({ allowed: false, reason: 'Requires timelock' });
                } else {
                    res.json({ allowed: true });
                }
            } catch (err) {
                // Fallback to mock check if contract call fails (e.g. not deployed)
                const result = await checkMockPayment(address, BigInt(amount));
                res.json(result);
            }
        } else {
            const result = await checkMockPayment(address, BigInt(amount));
            res.json(result);
        }
    } catch (err: any) {
        logger.error('Policy check failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

policyRouter.post('/whitelist', async (req: Request, res: Response) => {
    try {
        const { address, action, signature, publicKey, message, contractAddress } = req.body;
        if (!address) {
            res.status(400).json({ error: 'address required' });
            return;
        }

        // Verify signature
        const isValid = await verifySignature(address, message, signature, publicKey);
        if (!isValid) {
            res.status(401).json({ error: 'Invalid or expired signature' });
            return;
        }

        if (action === 'remove') {
            await removeFromWhitelist(address);
        } else {
            await addToWhitelist(address);
        }
        const policies = await getMockPolicies(contractAddress);
        res.json(policies);
    } catch (err: any) {
        logger.error('Whitelist update failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

policyRouter.post('/daily-cap', async (req: Request, res: Response) => {
    try {
        const { cap, address, signature, publicKey, message, contractAddress } = req.body;
        if (!cap || !address) {
            res.status(400).json({ error: 'cap and address required' });
            return;
        }

        // Verify signature
        const isValid = await verifySignature(address, message, signature, publicKey);
        if (!isValid) {
            res.status(401).json({ error: 'Invalid or expired signature' });
            return;
        }

        await setDailyCap(BigInt(cap));
        const policies = await getMockPolicies(contractAddress);
        res.json(policies);
    } catch (err: any) {
        logger.error('Daily cap update failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

policyRouter.post('/timelock', async (req: Request, res: Response) => {
    try {
        const { threshold, address, signature, publicKey, message, contractAddress } = req.body;
        if (!threshold || !address) {
            res.status(400).json({ error: 'threshold and address required' });
            return;
        }

        // Verify signature
        const isValid = await verifySignature(address, message, signature, publicKey);
        if (!isValid) {
            res.status(401).json({ error: 'Invalid or expired signature' });
            return;
        }

        await setTimelockThreshold(BigInt(threshold));
        const policies = await getMockPolicies(contractAddress);
        res.json(policies);
    } catch (err: any) {
        logger.error('Timelock update failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});