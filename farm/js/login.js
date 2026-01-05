// js/login.js
const loginForm = document.getElementById('loginForm');
const errorMsg = document.getElementById('errorMessage');

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    try {
        errorMsg.textContent = "Logging in...";
        
        // Use global firebase object instead of import
        await firebase.auth().signInWithEmailAndPassword(email, password);
        
        // Auth state listener in other files will handle redirect, 
        // but we can force it here for better UX
        window.location.href = "dashboard.html"; 
        
    } catch (error) {
        console.error("Login failed", error);
        errorMsg.textContent = "Invalid email or password.";
    }
});