import axios, { AxiosError } from "axios";
import { InteraktAccount, InteraktSecret } from "isomorphic-lib/src/types";
import { err, ok, Result } from "neverthrow";

import { InteraktPayload } from "../messaging/whatsApp";

const INTERAKT_MESSAGE_URL = "https://api.interakt.ai/v1/public/message/";

// Interakt is a synchronous enqueue, not a delivery wait, so it should answer
// quickly. Without a timeout a hung provider would pin a Temporal activity
// slot until the activity's own 2-minute ceiling.
const REQUEST_TIMEOUT_MS = 15_000;

export interface InteraktResult {
  status: number;
  body: unknown;
}

export class MissingInteraktKeyError extends Error {
  readonly account: InteraktAccount;

  constructor(account: InteraktAccount) {
    super(
      `No Interakt ${account} key is configured for this workspace. Add it ` +
        `under Settings, or switch the template to an account that is ` +
        `configured.`,
    );
    this.name = "MissingInteraktKeyError";
    this.account = account;
  }
}

export function selectInteraktKey({
  secret,
  account,
}: {
  secret: InteraktSecret;
  account: InteraktAccount;
}): Result<string, MissingInteraktKeyError> {
  const key =
    account === InteraktAccount.Support
      ? secret.supportKey
      : secret.campaignKey;
  if (!key) {
    return err(new MissingInteraktKeyError(account));
  }
  return ok(key);
}

/**
 * Posts one template message to Interakt.
 *
 * Resolves `ok` for any answered request, including a 4xx -- interpreting the
 * response is the caller's job, because Interakt also signals failure inside
 * a 200 body. Only a transport-level problem resolves `err` with no status.
 */
export async function sendInteraktTemplate({
  key,
  payload,
}: {
  // The pre-encoded Basic key, exactly as issued by Interakt.
  key: string;
  payload: InteraktPayload;
}): Promise<Result<InteraktResult, Error>> {
  try {
    // Typed as unknown, not any: the provider's body shape is not
    // contractual and every reader below narrows it explicitly.
    const response = await axios.request<unknown>({
      url: INTERAKT_MESSAGE_URL,
      method: "POST",
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${key}`,
      },
      data: payload,
      // Interpret the status ourselves rather than having axios throw, so a
      // 4xx body (which carries the provider's reason) is not discarded.
      validateStatus: () => true,
    });
    return ok({ status: response.status, body: response.data });
  } catch (e) {
    if (e instanceof AxiosError && e.response) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const body: unknown = e.response.data;
      return ok({ status: e.response.status, body });
    }
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return err(e as Error);
  }
}
