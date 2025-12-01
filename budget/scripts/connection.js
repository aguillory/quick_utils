import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
const firebaseConfig = {
    apiKey: "AIzaSyBUNb26WpRCPUJN3k51X_A9OndQFZwICjY",
    authDomain: "budget-87a6d.firebaseapp.com",
    projectId: "budget-87a6d",
    storageBucket: "budget-87a6d.firebasestorage.app",
    messagingSenderId: "1040095975333",
    appId: "1:1040095975333:web:8401747beb9e7e5ebd7a4c"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
export { db, auth };
