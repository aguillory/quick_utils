const firebaseConfig = {
  apiKey: "AIzaSyBZEMURsXfHMi9E-sOPv5MEBBuqsnPuwEA",
  authDomain: "quick-utils.firebaseapp.com",
  projectId: "quick-utils",
  storageBucket: "quick-utils.firebasestorage.app",
  messagingSenderId: "761342715921",
  appId: "1:761342715921:web:3f05487a9a40beaccfe9b0"
};


// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize Firestore
const db = firebase.firestore();

// Initialize Auth
const auth = firebase.auth();

// Export for use in other scripts (these will be global variables)
window.db = db;
window.auth = auth;

const CURRENT_ENV = window.location.pathname.includes('/test-env/') ? 'test' : 'prod';
window.getEnv = () => CURRENT_ENV;
window.getFarmCollection = (colName) => {
    if (window.getEnv() === 'test') {
        return db.collection('farm_manager/test/' + colName);
    }
    return db.collection('farm_manager/prod/' + colName);
};
