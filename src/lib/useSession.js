import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

/* Minimal auth hook — the temporary stand-in for Entra ID SSO. Tracks the
   Supabase auth session and the matching `profiles` row (role/lab group).
   session === undefined means "still checking"; null means "signed out". */
export function useSession() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!session) {
      setProfile(null);
      return;
    }
    setProfileLoading(true);
    supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => {
        if (cancelled) return;
        setProfile(data || null);
        setProfileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const authLoading = session === undefined || (!!session && profileLoading);
  return { session, profile, authLoading };
}
