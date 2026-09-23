// js/login.js
const errorMsg = document.getElementById('errorMessage');

// Automatically redirect if already logged in
firebase.auth().onAuthStateChanged((user) => {
    if (user) {
        window.location.href = "dashboard.html";
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
            const credential = result.credential;
            const token = credential ? credential.accessToken : null;
            
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
