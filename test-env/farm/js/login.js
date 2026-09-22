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

const btnGoogleSignIn = document.getElementById('btnGoogleSignIn');
if (btnGoogleSignIn) {
    btnGoogleSignIn.addEventListener('click', async () => {
        try {
            errorMsg.textContent = "Redirecting to Google...";
            const provider = new firebase.auth.GoogleAuthProvider();
            // Request Calendar scope
            provider.addScope('https://www.googleapis.com/auth/calendar.events');
            
            const result = await firebase.auth().signInWithPopup(provider);
            const credential = firebase.auth.GoogleAuthProvider.credentialFromResult(result);
            const token = credential.accessToken;
            
            // Save the Google Access Token for this session to use the Calendar API
            if (token) {
                sessionStorage.setItem('googleCalendarToken', token);
            }
            
            window.location.href = "dashboard.html";
        } catch (error) {
            console.error("Google Login failed", error);
            errorMsg.textContent = "Google Sign-In failed: " + error.message;
        }
    });
}
