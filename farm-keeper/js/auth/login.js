import { auth } from '../config/firebase-config.js';
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const loginForm = document.getElementById('loginForm');
const errorMsg = document.getElementById('errorMessage');

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    try {
        errorMsg.textContent = "Logging in...";
        // Firebase Login
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        
        // Success: Redirect to Dashboard
        console.log("Logged in:", userCredential.user.uid);
        window.location.href = "dashboard.html"; 
        
    } catch (error) {
        console.error("Login failed", error);
        errorMsg.textContent = "Invalid email or password.";
    }
});