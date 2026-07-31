const firebaseConfig = {
    apiKey: "BURAYA_FIREBASE_API_KEY_GELECEK",
    authDomain: "BURAYA_AUTH_DOMAIN",
    projectId: "BURAYA_PROJECT_ID",
    storageBucket: "BURAYA_STORAGE_BUCKET",
    messagingSenderId: "BURAYA_MESSAGING_SENDER_ID",
    appId: "BURAYA_APP_ID"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();