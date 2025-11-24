import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
// --- PASTE YOUR FIREBASE CONFIGURATION OBJECT HERE ---
const firebaseConfig = {
    apiKey: "AIzaSyBUNb26WpRCPUJN3k51X_A9OndQFZwICjY",
    authDomain: "budget-87a6d.firebaseapp.com",
    projectId: "budget-87a6d",
    storageBucket: "budget-87a6d.firebasestorage.app",
    messagingSenderId: "1040095975333",
    appId: "1:1040095975333:web:8401747beb9e7e5ebd7a4c"
};
// ---------------------------------------------------------

// Initialize Firebase
const app = initializeApp(firebaseConfig);
// Initialize Cloud Firestore and get a reference to the service
const db = getFirestore(app);
const auth = getAuth(app);

// Export the db instance to be used in other modules
export { db, auth };
