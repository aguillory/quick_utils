// Firebase Configuration & Firestore modular SDK v11 imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getFirestore, 
    doc, 
    collection, 
    getDoc,
    getDocs, 
    setDoc, 
    updateDoc, 
    deleteDoc, 
    writeBatch,
    onSnapshot, 
    query, 
    where, 
    orderBy 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { 
    getAuth, 
    signInAnonymously,
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// Reusing project config from quick_utils/tracker/js/connection.js
const firebaseConfig = {
    apiKey: "AIzaSyBZEMURsXfHMi9E-sOPv5MEBBuqsnPuwEA",
    authDomain: "quick-utils.firebaseapp.com",
    projectId: "quick-utils",
    storageBucket: "quick-utils.firebasestorage.app",
    messagingSenderId: "761342715921",
    appId: "1:761342715921:web:3f05487a9a40beaccfe9b0"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Singleton promise that resolves once anonymous auth is established
let authInitPromise = null;

function ensureAuthReady() {
    if (auth.currentUser) {
        return Promise.resolve(auth.currentUser);
    }
    if (!authInitPromise) {
        authInitPromise = new Promise((resolve) => {
            const unsubscribe = onAuthStateChanged(auth, (user) => {
                if (user) {
                    unsubscribe();
                    resolve(user);
                }
            });

            signInAnonymously(auth).catch((err) => {
                console.warn("Anonymous auth note:", err.message);
                unsubscribe();
                resolve(null);
            });
        });
    }
    return authInitPromise;
}

// Sign in anonymously to guarantee authenticated Firestore reads & writes
ensureAuthReady();

export { 
    db, 
    auth, 
    ensureAuthReady,
    doc, 
    collection, 
    getDoc,
    getDocs, 
    setDoc, 
    updateDoc, 
    deleteDoc, 
    writeBatch,
    onSnapshot, 
    query, 
    where, 
    orderBy 
};
