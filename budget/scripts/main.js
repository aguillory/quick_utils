const contentEl = document.getElementById('app-content');
const navEl = document.getElementById('tab-nav');

const pages = {
    paycheck: { html: 'paycheck.html', module: './paycheck.js', init: 'initPaycheck' },
    accounts: { html: 'accounts.html', module: './accounts.js', init: 'initAccounts' },
    transactions: { html: 'transactions.html', module: null, init: null }, // Example for future pages
    summary: { html: 'summary.html', module: null, init: null }
};

async function loadPage(pageName) {
    const page = pages[pageName];
    if (!page) {
        contentEl.innerHTML = `<p class="text-center p-10 bg-white rounded-lg shadow-sm">Page not found.</p>`;
        return;
    }
    
    // For pages without full functionality yet
    if(!page.module) {
        contentEl.innerHTML = `<p class="text-center p-10 bg-white rounded-lg shadow-sm">${pageName.charAt(0).toUpperCase() + pageName.slice(1)} page coming soon!</p>`;
        return;
    }

    try {
        const response = await fetch(page.html);
        if (!response.ok) throw new Error(`Could not load ${page.html}`);
        
        contentEl.innerHTML = await response.text();
        
        const pageModule = await import(page.module);
        if (pageModule[page.init]) {
            pageModule[page.init]();
        }
    } catch (error) {
        console.error(`Failed to load page: ${pageName}`, error);
        contentEl.innerHTML = `<p class="text-center p-10 bg-red-100 text-red-700 rounded-lg shadow-sm">Error loading page content. Check the console for details.</p>`;
    }
}

navEl.addEventListener('click', (e) => {
    if (e.target.matches('.tab')) {
        const pageName = e.target.dataset.page;
        
        // Update active tab style
        navEl.querySelectorAll('.tab').forEach(t => t.classList.remove('tab-active'));
        e.target.classList.add('tab-active');

        loadPage(pageName);
    }
});

// Load the default page on initial visit
document.addEventListener('DOMContentLoaded', () => {
    const defaultTab = navEl.querySelector('[data-page="accounts"]');
    if (defaultTab) {
        defaultTab.click();
    }
});
