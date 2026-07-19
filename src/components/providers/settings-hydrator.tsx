'use client';

import { useEffect } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { useSettingsStore } from '@/stores/settings-store';
import { useRuntimeConfig } from './runtime-config-provider';

/** Load tenant-scoped settings only after the active identity is known. */
export function SettingsHydrator() {
  const { authEnabled } = useRuntimeConfig();
  const { isAuthenticated, isLoading } = useAuth();
  const hydrate = useSettingsStore((state) => state.hydrate);
  const hydrated = useSettingsStore((state) => state._hydrated);

  useEffect(() => {
    if (hydrated || isLoading) return;
    if (authEnabled && !isAuthenticated) return;
    void hydrate();
  }, [authEnabled, hydrate, hydrated, isAuthenticated, isLoading]);

  return null;
}
