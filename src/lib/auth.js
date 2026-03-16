import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getRedirectResult,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase.js";
import { getRankFromRating } from "./ranking.js";

const provider = new GoogleAuthProvider();

function buildFallbackProfile(user, displayNameOverride) {
  const displayName =
    displayNameOverride || user.displayName || user.email?.split("@")[0] || "Player";
  const rating = 1000;
  const rank = getRankFromRating(rating).name;
  return { id: user.uid, displayName, rating, rank, wins: 0, losses: 0, draws: 0 };
}

export async function ensureUserProfile(user, displayNameOverride) {
  if (!user) return null;
  if (!db) {
    const profile = buildFallbackProfile(user, displayNameOverride);
    if (!user.displayName && profile.displayName) {
      await updateProfile(user, { displayName: profile.displayName });
    }
    return profile;
  }
  try {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const profile = buildFallbackProfile(user, displayNameOverride);
      await setDoc(ref, {
        displayName: profile.displayName,
        rating: profile.rating,
        rank: profile.rank,
        wins: 0,
        losses: 0,
        draws: 0,
        createdAt: serverTimestamp(),
      });
      if (!user.displayName && profile.displayName) {
        await updateProfile(user, { displayName: profile.displayName });
      }
      return profile;
    }
    return { id: user.uid, ...snap.data() };
  } catch {
    const profile = buildFallbackProfile(user, displayNameOverride);
    if (!user.displayName && profile.displayName) {
      await updateProfile(user, { displayName: profile.displayName });
    }
    return profile;
  }
}

export async function signInEmail(email, password) {
  if (!auth) throw new Error("Auth unavailable");
  return signInWithEmailAndPassword(auth, email, password);
}

export async function signUpEmail(email, password, displayName) {
  if (!auth) throw new Error("Auth unavailable");
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) await updateProfile(cred.user, { displayName });
  await ensureUserProfile(cred.user, displayName);
  return cred;
}

export async function signInGoogle() {
  if (!auth) throw new Error("Auth unavailable");
  const preferRedirect = typeof window !== "undefined" && window.crossOriginIsolated;
  if (preferRedirect) {
    await signInWithRedirect(auth, provider);
    return null;
  }
  try {
    const cred = await signInWithPopup(auth, provider);
    await ensureUserProfile(cred.user);
    return cred;
  } catch (error) {
    const code = error?.code;
    if (
      code === "auth/popup-blocked" ||
      code === "auth/popup-closed-by-user" ||
      code === "auth/operation-not-supported-in-this-environment"
    ) {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw error;
  }
}

export async function signOutUser() {
  if (!auth) return null;
  return signOut(auth);
}

export function subscribeAuth(callback) {
  if (!auth) {
    callback(null, null);
    return () => {};
  }
  getRedirectResult(auth)
    .then((cred) => {
      if (cred?.user) return ensureUserProfile(cred.user);
      return null;
    })
    .catch(() => null);
  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      callback(null, null);
      return;
    }
    try {
      const profile = await ensureUserProfile(user);
      callback(user, profile);
    } catch {
      callback(user, null);
    }
  });
}
