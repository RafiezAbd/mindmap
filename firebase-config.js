// ============================================================
// FIREBASE CONFIG
// ------------------------------------------------------------
// 1. Go to https://console.firebase.google.com → create a project
// 2. Project settings → General → "Your apps" → Add a Web app
// 3. Copy the config object Firebase gives you and paste the
//    values below (replace every "REPLACE_ME").
// 4. In the console, enable:
//      Build → Authentication → Sign-in method → Email/Password
//      Build → Firestore Database → Create database (production mode)
// 5. See README.md for the Firestore security rules to paste in.
// ============================================================

export const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.appspot.com",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME"
};
