// Seam 10 (account) — WHO IS SIGNED IN. Phase 06a, ruling R25.
//
// The server decides (GET /api/auth/me, behind the session cookie). This context only carries the
// answer down so the Account page and the header do not each ask again. There are no roles beyond
// "owner or not" — the user: "No RBAC, just different account for now".
import { createContext, useContext } from 'react';

export interface SignedInAccount {
  id: number;
  username: string;
  displayName: string;
  isOwner: boolean;
  /** 23-09-26: which 9router combos this account's AI calls use. The SERVER decides per request. */
  claudeAccess?: boolean;
}

export const AccountContext = createContext<SignedInAccount | null>(null);

export function useAccount(): SignedInAccount {
  const value = useContext(AccountContext);
  if (!value) throw new Error('useAccount must be used inside <AccountContext.Provider>');
  return value;
}
