import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

/* Minimal auth hook - the temporary stand-in for Entra ID SSO. Tracks the
   Supabase auth session and the matching `profiles` row (role/lab group).
   session === undefined means "still checking"; null means "signed out".
   profileError is set if the profile couldn't be loaded (e.g. offline), so
   the app can say so instead of quietly treating an admin as a visitor. */
export function useSession() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [profileFor, setProfileFor] = useState(null); // user id the profile was loaded for
  const [profileError, setProfileError] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess ?? null);
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
  }, [userId]);

  const authLoading = session === undefined || (!!userId && profileFor !== userId);
  return { session, profile, profileError, authLoading };
}
