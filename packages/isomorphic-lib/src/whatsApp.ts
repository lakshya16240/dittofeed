import { jsonParseSafe } from "./resultHandling/schemaValidation";
import {
  ChannelType,
  InteraktAccount,
  WhatsAppProviderType,
  WhatsAppTemplateResource,
} from "./types";

// The user property holding the recipient's phone number in E.164 form.
export const DEFAULT_WHATSAPP_IDENTIFIER = "phone";

// Marketing traffic defaults to the campaign account. Sending marketing
// content on the transactional key is what degrades a number's quality rating.
export const DEFAULT_INTERAKT_ACCOUNT = InteraktAccount.Campaign;

export function defaultWhatsAppDefinition(): WhatsAppTemplateResource {
  return {
    type: ChannelType.WhatsApp,
    templateName: "",
    languageCode: "en",
    account: DEFAULT_INTERAKT_ACCOUNT,
    bodyValues: [],
    identifierKey: DEFAULT_WHATSAPP_IDENTIFIER,
  };
}

export const WhatsAppProviderTypeSet = new Set<string>(
  Object.values(WhatsAppProviderType),
);

export function isWhatsAppProviderType(
  s: unknown,
): s is WhatsAppProviderType {
  if (typeof s !== "string") return false;
  return WhatsAppProviderTypeSet.has(s);
}

/**
 * Country codes we can split an E.164 number on, longest first so that a
 * longer code is never shadowed by a shorter one that prefixes it.
 *
 * Deliberately a fixed list rather than a guess: splitting E.164 correctly in
 * general needs a full numbering-plan database, and silently mis-splitting a
 * number means delivering to the wrong person. Anything not listed fails the
 * send loudly instead. Add codes here as new markets come online.
 */
const COUNTRY_CODES = [
  "971", // UAE
  "977", // Nepal
  "880", // Bangladesh
  "94", // Sri Lanka
  "91", // India
  "65", // Singapore
  "61", // Australia
  "44", // UK
  "1", // US / Canada
].sort((a, b) => b.length - a.length);

export interface SplitPhoneNumber {
  countryCode: string;
  phoneNumber: string;
}

/**
 * Splits "+919876543210" into { countryCode: "+91", phoneNumber: "9876543210" }.
 *
 * Returns null when the input is not a recognisable E.164 number for a
 * supported country code, so callers can fail the send rather than guess.
 */
export function splitE164(raw: string): SplitPhoneNumber | null {
  const trimmed = raw.trim().replace(/[\s()-]/g, "");
  if (!trimmed.startsWith("+")) {
    return null;
  }
  const digits = trimmed.slice(1);
  if (!/^\d{7,15}$/.test(digits)) {
    return null;
  }
  const code = COUNTRY_CODES.find((c) => digits.startsWith(c));
  if (!code) {
    return null;
  }
  const rest = digits.slice(code.length);
  // A national number shorter than this is not a real subscriber number, and
  // usually means the country code was matched against the wrong prefix.
  if (rest.length < 6) {
    return null;
  }
  return { countryCode: `+${code}`, phoneNumber: rest };
}

/**
 * Validates a WhatsApp template's `buttonValues` field, authored as a JSON
 * object literal keyed by button index.
 *
 * Run at template upsert rather than at send time so the author sees the
 * problem while they are still looking at the editor.
 */
export function validateWhatsAppButtonValues(
  buttonValues: string,
): string | null {
  const parsed = jsonParseSafe(buttonValues);
  if (parsed.isErr()) {
    return "Button values must be valid JSON.";
  }
  const { value } = parsed;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "Button values must be a JSON object keyed by button index.";
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!/^\d+$/.test(key)) {
      return `Button index "${key}" must be a number, e.g. "0".`;
    }
    if (!Array.isArray(entry)) {
      return `Button values for index "${key}" must be an array of strings.`;
    }
    for (const item of entry) {
      if (typeof item !== "string") {
        return `Button values for index "${key}" must all be strings.`;
      }
    }
  }
  return null;
}
