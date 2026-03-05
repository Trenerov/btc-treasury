const ROUTES = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'utxo-list', label: 'UTXO List', icon: '🔗' },
  { id: 'consolidate', label: 'Consolidate', icon: '🔄' },
  { id: 'batch-payout', label: 'Batch Payouts', icon: '💸' },
  { id: 'policies', label: 'Policies', icon: '🛡️' },
];

let walletCleanup: (() => void) | null = null;

export function renderNav(
  container: HTMLElement,
  activeRoute: string,
  onNavigate: (route: string) => void,
): void {
  if (walletCleanup) {
    walletCleanup();
    walletCleanup = null;
  }
  container.innerHTML = `
    <div class="sidebar-logo">
      <div class="logo-icon">₿</div>
      <div>
        <div class="logo-text">BTC Treasury</div>
        <div class="logo-subtitle">OP_NET Dashboard</div>
      </div>
    </div>

    <div class="nav-section">
      <div class="nav-section-title">Menu</div>
      ${ROUTES.map(
    (r) => `
        <div class="nav-item ${r.id === activeRoute ? 'active' : ''}" data-route="${r.id}">
          <span class="nav-icon">${r.icon}</span>
          <span>${r.label}</span>
        </div>
      `,
  ).join('')}
    </div>

    <div class="sidebar-footer">
      <div id="wallet-connect-container"></div>
      <div class="network-badge">
        <span class="network-dot"></span>
        <span>OP_NET Testnet</span>
      </div>
    </div>
  `;

  const walletContainer = container.querySelector('#wallet-connect-container') as HTMLElement;
  if (walletContainer) {
    import('./wallet-connect.js').then(m => {
      walletCleanup = m.renderWalletConnect(walletContainer);
    });
  }

  container.querySelectorAll('.nav-item').forEach((el) => {
    el.addEventListener('click', () => {
      const route = (el as HTMLElement).dataset.route!;
      onNavigate(route);
    });
  });
}
