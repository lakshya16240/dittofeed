import { Static, Type } from "@sinclair/typebox";

import { jsonParseSafe } from "./resultHandling/schemaValidation";
import {
  ChannelType,
  MobilePushProviderType,
  MobilePushTemplateResource,
} from "./types";

// The user property seeded by bootstrap that holds device registration events.
export const DEFAULT_DEVICE_TOKEN_IDENTIFIER = "deviceTokens";

// The track event mobile SDKs emit on cold start and on token refresh.
export const DEVICE_REGISTERED_EVENT = "DeviceRegistered";

// Fan out to at most this many of a user's most recently registered devices.
export const DEFAULT_MAX_DEVICES = 10;

export function defaultMobilePushDefinition(): MobilePushTemplateResource {
  return {
    type: ChannelType.MobilePush,
    title: "New message",
    body: "Hi {{ user.firstName | default: 'there' }}, you have an update.",
    identifierKey: DEFAULT_DEVICE_TOKEN_IDENTIFIER,
    android: {
      channelId: "default",
    },
  };
}

// A Google service account key as downloaded from the Firebase console. Lives
// here rather than in backend-lib/destinations/fcm.ts so the dashboard can
// validate a pasted key without pulling firebase-admin into the browser bundle.
export const FcmKey = Type.Object({
  project_id: Type.String(),
  client_email: Type.String(),
  private_key: Type.String(),
});

export type FcmKey = Static<typeof FcmKey>;

export const MobilePushProviderTypeSet = new Set<string>(
  Object.values(MobilePushProviderType),
);

export function isMobilePushProviderType(
  s: unknown,
): s is MobilePushProviderType {
  if (typeof s !== "string") return false;
  return MobilePushProviderTypeSet.has(s);
}

// FCM rejects these outright in the data payload.
const RESERVED_DATA_KEYS = new Set(["from", "notification", "message_type"]);
const RESERVED_DATA_PREFIXES = ["google", "gcm"];

/**
 * Validates a mobile push template's `data` field, which is authored as a JSON
 * object literal. Returns an error message, or null when valid.
 *
 * Run at template upsert rather than at send time so the author sees the
 * problem while they are still looking at the editor.
 */
export function validateMobilePushData(data: string): string | null {
  const parsed = jsonParseSafe(data);
  if (parsed.isErr()) {
    return "Custom data must be valid JSON.";
  }
  const { value } = parsed;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "Custom data must be a JSON object.";
  }
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      return `Custom data value for "${key}" must be a string. FCM only accepts string values.`;
    }
    if (RESERVED_DATA_KEYS.has(key)) {
      return `"${key}" is reserved by FCM and cannot be used as a data key.`;
    }
    const lowered = key.toLowerCase();
    if (RESERVED_DATA_PREFIXES.some((p) => lowered.startsWith(p))) {
      return `Data keys may not start with "google" or "gcm" — "${key}" is reserved by FCM.`;
    }
  }
  return null;
}
