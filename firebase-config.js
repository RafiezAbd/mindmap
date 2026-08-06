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
  apiKey: "AIzaSyD6I8Y3wQLf_luGzUqEQTTnKiewGVY6Ghs",
  authDomain: "mindmapdash.firebaseapp.com",
  projectId: "mindmapdash",
  storageBucket: "mindmapdash.firebasestorage.app",
  messagingSenderId: "844299940735",
  appId: "1:844299940735:web:fdf45c21be31e38fb8204a"
};

// ------------------------------------------------------------
// Google OAuth Web Client ID (NOT the same as apiKey above).
// Firebase auto-created this the moment you enabled Google as a
// sign-in provider. Find it at:
//   Google Cloud Console → APIs & Services → Credentials
//   → look under "OAuth 2.0 Client IDs" for
//     "Web client (auto created by Google Service)"
// It looks like: 123456789-abc123xyz.apps.googleusercontent.com
//
// Also add your site's exact origin (e.g. https://you.github.io,
// no trailing slash/path) to that client's "Authorized JavaScript
// origins" list on the same page.
// ------------------------------------------------------------
export const googleClientId = "844299940735-009nqoktkpidar6ndhbqspdaugonln9g.apps.googleusercontent.com";
