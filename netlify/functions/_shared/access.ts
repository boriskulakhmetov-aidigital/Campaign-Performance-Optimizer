import { checkAccess, recordUsage, getUserOrgId } from '@boriskulakhmetov-aidigital/design-system/access';
import { logTokenUsage, detectSource } from '@boriskulakhmetov-aidigital/design-system/logger';
import type { AccessSource } from '@boriskulakhmetov-aidigital/design-system/logger';
import { supabase } from './supabase.js';

export async function enforceAccess(userId: string, app: string) {
  return await checkAccess(supabase as any, userId, app);
}

export async function trackUsage(userId: string, app: string) {
  const orgId = await getUserOrgId(supabase as any, userId);
  await recordUsage(supabase as any, userId, orgId, app);
}

export async function trackTokens(
  userId: string | undefined,
  app: string,
  aiProvider: string,
  aiModel: string,
  inputTokens: number,
  outputTokens: number,
  totalTokens: number,
) {
  if (!userId || totalTokens === 0) return;
  const orgId = await getUserOrgId(supabase as any, userId);
  const source: AccessSource = detectSource(userId);
  await logTokenUsage(supabase as any, {
    userId, orgId, app, source, aiProvider, aiModel, inputTokens, outputTokens, totalTokens,
  });
}
