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

const CURRENT_ENV = localStorage.getItem('quick_utils_env') || 'prod';
window.getEnv = () => CURRENT_ENV;
window.toggleEnv = () => {
    const newEnv = CURRENT_ENV === 'prod' ? 'test' : 'prod';
    localStorage.setItem('quick_utils_env', newEnv);
    location.reload();
};
window.getNiptoCollection = (colName) => {
    // If it's a dynamic path that already has prefix, be careful. 
    // All known usages are direct string literals like 'custom_tasks'.
    return db.collection('nipto/' + window.getEnv() + '/' + colName);
};