import { headers } from 'next/headers';

/** Hosted Sites Dispatch supplies this identity; no email or profile is collected. */
export async function getChatGPTUser(): Promise<{ userId: string } | null> {
  const userId = (await headers()).get('oai-authenticated-user-id');
  return userId ? { userId } : null;
}
