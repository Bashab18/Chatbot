import React, { createContext, useContext, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import { doc, setDoc, getDoc, updateDoc, increment, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [profile, setProfile] = useState(null); // Firestore user doc
  const [loading, setLoading] = useState(true);

  // Load Firestore profile
  async function loadProfile(firebaseUser) {
    if (!firebaseUser) { setProfile(null); return; }
    try {
      const snap = await getDoc(doc(db, "users", firebaseUser.uid));
      if (snap.exists()) setProfile(snap.data());
    } catch {}
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      await loadProfile(firebaseUser);
      setLoading(false);
    });
    return unsub;
  }, []);

  async function signup(email, password, displayName, role) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName });
    const profileData = {
      email,
      displayName,
      role,
      loginCount: 0,
      lastLogin:  null,
      note:       "",
      createdAt:  Date.now(),
    };
    await setDoc(doc(db, "users", cred.user.uid), profileData);
    setProfile(profileData);
    return cred.user;
  }

  async function login(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    // Update login stats
    try {
      await updateDoc(doc(db, "users", cred.user.uid), {
        loginCount: increment(1),
        lastLogin:  Date.now(),
      });
    } catch {}
    await loadProfile(cred.user);
    return cred.user;
  }

  async function logout() {
    await signOut(auth);
    setProfile(null);
  }

  // Get fresh ID token for backend API calls
  async function getToken() {
    if (!user) return null;
    return user.getIdToken();
  }

  const value = { user, profile, loading, signup, login, logout, getToken };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
