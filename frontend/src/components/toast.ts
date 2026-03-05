export function showToast(
    message: string,
    type: 'success' | 'error' | 'info' = 'info',
): void {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    container.appendChild(el);

    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(100%)';
        el.style.transition = 'all 300ms';
        setTimeout(() => el.remove(), 300);
    }, 4000);
}
