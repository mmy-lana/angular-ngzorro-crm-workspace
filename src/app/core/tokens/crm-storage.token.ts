import { InjectionToken } from '@angular/core';

/** Durable keys. Values written under these keys survive a browser restart. */
export const CRM_STORAGE_KEYS = {
  SCHEMA_VERSION: 'ng_crm_schema_version',
  ACCOUNTS: 'ng_crm_accounts_v1',
  CONTACTS: 'ng_crm_contacts_v1',
  OPPORTUNITIES: 'ng_crm_opportunities_v1',
  ACTIVITIES: 'ng_crm_activities_v1',
  /**
   * Deletion record. An id listed here is dead: replication must never
   * reintroduce it, however many stale copies of the row are still in flight.
   */
  TOMBSTONES: 'ng_crm_tombstones_v1'
} as const;

/**
 * The only keys a cross-window envelope may write.
 *
 * A `BroadcastChannel` message is untrusted input from another browsing context.
 * Without this allowlist, any same-origin script could ask this window to
 * overwrite the schema marker or the tab session, and an unknown key would be
 * persisted to disk without ever passing through a sanitiser.
 */
export const SYNCABLE_STORAGE_KEYS: readonly string[] = [
  CRM_STORAGE_KEYS.ACCOUNTS,
  CRM_STORAGE_KEYS.CONTACTS,
  CRM_STORAGE_KEYS.OPPORTUNITIES,
  CRM_STORAGE_KEYS.ACTIVITIES,
  CRM_STORAGE_KEYS.TOMBSTONES
];

/** Session keys. Workspace tabs are intentionally not durable across restarts. */
export const WORKSPACE_SESSION_KEYS = {
  WORKSPACE_TABS: 'ng_crm_session_tabs_v1',
  ACTIVE_TAB_ID: 'ng_crm_session_active_tab_v1'
} as const;

export const LOCAL_STORAGE = new InjectionToken<Storage | null>('LOCAL_STORAGE', {
  providedIn: 'root',
  factory: () => {
    try {
      return typeof window !== 'undefined' ? window.localStorage : null;
    } catch {
      // Safari private mode and hardened enterprise profiles throw on access.
      return null;
    }
  }
});

export const SESSION_STORAGE = new InjectionToken<Storage | null>('SESSION_STORAGE', {
  providedIn: 'root',
  factory: () => {
    try {
      return typeof window !== 'undefined' ? window.sessionStorage : null;
    } catch {
      return null;
    }
  }
});
