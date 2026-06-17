// toast.js
// Floating "task logged" toast notifications with rapid-tap multipliers.

const toastTimeouts = {};
const toastCounts = {};

// Shows or increments a toast for a logged task.
export function showToast(taskUid, taskName, points, namesString) {
    let container = document.getElementById('toast-container');
    if (!container) return;

    const toastId = `toast-${taskUid}`;
    let existingToast = document.getElementById(toastId);

    if (existingToast) {
        toastCounts[taskUid] = (toastCounts[taskUid] || 1) + 1;
        existingToast.innerHTML = `✅ Logged <b>${taskName}</b> for <b>${namesString}</b> (+${points} pts) <span style="background: white; color: var(--success, #22c55e); padding: 2px 6px; border-radius: 10px; font-weight: bold; margin-left: 5px; font-size: 12px;">x${toastCounts[taskUid]}</span>`;

        existingToast.style.animation = 'none';
        existingToast.offsetHeight;
        existingToast.style.animation = 'slideUpFade 0.2s ease-out';

        clearTimeout(toastTimeouts[taskUid]);
        toastTimeouts[taskUid] = setTimeout(() => {
            existingToast.remove();
            delete toastCounts[taskUid];
        }, 3000);
    } else {
        toastCounts[taskUid] = 1;
        const toast = document.createElement('div');
        toast.id = toastId;
        toast.style.cssText = 'background: var(--success, #22c55e); color: white; padding: 12px 24px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); font-size: 14px; animation: slideUpFade 0.3s ease-out; transition: opacity 0.3s, transform 0.3s;';
        toast.innerHTML = `✅ Logged <b>${taskName}</b> for <b>${namesString}</b> (+${points} pts)`;
        container.appendChild(toast);

        toastTimeouts[taskUid] = setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            setTimeout(() => toast.remove(), 300);
            delete toastCounts[taskUid];
        }, 3000);
    }
}