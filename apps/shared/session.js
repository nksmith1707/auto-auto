// Who is signed in, kept in one place. Both apps wrap their screens in <AuthProvider>.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "./api";
import { storage } from "./storage";

const AuthContext = createContext(null);

export function AuthProvider({ api, role, wrongAppMessage, children }) {
  const key = `aa.${role}.session`;
  const [state, setState] = useState({ status: "loading", user: null, token: null, offline: false });
  const tokenRef = useRef(null);

  const save = useCallback(async ({ token, user }) => {
    tokenRef.current = token;
    await storage.set(key, JSON.stringify({ token, user }));
    setState({ status: "signedIn", user, token, offline: false });
  }, [key]);

  const clear = useCallback(async () => {
    tokenRef.current = null;
    try { await storage.remove(key); } catch {}
    setState({ status: "signedOut", user: null, token: null, offline: false });
  }, [key]);

  // On launch: pick up a saved session and check it's still good.
  useEffect(() => {
    let alive = true;
    (async () => {
      let saved = null;
      try { saved = JSON.parse((await storage.get(key)) || "null"); } catch {}
      if (!saved || !saved.token) return alive && clear();
      tokenRef.current = saved.token;
      try {
        const { user } = await api.me(saved.token);
        if (alive) await save({ token: saved.token, user });
      } catch (e) {
        if (!alive) return;
        // Signed out elsewhere or expired: start fresh. No connection: keep the saved account so the app still opens.
        if (e instanceof ApiError && e.status === 401) return clear();
        setState({ status: "signedIn", user: saved.user, token: saved.token, offline: true });
      }
    })();
    return () => { alive = false; };
  }, [api, key, save, clear]);

  const signIn = useCallback(async ({ email, password }) => {
    const out = await api.login({ email, password });
    if (out.user.role !== role) {
      await api.logout(out.token).catch(() => {});
      throw new ApiError({ status: 403, code: "wrong_app", message: wrongAppMessage });
    }
    await save(out);
    return out.user;
  }, [api, role, wrongAppMessage, save]);

  const signUp = useCallback(async (input) => {
    const out = await api.signup({ ...input, role });
    await save(out);
    return out.user;
  }, [api, role, save]);

  // Signing out always works on this phone, even with no connection. The server session expires on its own.
  const signOut = useCallback(async () => {
    const token = tokenRef.current;
    await clear();
    if (token) await api.logout(token).catch(() => {});
  }, [api, clear]);

  // Signing out everywhere has to reach the server, so errors are shown.
  const signOutEverywhere = useCallback(async () => {
    try {
      await api.logoutAll(tokenRef.current);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) throw e;
    }
    await clear();
  }, [api, clear]);

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.me(tokenRef.current);
      await save({ token: tokenRef.current, user });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return clear();
      throw e;
    }
  }, [api, save, clear]);

  const value = useMemo(() => ({
    ...state, api, signIn, signUp, signOut, signOutEverywhere, refresh,
    requestReset: (email) => api.requestReset(email),
    confirmReset: (input) => api.confirmReset(input),
  }), [state, api, signIn, signUp, signOut, signOutEverywhere, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>.");
  return v;
}
