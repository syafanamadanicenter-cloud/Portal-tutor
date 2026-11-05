// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyC_UpYrLz8lN43mzZgNFc_Yet0Lnf-3nqI",
  authDomain: "portal-tutor.firebaseapp.com",
  projectId: "portal-tutor",
  storageBucket: "portal-tutor.firebasestorage.app",
  messagingSenderId: "2290054364",
  appId: "1:2290054364:web:128081131b21973d603019",
  measurementId: "G-ESGTZDER1M"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
