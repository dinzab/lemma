"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { User } from "@supabase/supabase-js";

type UserContextType = {
  user: User | null;
  loading: boolean;
  userDetails: {
    fullName: string | null;
    avatarUrl: string | null;
    email: string | null;
  } | null;
};

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userDetails, setUserDetails] = useState<UserContextType["userDetails"]>(null);

  useEffect(() => {
    const supabase = createClient();

    async function getUser() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        setUser(user);

        if (user) {
          // Try to get avatar from OAuth provider first (e.g., Google)
          let avatarUrl = user.user_metadata?.avatar_url || null;
          
          // If no avatar in user_metadata, check identities for OAuth providers
          if (!avatarUrl && user.identities && user.identities.length > 0) {
            const oauthIdentity = user.identities.find(identity => 
              identity.provider !== 'email'
            );
            
            if (oauthIdentity?.identity_data) {
              // Google OAuth uses 'picture' or 'avatar_url'
              avatarUrl = oauthIdentity.identity_data.picture || 
                          oauthIdentity.identity_data.avatar_url || 
                          null;
            }
          }

          setUserDetails({
            fullName: user.user_metadata?.full_name || user.user_metadata?.name || null,
            avatarUrl,
            email: user.email || null,
          });
        }
      } catch (error) {
        console.error("Error fetching user:", error);
      } finally {
        setLoading(false);
      }
    }

    getUser();
  }, []);

  return (
    <UserContext.Provider value={{ user, loading, userDetails }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
}
