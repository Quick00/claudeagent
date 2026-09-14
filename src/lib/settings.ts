import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';

/**
 * Admin-toggleable settings, stored as key/value rows in AppSetting so they can
 * be changed from the UI without a redeploy.
 */
export const SETTING_KEYS = {
  requireUserApproval: 'requireUserApproval',
  knowledgeIgnorePatterns: 'knowledgeIgnorePatterns',
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

export interface IgnoreLists {
  segments: string[];
  basenames: string[];
}

/**
 * Parses admin-edited ignore patterns: one pattern per line, a trailing "/"
 * marks a directory segment, anything else is a basename. Blank lines and
 * lines starting with "#" are skipped. This input is untrusted (edited by an
 * admin in a textarea) but only ever produces plain strings compared with
 * `===`/`.includes()` downstream — never a regex or shell argument — so
 * there is nothing here to escape; malformed lines are simply skipped.
 */
export function parseIgnorePatterns(text: string): IgnoreLists {
  const segments: string[] = [];
  const basenames: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.endsWith('/')) segments.push(line.slice(0, -1).toLowerCase());
    else basenames.push(line);
  }
  return { segments, basenames };
}

/** The hardcoded defaults, rendered as editable pattern text. */
export function defaultIgnorePatternsText(): string {
  return [
    ...config.knowledgeIgnoreSegments.map((s) => `${s}/`),
    ...config.knowledgeIgnoreBasenames,
  ].join('\n');
}

/**
 * Raw admin-edited text, or the config defaults when nothing has been saved
 * (or the saved value is blank/whitespace-only — an admin clearing the
 * textarea should restore default behaviour, not silently ignore nothing).
 */
export async function getKnowledgeIgnorePatternsText(): Promise<string> {
  const setting = await prisma.appSetting.findUnique({ where: { key: SETTING_KEYS.knowledgeIgnorePatterns } });
  return setting?.value?.trim() ? setting.value : defaultIgnorePatternsText();
}

export async function setKnowledgeIgnorePatternsText(text: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: SETTING_KEYS.knowledgeIgnorePatterns },
    update: { value: text },
    create: { key: SETTING_KEYS.knowledgeIgnorePatterns, value: text },
  });
}

/** Parsed ignore lists used by the provenance collector. */
export async function getKnowledgeIgnoreLists(): Promise<IgnoreLists> {
  return parseIgnorePatterns(await getKnowledgeIgnorePatternsText());
}
