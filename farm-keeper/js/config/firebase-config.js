// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };