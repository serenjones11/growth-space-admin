import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

/* Minimal auth hook - the temporary stand-in for Entra ID SSO. Tracks the
   Supabase auth session and the matching `profiles` row (role/lab group).
   session === undefined means "still checking"; null means "signed out".
   profileError is set if the profile couldn't be loaded (e.g. offline), so
   the app can say so instead of quietly treating an admin as a visitor.
   recovering is true after opening a "Reset your password" email link
   (Supabase signs the user in and fires PASSWORD_RECOVERY), until they've
   set a new password - see SetNewPasswordScreen in App.jsx. */
export function useSession() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [profileFor, setProfileFor] = useState(null); // user id the profile was loaded for
  const [profileError, setProfileError] = useState(null);
  const [profileVersion, setProfileVersion] = useState(0); // bump to re-read the profile
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      setSession(sess ?? null);
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      if (event === "SIGNED_OUT") setRecovering(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Keyed on the user id, not the session object: Supabase hands out a new
  // session object on every token refresh (about hourly), and refetching -
  // with the loading screen that implies - would unmount the whole admin
  // app and throw away whatever form or modal was open.
  const userId = session?.user?.id ?? null;
  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setProfile(null);
      setProfileError(null);
      setProfileFor(null);
      return;
    }
    supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return;
        setProfile(data || null);
        setProfileError(error ? error.message : null);
        setProfileFor(userId);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, profileVersion]);

  const authLoading = session === undefined || (!!userId && profileFor !== userId);
  // After the user edits their own profile (e.g. their name on Settings).
  const reloadProfile = () => setProfileVersion((v) => v + 1);
  const finishRecovery = () => setRecovering(false);
  return { session, profile, profileError, authLoading, reloadProfile, recovering, finishRecovery };
}
