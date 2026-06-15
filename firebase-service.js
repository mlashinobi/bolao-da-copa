import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

function hasValidConfig(config) {
  return Boolean(
    config &&
    config.apiKey &&
    config.authDomain &&
    config.projectId &&
    !Object.values(config).some(value => String(value).includes("COLE_AQUI"))
  );
}

export const isFirebaseConfigured = hasValidConfig(firebaseConfig);
export const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
export const auth = isFirebaseConfigured ? getAuth(app) : null;
export const db = isFirebaseConfigured ? getFirestore(app) : null;
