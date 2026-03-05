import { walletService, WalletState, WalletType } from '../services/wallet.service.js';

export function renderWalletConnect(container: HTMLElement): () => void {
    const updateUI = (state: WalletState) => {
        container.innerHTML = '';

        if (state.connected && state.address) {
            const btn = document.createElement('button');
            btn.className = 'wallet-connect-btn connected';

            const shortAddress = `${state.address.slice(0, 6)}...${state.address.slice(-4)}`;
            const walletIcon = state.type === 'opnet' ? '🛡️' : '👛';
            const walletName = state.type === 'opnet' ? 'OP Wallet' : 'Unisat';

            btn.innerHTML = `
        <span class="wallet-icon">${walletIcon}</span>
        <div class="wallet-info">
          <span class="wallet-name">${walletName}</span>
          <span class="wallet-address">${shortAddress}</span>
        </div>
      `;

            btn.onclick = () => {
                if (confirm(`Disconnect ${walletName}?`)) {
                    walletService.disconnect();
                }
            };
            container.appendChild(btn);
        } else {
            const wrapper = document.createElement('div');
            wrapper.className = 'wallet-selection-wrapper';

            const createBtn = (type: WalletType, label: string, icon: string, available: boolean) => {
                const btn = document.createElement('button');
                btn.className = `wallet-select-btn ${type}`;
                if (!available) btn.classList.add('disabled');

                btn.innerHTML = `
          <span class="wallet-icon">${icon}</span>
          <span>${label}</span>
        `;

                btn.onclick = () => {
                    if (!available) {
                        alert(`${label} not found. Please install the extension.`);
                        return;
                    }
                    walletService.connect(type);
                };
                return btn;
            };

            const unisatBtn = createBtn('unisat', 'Unisat', '👛', walletService.isUnisatAvailable());
            const opnetBtn = createBtn('opnet', 'OP Wallet', '🛡️', walletService.isOPWalletAvailable());

            wrapper.appendChild(unisatBtn);
            wrapper.appendChild(opnetBtn);
            container.appendChild(wrapper);
        }

        if (state.error) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'wallet-error';
            errorDiv.innerText = state.error;
            container.appendChild(errorDiv);

            setTimeout(() => {
                if (container.contains(errorDiv)) container.removeChild(errorDiv);
            }, 5000);
        }
    };

    return walletService.subscribe(updateUI);
}
