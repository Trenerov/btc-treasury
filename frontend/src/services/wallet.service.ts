export type WalletType = 'unisat' | 'opnet';

export interface WalletProvider {
    requestAccounts(): Promise<string[]>;
    getAccounts(): Promise<string[]>;
    getPublicKey(): Promise<string>;
    getBalance?(): Promise<{ total: number; confirmed: number; unconfirmed: number }>; // Unisat style
    on(event: string, handler: (accounts: string[]) => void): void;
    removeListener(event: string, handler: (accounts: string[]) => void): void;
    // Standard (EIP-1193ish)
    request?(args: { method: string; params?: any[] }): Promise<any>;
    // OP_WALLET specific
    signSchnorr?(message: string): Promise<string>;
    signMLDSAMessage?(message: string): Promise<{
        signature: string;
        publicKey: string;
        securityLevel: number;
    }>;
    signPsbt?(psbt: string): Promise<string>; // both hex and base64 usually supported
    signPSBT?(psbt: string): Promise<string>; // casing variations
}

declare global {
    interface Window {
        unisat?: WalletProvider;
        opnet?: WalletProvider; // Some versions inject directly
        opnet_web3?: WalletProvider;
        ethereum?: any; // Fallback check
    }
}

export type WalletState = {
    connected: boolean;
    address: string | null;
    publicKey: string | null;
    balance: number;
    type: WalletType | null;
    error: string | null;
};

type Listener = (state: WalletState) => void;

class WalletService {
    private state: WalletState = {
        connected: false,
        address: null,
        publicKey: null,
        balance: 0,
        type: null,
        error: null,
    };

    private pollInterval: any = null;

    private listeners: Listener[] = [];

    public isUnisatAvailable(): boolean {
        return typeof window.unisat !== 'undefined';
    }

    public isOPWalletAvailable(): boolean {
        return typeof window.opnet !== 'undefined' || typeof (window as any).opnet_web3 !== 'undefined';
    }

    public async connect(type: WalletType): Promise<void> {
        const provider = this.getProvider(type);

        if (!provider) {
            this.updateState({ error: `${type} extension not found` });
            return;
        }

        try {
            let accounts: string[] = [];

            // Try different common request methods
            if (typeof provider.requestAccounts === 'function') {
                accounts = await provider.requestAccounts();
            } else if (typeof provider.request === 'function') {
                // EIP-1193 style
                accounts = await provider.request({ method: 'eth_requestAccounts' });
            } else if (type === 'opnet' && (window as any).opnet?.requestAccounts) {
                // Direct call if provider interface didn't map correctly
                accounts = await (window as any).opnet.requestAccounts();
            } else {
                throw new Error('Wallet provider does not support requestAccounts');
            }

            if (accounts && accounts.length > 0) {
                // Fetch public key
                let publicKey = null;
                try {
                    if (typeof provider.getPublicKey === 'function') {
                        publicKey = await provider.getPublicKey();
                    } else if (typeof provider.request === 'function') {
                        publicKey = await provider.request({ method: 'btc_getPublicKey' });
                    }
                } catch (e) {
                    console.warn(`Could not fetch public key for ${type}:`, e);
                }

                this.updateState({
                    connected: true,
                    address: accounts[0],
                    publicKey,
                    type,
                    error: null
                });
                await this.refreshBalance();
                this.setupEventListeners(type);
                this.startPolling();
                localStorage.setItem('preferred_wallet', type);
            }
        } catch (err: any) {
            console.error(`Connect error for ${type}:`, err);
            this.updateState({ error: err.message || 'Connection failed' });
        }
    }

    public async getBalance(): Promise<number> {
        const provider = this.getProvider(this.state.type as WalletType);
        if (!provider) return 0;

        try {
            // Try direct getBalance() first (Unisat and some OP_WALLET versions)
            if (typeof (provider as any).getBalance === 'function') {
                const bal = await (provider as any).getBalance();
                if (typeof bal === 'number') return bal;
                if (typeof bal === 'object' && bal.total !== undefined) return Number(bal.total);
                if (typeof bal === 'object' && bal.balance !== undefined) return Number(bal.balance);
            }

            // Fallback for OP Wallet / EIP-1193 request style
            if (typeof provider.request === 'function') {
                const methods = ['eth_getBalance', 'bb_getBalance', 'btc_getBalance'];
                for (const method of methods) {
                    try {
                        const res = await provider.request({
                            method,
                            params: method.includes('eth_') ? [this.state.address, 'latest'] : []
                        });
                        if (res !== undefined && res !== null) {
                            if (typeof res === 'string') return parseInt(res, 16);
                            if (typeof res === 'number') return res;
                            if (typeof res === 'object' && res.total !== undefined) return Number(res.total);
                        }
                    } catch (e) { }
                }
            }
        } catch (err) {
            console.error('Failed to get balance:', err);
        }
        return 0;
    }

    public async refreshBalance() {
        if (!this.state.connected) return;
        const balance = await this.getBalance();
        if (balance !== this.state.balance) {
            this.updateState({ balance });
        }
    }

    private startPolling() {
        this.stopPolling();

        // Listen for tab focus/blur to avoid hammering RPC
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', this.handleVisibilityChange);
        }

        // Only poll if document is visible
        if (typeof document === 'undefined' || document.visibilityState === 'visible') {
            this.pollInterval = setInterval(() => this.refreshBalance(), 10000);
        }
    }

    private handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
            this.refreshBalance(); // Immediate refresh on focus
            if (!this.pollInterval) {
                this.pollInterval = setInterval(() => this.refreshBalance(), 10000);
            }
        } else {
            if (this.pollInterval) {
                clearInterval(this.pollInterval);
                this.pollInterval = null;
            }
        }
    };

    private stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        }
    }

    public async getPublicKey(): Promise<string> {
        let provider = this.getProvider(this.state.type as WalletType);
        if (!provider) throw new Error('Wallet not connected');

        let getPubFn = provider.getPublicKey;

        if (!getPubFn && window.opnet && typeof window.opnet.getPublicKey === 'function') {
            getPubFn = window.opnet.getPublicKey;
            provider = window.opnet;
        }

        if (!getPubFn && window.unisat && typeof window.unisat.getPublicKey === 'function') {
            getPubFn = window.unisat.getPublicKey;
            provider = window.unisat;
        }

        if (typeof getPubFn === 'function') {
            return await getPubFn.call(provider);
        }

        throw new Error('Wallet not connected or getPublicKey not supported');
    }

    public async signSchnorr(message: string): Promise<string> {
        const provider = this.getProvider(this.state.type as WalletType);
        if (!provider) throw new Error('Wallet not connected');

        // Some wallets use signMessage, some use signSchnorr
        if (typeof provider.signSchnorr === 'function') {
            return await provider.signSchnorr(message);
        }

        // Unisat style
        if (typeof (provider as any).signMessage === 'function') {
            return await (provider as any).signMessage(message);
        }

        // Generic EIP-1193 style if possible
        if (typeof provider.request === 'function') {
            return await provider.request({
                method: 'personal_sign',
                params: [message, this.state.address]
            });
        }

        throw new Error('Signing not supported by this wallet');
    }

    public async signMLDSAMessage(message: string) {
        const provider = this.getProvider(this.state.type as WalletType);
        if (!provider || typeof provider.signMLDSAMessage !== 'function') {
            throw new Error('ML-DSA Signing not supported by this wallet');
        }
        return await provider.signMLDSAMessage(message);
    }

    /**
     * PSBT signing with toSignInputs support and error logging.
     */
    public async signPsbt(psbt: string): Promise<string> {
        console.info('--- STARTING PSBT SIGNING ---');
        if (!psbt) throw new Error('No PSBT provided');

        const input = psbt.trim();

        let psbtHex: string;
        let psbtBase64: string;

        // Detect input format: hex starts with PSBT magic 70736274, base64 starts with cHNid
        if (input.toLowerCase().startsWith('70736274')) {
            psbtHex = input;
            const bytes = new Uint8Array(psbtHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
            psbtBase64 = btoa(Array.from(bytes).map(b => String.fromCharCode(b)).join(''));
        } else {
            psbtBase64 = input;
            const binaryStr = atob(input);
            psbtHex = Array.from(binaryStr).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
        }

        const signerAddress = this.state.address || '';

        // Build toSignInputs for indices 0-9 (wallets ignore extra indices)
        const toSignInputs = Array.from({ length: 10 }, (_, i) => ({
            index: i,
            address: signerAddress,
        }));

        const errors: string[] = [];

        const trySign = async (fn: Function, ctx: any, data: string, opts?: any, label?: string): Promise<string | null> => {
            try {
                const result = await fn.call(ctx, data, opts);
                if (result) return result;
            } catch (e: any) {
                const msg = e.message || String(e);
                if (msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('denied')) {
                    throw e; // User rejected — stop immediately
                }
                const errorDetail = `${label}: ${msg}`;
                errors.push(errorDetail);
                console.warn(`[signPsbt] ${errorDetail}`);
            }
            return null;
        };

        // 1. Gather wallet objects — preferred wallet first
        const preferred = this.getProvider(this.state.type as WalletType);
        const allTargets: any[] = [
            preferred,
            (window as any).unisat,
            (window as any).opnet?.bitcoin,
            (window as any).opnet?.btc,
            (window as any).opnet,
            (window as any).opnet_web3,
            (window as any).okxwallet?.bitcoin,
            (window as any).okxwallet,
            (window as any).XverseProviders?.BitcoinProvider,
            (window as any).btc,
            (window as any).bitcoin,
        ].filter(t => !!t && typeof t === 'object');

        const uniqueTargets = Array.from(new Set(allTargets));
        console.info(`[signPsbt] ${uniqueTargets.length} signer objects, wallet type: ${this.state.type}, address: ${signerAddress}`);

        const methodNames = ['signPsbt', 'signPSBT', 'signPsbtHex', 'signPSBTHex', 'signTransaction', 'signPsbtBuffer'];

        for (const target of uniqueTargets) {
            const keys = Object.getOwnPropertyNames(target).concat(Object.getOwnPropertyNames(Object.getPrototypeOf(target) || {}));
            console.info(`[signPsbt] Target methods:`, keys.filter(k => typeof target[k] === 'function'));

            for (const name of methodNames) {
                const fn = target[name];
                if (typeof fn !== 'function') continue;
                console.info(`[signPsbt] Trying ${name}...`);

                let r: string | null;
                // 1. Hex + toSignInputs (most wallets need this)
                r = await trySign(fn, target, psbtHex, { autoFinalized: false, toSignInputs }, `${name}(hex+toSignInputs)`);
                if (r) return r;
                // 2. Hex + simple options
                r = await trySign(fn, target, psbtHex, { autoFinalized: false }, `${name}(hex+opts)`);
                if (r) return r;
                // 3. Base64 + toSignInputs
                r = await trySign(fn, target, psbtBase64, { autoFinalized: false, toSignInputs }, `${name}(b64+toSignInputs)`);
                if (r) return r;
                // 4. Base64 + simple options
                r = await trySign(fn, target, psbtBase64, { autoFinalized: false }, `${name}(b64+opts)`);
                if (r) return r;
                // 5. Just hex
                r = await trySign(fn, target, psbtHex, undefined, `${name}(hex)`);
                if (r) return r;
                // 6. Just base64
                r = await trySign(fn, target, psbtBase64, undefined, `${name}(b64)`);
                if (r) return r;
            }

            // RPC style
            if (typeof target.request === 'function') {
                for (const rpcMethod of ['btc_signPsbt', 'signPsbt', 'btc_signPSBT', 'signTransaction']) {
                    try {
                        const result = await target.request({ method: rpcMethod, params: [psbtHex, { autoFinalized: false, toSignInputs }] });
                        if (result) return result;
                    } catch (e: any) {
                        const msg = (e.message || String(e)).toLowerCase();
                        if (msg.includes('reject') || msg.includes('cancel') || msg.includes('denied')) throw e;
                        errors.push(`rpc:${rpcMethod}: ${e.message || e}`);
                    }
                    try {
                        const result = await target.request({ method: rpcMethod, params: [psbtBase64, { autoFinalized: false, toSignInputs }] });
                        if (result) return result;
                    } catch (e: any) {
                        const msg = (e.message || String(e)).toLowerCase();
                        if (msg.includes('reject') || msg.includes('cancel') || msg.includes('denied')) throw e;
                    }
                    try {
                        const result = await target.request({ method: rpcMethod, params: [psbtHex] });
                        if (result) return result;
                    } catch (e: any) {
                        const msg = (e.message || String(e)).toLowerCase();
                        if (msg.includes('reject') || msg.includes('cancel') || msg.includes('denied')) throw e;
                    }
                }
            }
        }

        console.error('[signPsbt] All attempts failed. Errors:', errors);
        throw new Error(`Wallet signing failed. Errors: ${errors.slice(0, 3).join('; ')}`);
    }

    /**
     * Sends a raw transaction or contract interaction with value.
     * This is used for "Contract Interaction Funding" to bypass UI blocks.
     */
    public async sendTransaction(params: {
        to: string;
        value: number | string;
        data?: string;
    }): Promise<string> {
        const provider = this.getProvider(this.state.type as WalletType);
        const web3 = this.getWeb3Provider();

        if (!provider && !web3) throw new Error('Wallet not connected');

        // Try both providers for request() support
        const targets = [web3, provider].filter(Boolean);

        for (const target of targets) {
            if (typeof target.request === 'function') {
                try {
                    // Normalize value to hex if it's a number (satoshis)
                    const hexValue = typeof params.value === 'number'
                        ? '0x' + params.value.toString(16)
                        : params.value;

                    console.info(`Requesting sendTransaction to ${params.to} with value ${params.value}`);

                    // We try standard eth_sendTransaction first as most libraries use it
                    // but also a generic BTC interaction fallback
                    const txId = await target.request({
                        method: 'eth_sendTransaction',
                        params: [{
                            to: params.to,
                            value: hexValue,
                            data: params.data || '0x', // Empty data signals simple value transfer but in contract mode
                            from: this.state.address,
                        }]
                    });

                    if (txId) return txId;
                } catch (e: any) {
                    const msg = e.message || String(e);
                    if (msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('cancel')) {
                        throw e;
                    }
                    console.warn('sendTransaction attempt failed:', msg);
                }
            }
        }

        throw new Error('This wallet does not support programmatic contract interactions with value.');
    }

    /**
     * Fetches UTXOs directly from the wallet extension.
     * More reliable than querying the OP_NET RPC which may not be synced.
     */
    public async getUtxos(): Promise<any[]> {
        const targets: any[] = [
            (window as any).unisat,
            (window as any).opnet,
            (window as any).opnet_web3,
            (window as any).okxwallet?.bitcoin,
        ].filter(t => !!t && typeof t === 'object');

        for (const target of targets) {
            // Try getBitcoinUtxos (OP_WALLET style)
            if (typeof target.getBitcoinUtxos === 'function') {
                try {
                    const utxos = await target.getBitcoinUtxos();
                    if (utxos && utxos.length > 0) {
                        console.info(`Got ${utxos.length} UTXOs from getBitcoinUtxos`);
                        return utxos;
                    }
                } catch (e) { console.warn('getBitcoinUtxos failed:', e); }
            }
            // Try getUtxos (Unisat style)
            if (typeof target.getUtxos === 'function') {
                try {
                    const utxos = await target.getUtxos();
                    if (utxos && utxos.length > 0) {
                        console.info(`Got ${utxos.length} UTXOs from getUtxos`);
                        return utxos;
                    }
                } catch (e) { console.warn('getUtxos failed:', e); }
            }
        }

        return [];
    }

    public async sendBitcoin(toAddress: string, satoshis: number): Promise<string> {
        const provider = this.getProvider(this.state.type as WalletType);
        if (!provider) throw new Error('Wallet not connected');

        // 1. Try direct call on current provider
        if (typeof provider.sendBitcoin === 'function') {
            console.info('Using direct sendBitcoin on provider');
            return await provider.sendBitcoin(toAddress, satoshis);
        }

        // 2. Try direct call on root window objects as backup
        const backups = [window.unisat, window.opnet];
        for (const backup of backups) {
            if (backup && typeof (backup as any).sendBitcoin === 'function') {
                try {
                    console.info('Using backup sendBitcoin on root object');
                    return await (backup as any).sendBitcoin(toAddress, satoshis);
                } catch (e) { console.warn('Backup sendBitcoin failed', e); }
            }
        }

        // 3. RPC Fallback attempts (check primary and then web3 specifically)
        const providersToTry = [provider, this.getWeb3Provider()];
        for (const p of providersToTry) {
            if (p && typeof p.request === 'function') {
                const attempts = [
                    { method: 'btc_sendBitcoin', params: [toAddress, satoshis] },
                    { method: 'btc_sendBitcoin', params: { address: toAddress, amount: satoshis } },
                    { method: 'btc_transfer', params: [toAddress, satoshis] },
                    { method: 'sendBitcoin', params: [toAddress, satoshis] },
                    { method: 'btc_sendTransaction', params: [{ to: toAddress, value: satoshis }] }
                ];

                for (const attempt of attempts) {
                    try {
                        console.info(`Attempting sendBitcoin RPC: ${attempt.method}`);
                        const txId = await p.request(attempt);
                        if (txId) return txId;
                    } catch (e: any) {
                        const msg = e.message || String(e);
                        if (msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('cancel')) {
                            throw e;
                        }
                        console.warn(`RPC ${attempt.method} failed:`, msg);
                    }
                }
            }
        }

        throw new Error('Sending Bitcoin is not supported by this wallet provider. You can still fund manually by sending to the treasury address.');
    }

    public async disconnect(): Promise<void> {
        this.stopPolling();
        this.updateState({
            connected: false,
            address: null,
            balance: 0,
            type: null,
            error: null
        });
        localStorage.removeItem('preferred_wallet');
    }

    public async checkConnection(retries = 5): Promise<void> {
        const savedType = localStorage.getItem('preferred_wallet') as WalletType | null;
        if (!savedType) return;

        let provider = this.getProvider(savedType);

        // If not found, wait and retry (extensions can be slow to inject)
        if (!provider && retries > 0) {
            console.info(`Wallet provider ${savedType} not found yet, retrying... (${retries} left)`);
            setTimeout(() => this.checkConnection(retries - 1), 1000);
            return;
        }

        if (!provider) return;

        try {
            let accounts: string[] = [];
            if (typeof provider.getAccounts === 'function') {
                accounts = await provider.getAccounts();
            } else if (typeof provider.request === 'function') {
                accounts = await provider.request({ method: 'eth_accounts' });
            }

            if (accounts && accounts.length > 0) {
                let publicKey = null;
                try {
                    if (typeof provider.getPublicKey === 'function') {
                        publicKey = await provider.getPublicKey();
                    } else if (typeof provider.request === 'function') {
                        publicKey = await provider.request({ method: 'btc_getPublicKey' });
                    }
                } catch (e) {
                    console.warn(`Could not fetch public key for ${savedType}:`, e);
                }

                this.updateState({
                    connected: true,
                    address: accounts[0],
                    publicKey,
                    type: savedType,
                    error: null
                });
                await this.refreshBalance();
                this.setupEventListeners(savedType);
                this.startPolling();
            }
        } catch (err) {
            console.warn(`Failed to check existing connection for ${savedType}`, err);
        }
    }

    public getProvider(type: WalletType): any {
        if (typeof window === 'undefined') return null;
        if (type === 'unisat') return window.unisat;
        if (type === 'opnet') {
            // For OP_WALLET, we prefer the root object for standard Unisat-compatible calls
            // because it uses the (address, amount) signature for sendBitcoin.
            // The .web3 sub-object is for OP_NET smart contract interactions.
            if (window.opnet) return window.opnet;
            if ((window as any).opnet_web3) return (window as any).opnet_web3;
            if ((window as any).opnet?.web3) return (window as any).opnet.web3;
        }
        return null;
    }

    /**
     * Specifically returns the OP_NET Web3 provider if available
     */
    public getWeb3Provider(): any {
        if (typeof window === 'undefined') return null;
        if ((window as any).opnet?.web3) return (window as any).opnet.web3;
        if ((window as any).opnet_web3) return (window as any).opnet_web3;
        return window.opnet; // fallback to root
    }

    private setupEventListeners(type: WalletType) {
        const provider = this.getProvider(type);
        if (!provider || typeof provider.on !== 'function') return;

        provider.on('accountsChanged', async (accounts: string[]) => {
            if (accounts.length > 0) {
                let publicKey = null;
                try {
                    if (typeof provider.getPublicKey === 'function') {
                        publicKey = await provider.getPublicKey();
                    }
                } catch (e) { }

                this.updateState({ address: accounts[0], publicKey, connected: true });
                await this.refreshBalance();
            } else {
                this.stopPolling();
                this.updateState({ address: null, publicKey: null, connected: false, balance: 0 });
            }
        });
    }

    private updateState(newState: Partial<WalletState>) {
        this.state = { ...this.state, ...newState };
        this.notify();
    }

    public subscribe(listener: Listener) {
        this.listeners.push(listener);
        listener(this.state);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private notify() {
        this.listeners.forEach(l => l(this.state));
    }

    public getState(): WalletState {
        return this.state;
    }
}

export const walletService = new WalletService();