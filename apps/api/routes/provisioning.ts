import { ok, error } from '../lib/types';
import type { Env } from '../lib/types';
import { getProvisioningStatus } from '../lib/provisioning-orchestrator';

export async function handleGetProvisioningStatus(
  _req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  try {
    const status = await getProvisioningStatus(env.PLATFORM_CONTEXT!.db, userId);
    return ok(status);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to get provisioning status';
    return error(message, 500);
  }
}
