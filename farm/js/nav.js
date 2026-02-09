document.addEventListener('DOMContentLoaded', () => {
    const navContainer = document.getElementById('global-nav');
    if (!navContainer) return;

    // The HTML for your Navigation Bar
    const navHTML = `
    <nav class="navbar">
        <div class="nav-container">
            <h1><i class="fas fa-seedling"></i> Farm Manager</h1>
            <div class="nav-links">
                <a href="dashboard.html" data-page="dashboard.html"><i class="fas fa-home"></i> Dashboard</a>
                <a href="species.html" data-page="species.html"><i class="fas fa-paw"></i> Species</a>
                <a href="animals.html" data-page="animals.html"><i class="fas fa-horse"></i> Animals</a>
                <a href="health.html" data-page="health.html"><i class="fas fa-heartbeat"></i> Health</a>
                <button id="logoutBtn" class="btn-logout"><i class="fas fa-sign-out-alt"></i> Logout</button>
            </div>
        </div>
    </nav>
    `;

    // Inject the HTML
    navContainer.innerHTML = navHTML;

    // Highlight the active link based on the URL
    const currentPage = window.location.pathname.split('/').pop();
    const links = document.querySelectorAll('.nav-links a');
    
    links.forEach(link => {
        if (link.getAttribute('data-page') === currentPage) {
            link.classList.add('active');
        }
    });

    // Re-attach Logout Event Listener (since the button was just created dynamically)
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn && window.firebase) {
        logoutBtn.addEventListener('click', () => {
            firebase.auth().signOut().then(() => {
                window.location.href = 'index.html';
            });
        });
    }
});