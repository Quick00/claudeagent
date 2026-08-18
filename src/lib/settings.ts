import { prisma } from '@/lib/prisma';

/**
 * Admin-toggleable settings, stored as key/value rows in AppSetting so they can
 * be changed from the UI without a redeploy.
 */
export const SETTING_KEYS = {
  requireUserApproval: 'requireUserApproval',
} as const;

async function getBooleanSetting(key: string): Promise<boolean> {
  const setting = await prisma.appSetting.findUnique({ where: { key } });
  return setting?.value === 'true';
}

async function setBooleanSetting(key: string, enabled: boolean): Promise<void> {
  const value = enabled ? 'true' : 'false';
  await prisma.appSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

/** Whether new accounts need an admin to approve them. Defaults to off. */
export function getRequireUserApproval(): Promise<boolean> {
  return getBooleanSetting(SETTING_KEYS.requireUserApproval);
}

export function setRequireUserApproval(enabled: boolean): Promise<void> {
  return setBooleanSetting(SETTING_KEYS.requireUserApproval, enabled);
}
