import { MulticastMessage } from "firebase-admin/messaging";
import {
  DEFAULT_MAX_DEVICES,
  validateMobilePushData,
} from "isomorphic-lib/src/mobilePush";
import { jsonParseSafe } from "isomorphic-lib/src/resultHandling/schemaValidation";
import { MobilePushContents } from "isomorphic-lib/src/types";
import { err, ok, Result } from "neverthrow";

export { DEFAULT_MAX_DEVICES };

export interface DeviceTarget {
  token: string;
  deviceId?: string;
  platform?: string;
}

// FCM registration tokens are ~160 chars today, but the format is not
// contractual. Cap generously; the point is to reject obvious garbage.
const MAX_TOKEN_LENGTH = 4096;

const TOKEN_PROPERTY_NAMES = [
  "deviceToken",
  "token",
  "fcmToken",
  "registrationToken",
] as const;

function isValidToken(s: unknown): s is string {
  return (
    typeof s === "string" &&
    s.length > 0 &&
    s.length <= MAX_TOKEN_LENGTH &&
    !/\s/.test(s)
  );
}

/**
 * Coerces one entry of a device-token user property into a DeviceTarget.
 *
 * Accepts a bare token string, a PerformedMany registration event
 * (`{event, timestamp, properties}`), or a plain object carrying the token
 * fields directly.
 */
function coerceTarget(item: unknown): DeviceTarget | null {
  if (typeof item === "string") {
    return isValidToken(item) ? { token: item } : null;
  }
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const o = item as Record<string, unknown>;
  const src =
    o.properties &&
    typeof o.properties === "object" &&
    !Array.isArray(o.properties)
      ? // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        (o.properties as Record<string, unknown>)
      : o;

  const token = TOKEN_PROPERTY_NAMES.map((n) => src[n]).find(isValidToken);
  if (!token) {
    return null;
  }
  return {
    token,
    deviceId: typeof src.deviceId === "string" ? src.deviceId : undefined,
    platform:
      typeof src.platform === "string" ? src.platform.toLowerCase() : undefined,
  };
}

/**
 * Resolves a user property assignment into the list of devices to notify.
 *
 * Handles three shapes:
 *  - a plain string, from a single-device Trait property
 *  - an array, from a PerformedMany property over device registration events
 *  - a JSON-encoded array, which only the /templates/test endpoint can produce
 *    (it takes user properties straight off the HTTP body; the journey and
 *    broadcast paths both parse assignments before calling us)
 */
export function resolveDeviceTokens(
  raw: unknown,
  { maxDevices = DEFAULT_MAX_DEVICES }: { maxDevices?: number } = {},
): DeviceTarget[] {
  let items: unknown[];
  if (typeof raw === "string") {
    const parsed = jsonParseSafe(raw);
    items = parsed.isOk() && Array.isArray(parsed.value) ? parsed.value : [raw];
  } else if (Array.isArray(raw)) {
    items = raw;
  } else if (raw && typeof raw === "object") {
    items = [raw];
  } else {
    return [];
  }

  // The input is already newest-first: PerformedMany assignments are built with
  // `arraySort(e -> -toInt32(e.2), ...)` in computePropertiesIncremental.ts.
  // Do NOT re-sort by parsing `timestamp` -- it is formatted
  // '%Y-%m-%dT%H:%i:%S' with no timezone suffix, so new Date() would read it as
  // local time and shift it by the host's offset.
  const seenTokens = new Set<string>();
  const seenDeviceIds = new Set<string>();
  const out: DeviceTarget[] = [];

  for (const item of items) {
    if (out.length >= maxDevices) {
      break;
    }
    const target = coerceTarget(item);
    if (!target) {
      continue;
    }
    // Dedupe on both keys, first-wins. deviceId keeps only the newest token per
    // physical device (FCM rotates tokens on reinstall, restore, and roughly
    // every 270 days), while the raw token catches the same token migrating
    // between deviceIds on a device restore.
    if (seenTokens.has(target.token)) {
      continue;
    }
    if (target.deviceId && seenDeviceIds.has(target.deviceId)) {
      continue;
    }
    seenTokens.add(target.token);
    if (target.deviceId) {
      seenDeviceIds.add(target.deviceId);
    }
    out.push(target);
  }
  return out;
}

type RenderedContents = Omit<MobilePushContents, "maxDevices">;

function pruneEmpty<T extends Record<string, unknown>>(
  obj: T,
): Partial<T> | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== "") {
      out[k] = v;
    }
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return Object.keys(out).length > 0 ? (out as Partial<T>) : undefined;
}

/**
 * Maps a rendered template into an FCM message. Pure; performs no I/O.
 *
 * The template's author-facing shape is flattened (e.g. `android.channelId`);
 * this is where it is re-nested into FCM's wire format.
 */
export function toFcmMessage(
  contents: RenderedContents,
): Result<Omit<MulticastMessage, "tokens">, Error> {
  const { title, body, imageUrl, data, apns, android } = contents;

  let parsedData: Record<string, string> | undefined;
  if (data) {
    const validationError = validateMobilePushData(data);
    if (validationError) {
      return err(new Error(validationError));
    }
    // Shape is already guaranteed by validateMobilePushData above.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    parsedData = jsonParseSafe(data).unwrapOr({}) as Record<string, string>;
    if (Object.keys(parsedData).length === 0) {
      parsedData = undefined;
    }
  }

  let badge: number | undefined;
  if (apns?.badge) {
    const parsedBadge = Number.parseInt(apns.badge, 10);
    if (Number.isNaN(parsedBadge) || parsedBadge < 0) {
      return err(
        new Error(
          `apns.badge must render to a non-negative integer, got "${apns.badge}"`,
        ),
      );
    }
    badge = parsedBadge;
  }

  const message: Omit<MulticastMessage, "tokens"> = {};

  const notification = pruneEmpty({ title, body, imageUrl });
  if (notification) {
    message.notification = notification;
  }
  if (parsedData) {
    message.data = parsedData;
  }

  if (android) {
    const androidNotification = pruneEmpty({
      channelId: android.channelId,
      icon: android.icon,
      color: android.color,
      tag: android.tag,
      clickAction: android.clickAction,
    });
    const androidConfig = pruneEmpty({
      collapseKey: android.collapseKey,
      priority: android.priority,
      ttl:
        android.ttlSeconds !== undefined
          ? android.ttlSeconds * 1000
          : undefined,
      notification: androidNotification,
    });
    if (androidConfig) {
      message.android = androidConfig;
    }
  }

  if (apns) {
    const alert = pruneEmpty({ title, subtitle: apns.subtitle, body });
    const aps = pruneEmpty({
      alert,
      badge,
      sound: apns.sound,
      contentAvailable: apns.contentAvailable,
      mutableContent: apns.mutableContent,
      category: apns.category,
      threadId: apns.threadId,
      // No camelCase equivalent in the SDK's Aps type; these go through its
      // index signature as the literal APNs wire keys.
      "interruption-level": apns.interruptionLevel,
    });
    if (aps) {
      message.apns = { payload: { aps } };
    }
  }

  return ok(message);
}

// Flattens the liquid-bearing string fields of a template into the dotted-key
// dictionary renderValues expects, so a liquid error reports a field name like
// "android.channelId".
export function collectMobilePushTemplates(
  definition: RenderedContents,
): Record<string, { contents: string }> {
  const templates: Record<string, { contents: string }> = {};
  const add = (key: string, value: string | undefined) => {
    if (value !== undefined && value !== "") {
      templates[key] = { contents: value };
    }
  };

  add("title", definition.title);
  add("body", definition.body);
  add("imageUrl", definition.imageUrl);
  add("data", definition.data);

  add("android.channelId", definition.android?.channelId);
  add("android.collapseKey", definition.android?.collapseKey);
  add("android.icon", definition.android?.icon);
  add("android.color", definition.android?.color);
  add("android.tag", definition.android?.tag);
  add("android.clickAction", definition.android?.clickAction);

  add("apns.subtitle", definition.apns?.subtitle);
  add("apns.badge", definition.apns?.badge);
  add("apns.sound", definition.apns?.sound);
  add("apns.threadId", definition.apns?.threadId);
  add("apns.category", definition.apns?.category);

  return templates;
}

/**
 * Rebuilds structured contents from renderValues' flat output.
 *
 * Empty strings are dropped, because renderLiquid returns "" (not undefined)
 * for an absent template -- an unpruned `imageUrl: ""` reaches FCM as
 * messaging/invalid-argument.
 */
export function inflateMobilePushTemplates(
  rendered: Record<string, string>,
  definition: RenderedContents,
): RenderedContents {
  const get = (key: string): string | undefined => {
    const value = rendered[key];
    return value !== undefined && value !== "" ? value : undefined;
  };

  const android = pruneEmpty({
    channelId: get("android.channelId"),
    collapseKey: get("android.collapseKey"),
    icon: get("android.icon"),
    color: get("android.color"),
    tag: get("android.tag"),
    clickAction: get("android.clickAction"),
    // Non-string fields are literals, never liquid-rendered.
    priority: definition.android?.priority,
    ttlSeconds: definition.android?.ttlSeconds,
  });

  const apns = pruneEmpty({
    subtitle: get("apns.subtitle"),
    badge: get("apns.badge"),
    sound: get("apns.sound"),
    threadId: get("apns.threadId"),
    category: get("apns.category"),
    contentAvailable: definition.apns?.contentAvailable,
    mutableContent: definition.apns?.mutableContent,
    interruptionLevel: definition.apns?.interruptionLevel,
  });

  return {
    title: get("title"),
    body: get("body"),
    imageUrl: get("imageUrl"),
    data: get("data"),
    identifierKey: definition.identifierKey,
    ...(android ? { android } : {}),
    ...(apns ? { apns } : {}),
  };
}

// FCM error codes meaning the token is permanently dead.
const UNREGISTERED_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

// Retry is worthwhile.
const TRANSIENT_CODES = new Set([
  "messaging/server-unavailable",
  "messaging/internal-error",
  "messaging/quota-exceeded",
  "messaging/message-rate-exceeded",
  "messaging/unavailable",
]);

// The workspace's FCM credential is wrong, or APNs is not configured.
const CONFIG_CODES = new Set([
  "messaging/mismatched-credential",
  "messaging/third-party-auth-error",
  "messaging/authentication-error",
  "app/invalid-credential",
]);

export function isUnregisteredCode(code: string | undefined): boolean {
  return code !== undefined && UNREGISTERED_CODES.has(code);
}

export function isTransientCode(code: string | undefined): boolean {
  return code !== undefined && TRANSIENT_CODES.has(code);
}

export function isConfigCode(code: string | undefined): boolean {
  return code !== undefined && CONFIG_CODES.has(code);
}

// messaging/invalid-argument is overloaded: it fires both for a malformed token
// and for a bad payload. sendEachForMulticast sends an identical payload to
// every token, so a payload problem hits all of them -- only treat it as a dead
// token when at least one other token fared differently.
export function isInvalidArgumentCode(code: string | undefined): boolean {
  return code === "messaging/invalid-argument";
}
