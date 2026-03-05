const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });

    if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `HTTP ${res.status}`);
    }

    return res.json();
}

// --- UTXO ---
export function fetchUTXOs(address: string) {
    return request<any>(`/utxos?address=${encodeURIComponent(address)}`);
}

export function fetchUTXOAnalysis(address: string) {
    return request<any>(`/utxos/analysis?address=${encodeURIComponent(address)}`);
}

// --- Consolidation ---
export function estimateConsolidation(threshold: string, feeRate: number) {
    return request<any>('/consolidate/estimate', {
        method: 'POST',
        body: JSON.stringify({ threshold, feeRate }),
    });
}

export function executeConsolidation(
    threshold: string,
    maxUTXOs: number,
    feeRate: number,
) {
    return request<any>('/consolidate/execute', {
        method: 'POST',
        body: JSON.stringify({ threshold, maxUTXOs, feeRate }),
    });
}

export function createConsolidationPSBT(
    threshold: string,
    maxUTXOs: number,
    feeRate: number,
) {
    return request<any>('/consolidate/create-psbt', {
        method: 'POST',
        body: JSON.stringify({ threshold, maxUTXOs, feeRate }),
    });
}

// --- Payouts ---
export function validatePayouts(csv: string) {
    return request<any>('/payout/validate', {
        method: 'POST',
        body: JSON.stringify({ csv }),
    });
}

export function executePayouts(csv: string, feeRate: number) {
    return request<any>('/payout/execute', {
        method: 'POST',
        body: JSON.stringify({ csv, feeRate }),
    });
}

export function createPayoutPSBT(csv: string, address: string, feeRate: number) {
    return request<any>(`/payout/create-psbt?address=${encodeURIComponent(address)}`, {
        method: 'POST',
        body: JSON.stringify({ csv, feeRate }),
    });
}

export function broadcastTransaction(signedHex: string, csv?: string) {
    return request<any>('/payout/broadcast', {
        method: 'POST',
        body: JSON.stringify({ signedHex, csv }),
    });
}

export function fetchPolicies(address?: string) {
    const query = address ? `?address=${encodeURIComponent(address)}` : '';
    return request<any>(`/policies${query}`);
}

export function fetchChallenge(address: string) {
    return request<any>(`/policies/challenge?address=${address}`);
}

export function checkPolicy(address: string, amount: string, treasuryAddress?: string) {
    return request<any>('/policies/check', {
        method: 'POST',
        body: JSON.stringify({ address, amount, treasuryAddress }),
    });
}

export function updateWhitelist(
    address: string,
    action: 'add' | 'remove',
    auth?: { signature: string; publicKey: string; message: string },
    contractAddress?: string,
) {
    return request<any>('/policies/whitelist', {
        method: 'POST',
        body: JSON.stringify({ address, action, contractAddress, ...auth }),
    });
}

export function updateDailyCap(
    cap: string,
    auth?: { address: string; signature: string; publicKey: string; message: string },
    contractAddress?: string,
) {
    return request<any>('/policies/daily-cap', {
        method: 'POST',
        body: JSON.stringify({ cap, contractAddress, ...auth }),
    });
}

export function updateTimelockThreshold(
    threshold: string,
    auth?: { address: string; signature: string; publicKey: string; message: string },
    contractAddress?: string,
) {
    return request<any>('/policies/timelock', {
        method: 'POST',
        body: JSON.stringify({ threshold, contractAddress, ...auth }),
    });
}

// --- Deploy ---
export function fetchDeploymentParams() {
    return request<any>('/deploy/params');
}

export function deployContract(walletAddress: string, publicKey: string) {
    return request<any>('/deploy', {
        method: 'POST',
        body: JSON.stringify({ address: walletAddress, publicKey }),
    });
}

export function broadcastDeploy(signedFundingHex: string, signedRevealHex: string) {
    return request<any>('/deploy/broadcast', {
        method: 'POST',
        body: JSON.stringify({ signedFundingHex, signedRevealHex }),
    });
}

export function checkDeployStatus(address: string) {
    return request<any>(`/deploy/status?address=${encodeURIComponent(address)}`);
}

// --- Treasury ---
export function fetchFundingPSBT(senderAddress: string, publicKeyHex: string, toAddress: string, amountSats: string, walletUtxos?: any[]) {
    return request<any>('/treasury/fund-psbt', {
        method: 'POST',
        body: JSON.stringify({ senderAddress, publicKeyHex, toAddress, amountSats, walletUtxos }),
    });
}

export function broadcastFunding(signedHex: string) {
    return request<any>('/treasury/broadcast', {
        method: 'POST',
        body: JSON.stringify({ signedHex }),
    });
}