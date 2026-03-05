import {
    getContract,
    JSONRpcProvider,
} from 'opnet';
import {
    Address,
} from '@btc-vision/transaction';
import { getProvider, network } from '../utils/provider.js';
import { logger } from '../utils/logger.js';

// Minimal ABI for PolicyVault based on AssemblyScript implementation
const POLICY_VAULT_ABI: any = [
    {
        name: 'getDailyCap',
        type: 'function',
        inputs: [],
        outputs: [{ name: 'cap', type: 'uint256' }],
        selector: '0xad370613', // encodeSelector('getDailyCap')
    },
    {
        name: 'getDailySpent',
        type: 'function',
        inputs: [],
        outputs: [{ name: 'spent', type: 'uint256' }],
        selector: '0x3233c706', // encodeSelector('getDailySpent')
    },
    {
        name: 'getTimelockThreshold',
        type: 'function',
        inputs: [],
        outputs: [{ name: 'threshold', type: 'uint256' }],
        selector: '0xc898935c', // encodeSelector('getTimelockThreshold')
    },
    {
        name: 'isWhitelisted',
        type: 'function',
        inputs: [{ name: 'addr', type: 'address' }],
        outputs: [{ name: 'whitelisted', type: 'bool' }],
        selector: '0x27242c75', // encodeSelector('isWhitelisted')
    }
];

export interface ContractPolicies {
    dailyCap: string;
    dailySpent: string;
    timelockThreshold: string;
    whitelist: string[];
    whitelistCount: number;
    isWhitelisted: boolean;
    contractDeployed: boolean;
}

export class ContractService {
    private provider: JSONRpcProvider;

    constructor() {
        this.provider = getProvider();
    }

    /**
     * Fetches all policy data from the deployed contract.
     */
    public async getPolicies(contractAddress: string): Promise<ContractPolicies> {
        try {
            logger.info(`Fetching on-chain policies for ${contractAddress}`);

            const contract = getContract<any>(
                contractAddress,
                POLICY_VAULT_ABI,
                this.provider,
                network
            );

            // Execute static calls
            const [capRes, spentRes, thresholdRes] = await Promise.all([
                contract.getDailyCap(),
                contract.getDailySpent(),
                contract.getTimelockThreshold(),
            ]);

            logger.info(`Contract call results for ${contractAddress}:`, { capRes, spentRes, thresholdRes });

            // Robust property access (handling different opnet response formats)
            const getVal = (res: any, key: string): string => {
                if (typeof res === 'bigint') return res.toString();
                if (res && res.properties && res.properties[key] !== undefined) return res.properties[key].toString();
                if (res && res[key] !== undefined) return res[key].toString();
                if (res && res[0] !== undefined) return res[0].toString();
                return '0';
            };

            return {
                dailyCap: getVal(capRes, 'cap'),
                dailySpent: getVal(spentRes, 'spent'),
                timelockThreshold: getVal(thresholdRes, 'threshold'),
                whitelist: [],
                whitelistCount: 0,
                isWhitelisted: false,
                contractDeployed: true,
            };
        } catch (err: any) {
            logger.error(`Contract call failed for ${contractAddress}:`, {
                message: err.message,
                stack: err.stack
            });
            // Re-throw so the router can handle the fallback to defaults
            throw err;
        }
    }

    /**
     * Checks if an address is whitelisted in the contract.
     */
    public async isWhitelisted(contractAddress: string, checkAddr: string): Promise<boolean> {
        try {
            const contract = getContract<any>(
                contractAddress,
                POLICY_VAULT_ABI,
                this.provider,
                network
            );

            const res = await contract.isWhitelisted(checkAddr);
            return res.properties.whitelisted;
        } catch (err: any) {
            logger.error(`Failed to check whitelist: ${err.message}`);
            return false;
        }
    }
}

export const contractService = new ContractService();
