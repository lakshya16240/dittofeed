import { createHash } from "crypto";
import {
  App,
  cert,
  deleteApp,
  getApps,
  initializeApp,
  ServiceAccount,
} from "firebase-admin/app";
import {
  BatchResponse,
  getMessaging,
  Messaging,
  MulticastMessage,
} from "firebase-admin/messaging";
import { FcmKey } from "isomorphic-lib/src/mobilePush";
import {
  jsonParseSafe,
  schemaValidateWithErr,
} from "isomorphic-lib/src/resultHandling/schemaValidation";
import { err, ok, Result } from "neverthrow";

import logger from "../logger";

export { FcmKey };

export function toServiceAccount(key: {
  project_id: string;
  client_email: string;
  private_key: string;
}): ServiceAccount {
  return {
    projectId: key.project_id,
    clientEmail: key.client_email,
    // Service account keys pasted through a JSON or env round-trip arrive with
    // literal two-character "\n" sequences, and cert() then fails with
    // `error:1E08010C:DECODER routines::unsupported`.
    privateKey: key.private_key.replace(/\\n/g, "\n"),
  };
}

export function extractServiceAccount(
  fcmKeyString: string,
): Result<ServiceAccount, Error> {
  return jsonParseSafe(fcmKeyString)
    .andThen((parsed) => schemaValidateWithErr(parsed, FcmKey))
    .map(toServiceAccount);
}

interface CachedApp {
  app: App;
  messaging: Messaging;
  fingerprint: string;
}

const APP_CACHE = new Map<string, CachedApp>();

function fingerprint(sa: ServiceAccount): string {
  return createHash("sha256")
    .update(
      [sa.projectId ?? "", sa.clientEmail ?? "", sa.privateKey ?? ""].join(":"),
    )
    .digest("hex")
    .slice(0, 16);
}

/**
 * Resolves a Messaging client for a workspace, initializing the underlying
 * firebase-admin App at most once per credential.
 *
 * Always uses a *named* app: a second initializeApp() with no name throws
 * `app/duplicate-app`.
 */
function getFcmMessaging(workspaceId: string, sa: ServiceAccount): Messaging {
  const fp = fingerprint(sa);
  const cached = APP_CACHE.get(workspaceId);
  if (cached) {
    if (cached.fingerprint === fp) {
      return cached.messaging;
    }
    // The credential was rotated. Tear the old app down, or it leaks both the
    // App and its background token refresher.
    APP_CACHE.delete(workspaceId);
    void deleteApp(cached.app).catch((e: unknown) => {
      logger().warn(
        { err: e, workspaceId },
        "failed to delete stale fcm app after credential rotation",
      );
    });
  }

  // The fingerprint is part of the name so a rotation cannot collide with an
  // app that is still being torn down.
  const name = `df-fcm-${workspaceId}-${fp}`;
  // getApp() throws when the app is absent; getApps() does not.
  const existing = getApps().find((a) => a.name === name);
  const app = existing ?? initializeApp({ credential: cert(sa) }, name);
  const messaging = getMessaging(app);
  APP_CACHE.set(workspaceId, { app, messaging, fingerprint: fp });
  return messaging;
}

/**
 * Sends one notification to many device tokens.
 *
 * `responses[i]` maps positionally to `tokens[i]`.
 */
export async function sendFcmMulticast({
  workspaceId,
  key,
  tokens,
  message,
}: {
  workspaceId: string;
  // The raw service account JSON, as stored in the fcm-key secret.
  key: string;
  tokens: string[];
  message: Omit<MulticastMessage, "tokens">;
}): Promise<Result<BatchResponse, Error>> {
  const serviceAccount = extractServiceAccount(key);
  if (serviceAccount.isErr()) {
    return err(serviceAccount.error);
  }
  let messaging: Messaging;
  try {
    messaging = getFcmMessaging(workspaceId, serviceAccount.value);
  } catch (e) {
    // Malformed private key / unusable credential.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return err(e as Error);
  }
  try {
    // sendEachForMulticast issues one HTTP request per token in parallel.
    // Do NOT switch to sendMulticast/sendAll: those route through the FCM
    // /batch endpoint, which Google retired in 2024 and which is gone in
    // firebase-admin v13.
    return ok(await messaging.sendEachForMulticast({ ...message, tokens }));
  } catch (e) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return err(e as Error);
  }
}
