import { renderNav } from './components/nav.js';
import { renderOverview } from './pages/overview.js';
import { renderUTXOList } from './pages/utxo-list.js';
import { renderConsolidate } from './pages/consolidate.js';
import { renderBatchPayout } from './pages/batch-payout.js';
import { renderPolicies } from './pages/policies.js';
import { walletService } from './services/wallet.service.js';

type Route = 'overview' | 'utxo-list' | 'consolidate' | 'batch-payout' | 'policies';

const renderers: Record<Route, (el: HTMLElement) => Promise<void>> = {
    'overview': renderOverview,
    'utxo-list': renderUTXOList,
    'consolidate': renderConsolidate,
    'batch-payout': renderBatchPayout,
    'policies': renderPolicies,
};

let currentRoute: Route = 'overview';

function navigate(route: string): void {
    currentRoute = route as Route;
    window.location.hash = route;

    const sidebar = document.getElementById('sidebar')!;
    const content = document.getElementById('content')!;

    // Close mobile menu on navigation
    sidebar.classList.remove('open');

    renderNav(sidebar, currentRoute, navigate);

    const renderer = renderers[currentRoute];
    if (renderer) {
        renderer(content);
    } else {
        content.innerHTML = '<p>Page not found</p>';
    }
}

// Init on load
window.addEventListener('DOMContentLoaded', () => {
    // Check for existing wallet connection
    walletService.checkConnection();

    const hash = window.location.hash.replace('#', '') || 'overview';
    navigate(hash);

    // Mobile menu toggle
    const menuBtn = document.getElementById('mobile-menu-btn');
    const sidebar = document.getElementById('sidebar');
    if (menuBtn && sidebar) {
        menuBtn.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });
    }
});

// Handle browser back/forward
window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '') || 'overview';
    if (hash !== currentRoute) {
        navigate(hash);
    }
});
