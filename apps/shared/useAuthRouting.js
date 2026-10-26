// Moves people when their sign-in state changes: log out → log in screen, log in or sign up → home.
// Stack.Protected hides the screens people can't use, but when it has to move someone it picks a screen by
// route order (in SDK 58 that can be "apply" or "forgot-password"). This makes the destination explicit.
import { useEffect, useRef } from "react";
import { useRouter, useSegments } from "expo-router";

export function useAuthRouting(status, { signInRoute = "sign-in", homeRoute = "home", publicRoutes = [] } = {}) {
  const segments = useSegments();
  const router = useRouter();
  const current = segments[0] || "index";
  const last = useRef("loading");

  useEffect(() => {
    if (status === "loading") return;
    const changed = last.current !== status;
    last.current = status;
    if (current === "index") return; // "/" redirects on its own.
    const onPublic = current === signInRoute || publicRoutes.includes(current);
    if (status === "signedOut" && ((changed && current !== signInRoute) || !onPublic)) router.replace(`/${signInRoute}`);
    // Signed in: only move people off the sign-in screens. Anywhere else (a job, a link from a notification) stays put.
    else if (status === "signedIn" && onPublic) router.replace(`/${homeRoute}`);
  }, [status, current, signInRoute, homeRoute, publicRoutes, router]);
}
