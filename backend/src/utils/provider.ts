import { JSONRpcProvider } from 'opnet';
import { networks } from '@btc-vision/bitcoin';
import { config } from '../config.js';
import { logger } from './logger.js';

// OP_NET network config — check original URL, not proxy URL
const originalUrl = process.env.OPNET_RPC_URL || '';
const isRegtest = originalUrl.includes('regtest');
const baseNetwork = isRegtest ? networks.regtest : networks.testnet;

export const network = {
    ...baseNetwork,
    bech32: isRegtest ? 'bcrt' : 'tb',
    bech32Opnet: 'opt',
    toJSON() {
        return {
            ...baseNetwork,
            bech32: isRegtest ? 'bcrt' : 'tb',
            bech32Opnet: 'opt',
        };
    }
};

let provider: JSONRpcProvider | null = null;

export function getProvider(): JSONRpcProvider {
    if (!provider) {
        logger.info(`Connecting to OP_NET at ${config.opnetRpcUrl}`);
        provider = new JSONRpcProvider(config.opnetRpcUrl, network);
    }
    return provider;
}
