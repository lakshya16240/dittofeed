import { jsonParseSafe } from "isomorphic-lib/src/resultHandling/schemaValidation";
import { InteraktAccount, WhatsAppContents } from "isomorphic-lib/src/types";
import {
  DEFAULT_INTERAKT_ACCOUNT,
  splitE164,
} from "isomorphic-lib/src/whatsApp";
import { err, ok, Result } from "neverthrow";

type RenderedContents = WhatsAppContents;

/**
 * Interakt's template-send payload. Not Meta's raw `components[]` shape --
 * Interakt wraps it with positional value arrays.
 */
export interface InteraktPayload {
  countryCode: string;
  phoneNumber: string;
  callbackData: string;
  type: "Template";
  template: {
    name: string;
    languageCode: string;
    headerValues?: string[];
    bodyValues?: string[];
    buttonValues?: Record<string, string[]>;
  };
}

// Flattens the liquid-bearing fields of a template into the dotted-key
// dictionary renderValues expects, so a liquid error reports a field name like
// "bodyValues.1".
//
// Positional arrays are flattened by index rather than joined, which is the
// whole point of this channel: each parameter gets its own render pass, so a
// value containing a quote or a newline cannot break the payload structure or
// bleed into the neighbouring slot.
export function collectWhatsAppTemplates(
  definition: RenderedContents,
): Record<string, { contents: string }> {
  const templates: Record<string, { contents: string }> = {};
  const add = (key: string, value: string | undefined) => {
    if (value !== undefined && value !== "") {
      templates[key] = { contents: value };
    }
  };

  definition.headerValues?.forEach((v, i) => add(`headerValues.${i}`, v));
  definition.bodyValues?.forEach((v, i) => add(`bodyValues.${i}`, v));
  add("buttonValues", definition.buttonValues);

  return templates;
}

/**
 * Rebuilds structured contents from renderValues' flat output.
 *
 * Unlike the mobile-push equivalent this must NOT drop empty values from the
 * positional arrays: dropping element 1 would slide element 2 into its place
 * and deliver the wrong data into the wrong template placeholder. Positions
 * are preserved here and the empty value is rejected in toInteraktPayload,
 * where it can produce a message naming the offending index.
 */
export function inflateWhatsAppTemplates(
  rendered: Record<string, string>,
  definition: RenderedContents,
): RenderedContents {
  const inflateArray = (
    prefix: string,
    source: string[] | undefined,
  ): string[] | undefined => {
    if (!source) {
      return undefined;
    }
    return source.map((original, i) => {
      const value = rendered[`${prefix}.${i}`];
      // An entry that was a literal empty string in the template was never
      // added to the render dictionary, so fall back to the original.
      return value !== undefined ? value : original;
    });
  };

  const { buttonValues } = rendered;

  return {
    // Not liquid-rendered: these select the provider template, and templating
    // them would let a bad user property silently send a different template.
    templateName: definition.templateName,
    languageCode: definition.languageCode,
    account: definition.account,
    identifierKey: definition.identifierKey,
    ...(definition.headerValues
      ? { headerValues: inflateArray("headerValues", definition.headerValues) }
      : {}),
    ...(definition.bodyValues
      ? { bodyValues: inflateArray("bodyValues", definition.bodyValues) }
      : {}),
    ...(buttonValues !== undefined && buttonValues !== ""
      ? { buttonValues }
      : {}),
  };
}

function parseButtonValues(
  raw: string,
): Result<Record<string, string[]>, Error> {
  const parsed = jsonParseSafe(raw);
  if (parsed.isErr()) {
    return err(new Error("Button values did not render to valid JSON."));
  }
  const { value } = parsed;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return err(
      new Error("Button values must render to a JSON object keyed by index."),
    );
  }
  const out: Record<string, string[]> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!Array.isArray(entry) || entry.some((i) => typeof i !== "string")) {
      return err(
        new Error(
          `Button values for index "${key}" must be an array of strings.`,
        ),
      );
    }
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    out[key] = entry as string[];
  }
  return ok(out);
}

export function resolveInteraktAccount(
  contents: RenderedContents,
): InteraktAccount {
  return contents.account ?? DEFAULT_INTERAKT_ACCOUNT;
}

/**
 * Builds the Interakt request body from rendered contents and a recipient.
 *
 * Pure and I/O free, so the whole mapping is unit-testable without a network
 * or a provider account.
 */
export function toInteraktPayload({
  contents,
  identifier,
  messageId,
}: {
  contents: RenderedContents;
  identifier: string;
  messageId: string;
}): Result<InteraktPayload, Error> {
  const split = splitE164(identifier);
  if (!split) {
    return err(
      new Error(
        `"${identifier}" is not a supported E.164 phone number. Expected a ` +
          `number like "+919876543210".`,
      ),
    );
  }

  if (!contents.templateName) {
    return err(new Error("A WhatsApp template name is required."));
  }

  // WhatsApp template placeholders are all mandatory, and the provider
  // rejects a blank one. Fail here instead, naming the index, so the author
  // learns which parameter resolved to nothing rather than reading a generic
  // provider error.
  const checkPositional = (
    label: string,
    values: string[] | undefined,
  ): Error | null => {
    if (!values) {
      return null;
    }
    const emptyAt = values.findIndex((v) => v.trim() === "");
    if (emptyAt !== -1) {
      return new Error(
        `${label} parameter ${emptyAt + 1} rendered empty. WhatsApp rejects ` +
          `blank template parameters -- check the user property it reads.`,
      );
    }
    return null;
  };

  const headerErr = checkPositional("Header", contents.headerValues);
  if (headerErr) {
    return err(headerErr);
  }
  const bodyErr = checkPositional("Body", contents.bodyValues);
  if (bodyErr) {
    return err(bodyErr);
  }

  let buttonValues: Record<string, string[]> | undefined;
  if (contents.buttonValues) {
    const parsed = parseButtonValues(contents.buttonValues);
    if (parsed.isErr()) {
      return err(parsed.error);
    }
    buttonValues = parsed.value;
  }

  return ok({
    countryCode: split.countryCode,
    phoneNumber: split.phoneNumber,
    // Echoed back verbatim on the provider's delivery webhook. The "df:"
    // prefix is what lets the receiving side forward only the messages
    // Dittofeed sent, leaving legacy traffic alone.
    callbackData: `df:${messageId}`,
    type: "Template",
    template: {
      name: contents.templateName,
      languageCode: contents.languageCode,
      ...(contents.headerValues?.length
        ? { headerValues: contents.headerValues }
        : {}),
      ...(contents.bodyValues?.length
        ? { bodyValues: contents.bodyValues }
        : {}),
      ...(buttonValues ? { buttonValues } : {}),
    },
  });
}

/**
 * Interakt answers 200 with a body carrying its own result flag, so HTTP
 * status alone cannot tell success from failure. Recording a rejected message
 * as sent is the worst outcome here -- it inflates the campaign report and
 * hides a broken template -- so treat anything that is not an explicit
 * success as a failure.
 */
export function isInteraktSuccessBody(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const o = body as Record<string, unknown>;
  if (typeof o.result === "boolean") {
    return o.result;
  }
  // Some responses omit `result` and carry only an id.
  return typeof o.id === "string" && o.id.length > 0;
}

export function extractInteraktMessageId(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const o = body as Record<string, unknown>;
  if (typeof o.id === "string" && o.id.length > 0) {
    return o.id;
  }
  if (typeof o.message_id === "string" && o.message_id.length > 0) {
    return o.message_id;
  }
  return undefined;
}

export function extractInteraktErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const o = body as Record<string, unknown>;
  if (typeof o.message === "string" && o.message.length > 0) {
    return o.message;
  }
  if (o.error && typeof o.error === "object" && !Array.isArray(o.error)) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const e = o.error as Record<string, unknown>;
    if (typeof e.message === "string" && e.message.length > 0) {
      return e.message;
    }
  }
  return undefined;
}

/**
 * HTTP statuses worth retrying. A 429 or 5xx is the provider asking us to
 * back off; everything else is a permanent problem with the request.
 */
export function isTransientStatus(status: number | undefined): boolean {
  if (status === undefined) {
    // No response at all -- a transport error, which is worth one retry.
    return true;
  }
  return status === 429 || status >= 500;
}

export function isAuthStatus(status: number | undefined): boolean {
  return status === 401 || status === 403;
}
