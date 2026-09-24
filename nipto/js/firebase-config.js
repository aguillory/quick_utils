// firebase-config.js
const firebaseConfig = {
  apiKey: "AIzaSyBZEMURsXfHMi9E-sOPv5MEBBuqsnPuwEA",
  authDomain: "quick-utils.firebaseapp.com",
  projectId: "quick-utils",
  storageBucket: "quick-utils.firebasestorage.app",
  messagingSenderId: "761342715921",
  appId: "1:761342715921:web:3f05487a9a40beaccfe9b0"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

window.db = db;
window.auth = auth;

const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const CURRENT_ENV = (window.location.pathname.includes('/test-env/') || isLocalhost) ? 'test' : 'prod';
window.getEnv = () => CURRENT_ENV;
window.getNiptoCollection = (colName) => {
    // If it's a dynamic path that already has prefix, be careful. 
    // All known usages are direct string literals like 'custom_tasks'.
    return db.collection('nipto/' + window.getEnv() + '/' + colName);
};
