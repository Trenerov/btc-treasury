// TreasuryService — manages the treasury address separately from the admin wallet.
//
// Treasury = the PolicyVault contract address (or a watched address).
// Admin wallet = the connected OP_WALLET, used only for signing.

type TreasuryState = {
    address: string | null;
    contractAddress: string | null;
    name: string;
};

type TreasuryListener = (state: TreasuryState) => void;

const STORAGE_KEY = 'btc_treasury_state';

class TreasuryService {
    private state: TreasuryState = {
        address: null,
        contractAddress: null,
        name: 'My Treasury',
    };

    private listeners: TreasuryListener[] = [];

    constructor() {
        this.loadFromStorage();
    }

    // Connect to an existing treasury by address
    public connect(address: string, name?: string) {
        this.state = {
            address,
            contractAddress: address,
            name: name || 'Treasury',
        };
        this.saveToStorage();
        this.notify();
    }

    // Set treasury after deploying a contract
    public setDeployed(contractAddress: string, name?: string) {
        this.state = {
            address: contractAddress,
            contractAddress,
            name: name || 'My Treasury',
        };
        this.saveToStorage();
        this.notify();
    }

    public disconnect() {
        this.state = { address: null, contractAddress: null, name: 'My Treasury' };
        localStorage.removeItem(STORAGE_KEY);
        this.notify();
    }

    public getState(): TreasuryState {
        return this.state;
    }

    public isConnected(): boolean {
        return this.state.address !== null;
    }

    public subscribe(listener: TreasuryListener) {
        this.listeners.push(listener);
        listener(this.state);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private notify() {
        this.listeners.forEach(l => l(this.state));
    }

    private loadFromStorage() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed.address) {
                    this.state = parsed;
                }
            }
        } catch {
            // ignore
        }
    }

    private saveToStorage() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    }
}

export const treasuryService = new TreasuryService();
