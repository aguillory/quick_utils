const firebaseConfig = {
  apiKey: "AIzaSyAvozMxlA1pCVvQos4faqm_7oFP53eK_NY",
  authDomain: "farm-manager-7a8a5.firebaseapp.com",
  projectId: "farm-manager-7a8a5",
  storageBucket: "farm-manager-7a8a5.firebasestorage.app",
  messagingSenderId: "207747657886",
  appId: "1:207747657886:web:13616f4e1251876ab80b8f",
  measurementId: "G-TR2E1SXLZJ"
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