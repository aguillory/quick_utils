import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, doc, collection } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

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

const CURRENT_ENV = 'prod';
export const getEnv = () => CURRENT_ENV;

export const getTrackerDoc = (...pathSegments) => {
    return doc(db, 'tracker', 'prod', ...pathSegments);
};

export const getTrackerCollection = (...pathSegments) => {
    return collection(db, 'tracker', 'prod', ...pathSegments);
};

export { db, auth };

signInAnonymously(auth).catch(console.error);
