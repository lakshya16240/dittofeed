import { unwrap } from "isomorphic-lib/src/resultHandling/resultUtils";
import { schemaValidateWithErr } from "isomorphic-lib/src/resultHandling/schemaValidation";
import {
  ChannelType,
  InteraktAccount,
  InternalEventType,
  SearchDeliveriesResponseItem,
  WhatsAppContents,
  WhatsAppProviderType,
} from "isomorphic-lib/src/types";
import { splitE164 } from "isomorphic-lib/src/whatsApp";
import { Result } from "neverthrow";

import {
  collectWhatsAppTemplates,
  extractInteraktErrorMessage,
  extractInteraktMessageId,
  inflateWhatsAppTemplates,
  isAuthStatus,
  isInteraktSuccessBody,
  isTransientStatus,
  resolveInteraktAccount,
  toInteraktPayload,
} from "./whatsApp";

const MESSAGE_ID = "0f2a1c7e-6b1d-4a3e-9c22-7d5b0e4f8a91";

// neverthrow's _unsafeUnwrapErr trips no-underscore-dangle, and asserting on
// the error is clearer than unwrapping it anyway.
function expectErrMessage(result: Result<unknown, Error>): string {
  if (result.isOk()) {
    throw new Error("expected an error result, got a success");
  }
  return result.error.message;
}

function contents(overrides: Partial<WhatsAppContents> = {}): WhatsAppContents {
  return {
    templateName: "abandon_cart2",
    languageCode: "en",
    ...overrides,
  };
}

describe("splitE164", () => {
  it("splits an Indian number", () => {
    expect(splitE164("+919876543210")).toEqual({
      countryCode: "+91",
      phoneNumber: "9876543210",
    });
  });

  it("tolerates spaces, dashes and parentheses", () => {
    expect(splitE164(" +91 98765-43210 ")).toEqual({
      countryCode: "+91",
      phoneNumber: "9876543210",
    });
  });

  it("prefers the longer country code when one prefixes another", () => {
    // 971 (UAE) must not be split as 97 or 9.
    expect(splitE164("+971501234567")).toEqual({
      countryCode: "+971",
      phoneNumber: "501234567",
    });
  });

  it.each([
    ["missing plus", "919876543210"],
    ["not a number", "+91abcdefghij"],
    ["unsupported country code", "+998901234567"],
    ["national part too short", "+9112345"],
    ["empty", ""],
  ])("rejects %s", (_label, input) => {
    expect(splitE164(input)).toBeNull();
  });
});

describe("collectWhatsAppTemplates", () => {
  it("flattens positional arrays by index so each renders separately", () => {
    const templates = collectWhatsAppTemplates(
      contents({
        headerValues: ["{{ user.imageUrl }}"],
        bodyValues: ["{{ user.firstName }}", "{{ user.cartTopBrand }}"],
        buttonValues: '{"0": ["{{ user.cartTopDrugCode }}"]}',
      }),
    );
    expect(templates).toEqual({
      "headerValues.0": { contents: "{{ user.imageUrl }}" },
      "bodyValues.0": { contents: "{{ user.firstName }}" },
      "bodyValues.1": { contents: "{{ user.cartTopBrand }}" },
      buttonValues: { contents: '{"0": ["{{ user.cartTopDrugCode }}"]}' },
    });
  });

  it("does not template the fields that select the provider template", () => {
    const templates = collectWhatsAppTemplates(
      contents({ account: InteraktAccount.Support }),
    );
    // Templating these would let a bad user property silently send a
    // different approved template, or send on the wrong account.
    expect(templates).not.toHaveProperty("templateName");
    expect(templates).not.toHaveProperty("languageCode");
    expect(templates).not.toHaveProperty("account");
  });
});

describe("inflateWhatsAppTemplates", () => {
  it("preserves positions rather than dropping empty values", () => {
    // Dropping index 0 would slide "Crocin" into slot 1 and deliver the
    // brand where the name belongs. Position must survive; the empty value
    // is rejected later, by toInteraktPayload.
    const inflated = inflateWhatsAppTemplates(
      { "bodyValues.0": "", "bodyValues.1": "Crocin 650" },
      contents({ bodyValues: ["{{ user.firstName }}", "{{ user.brand }}"] }),
    );
    expect(inflated.bodyValues).toEqual(["", "Crocin 650"]);
  });

  it("falls back to the original when a slot was never rendered", () => {
    const inflated = inflateWhatsAppTemplates(
      {},
      contents({ bodyValues: ["literal"] }),
    );
    expect(inflated.bodyValues).toEqual(["literal"]);
  });

  it("carries the non-templated selectors through unchanged", () => {
    const inflated = inflateWhatsAppTemplates(
      {},
      contents({
        account: InteraktAccount.Support,
        identifierKey: "altPhone",
      }),
    );
    expect(inflated.templateName).toBe("abandon_cart2");
    expect(inflated.languageCode).toBe("en");
    expect(inflated.account).toBe(InteraktAccount.Support);
    expect(inflated.identifierKey).toBe("altPhone");
  });
});

describe("toInteraktPayload", () => {
  it("builds a body-only template send", () => {
    const payload = unwrap(
      toInteraktPayload({
        contents: contents({ bodyValues: ["Lakshya", "Crocin 650"] }),
        identifier: "+919876543210",
        messageId: MESSAGE_ID,
      }),
    );
    expect(payload).toEqual({
      countryCode: "+91",
      phoneNumber: "9876543210",
      callbackData: `df:${MESSAGE_ID}`,
      type: "Template",
      template: {
        name: "abandon_cart2",
        languageCode: "en",
        bodyValues: ["Lakshya", "Crocin 650"],
      },
    });
  });

  it("includes header media and parsed button values", () => {
    const payload = unwrap(
      toInteraktPayload({
        contents: contents({
          headerValues: ["https://cdn.example.com/a.jpg"],
          bodyValues: ["Lakshya"],
          buttonValues: '{"0": ["DRG-10422"]}',
        }),
        identifier: "+919876543210",
        messageId: MESSAGE_ID,
      }),
    );
    expect(payload.template).toEqual({
      name: "abandon_cart2",
      languageCode: "en",
      headerValues: ["https://cdn.example.com/a.jpg"],
      bodyValues: ["Lakshya"],
      buttonValues: { "0": ["DRG-10422"] },
    });
  });

  it("omits empty arrays rather than sending them", () => {
    const payload = unwrap(
      toInteraktPayload({
        contents: contents({ bodyValues: [], headerValues: [] }),
        identifier: "+919876543210",
        messageId: MESSAGE_ID,
      }),
    );
    expect(payload.template).toEqual({
      name: "abandon_cart2",
      languageCode: "en",
    });
  });

  // The reason this is a first-class channel and not a webhook template with a
  // hand-written JSON body: a value like this would break a JSON string
  // literal, mangling the payload or shifting parameters.
  it("carries quotes, newlines and backslashes through intact", () => {
    const nasty = 'Ravi "Ravi" O\'Neil\nLine2\\end {{not_liquid}}';
    const payload = unwrap(
      toInteraktPayload({
        contents: contents({ bodyValues: [nasty, "Crocin"] }),
        identifier: "+919876543210",
        messageId: MESSAGE_ID,
      }),
    );
    expect(payload.template.bodyValues).toEqual([nasty, "Crocin"]);
    // And the whole payload survives a real JSON round trip, which is what
    // axios does on the way out.
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });

  it("rejects an unsupported phone number", () => {
    const result = toInteraktPayload({
      contents: contents(),
      identifier: "9876543210",
      messageId: MESSAGE_ID,
    });
    expect(result.isErr()).toBe(true);
    expect(expectErrMessage(result)).toContain("E.164");
  });

  it("rejects a blank body parameter, naming the position", () => {
    const result = toInteraktPayload({
      contents: contents({ bodyValues: ["Lakshya", "   "] }),
      identifier: "+919876543210",
      messageId: MESSAGE_ID,
    });
    expect(result.isErr()).toBe(true);
    // 1-indexed to match how the template author numbers {{1}}, {{2}}.
    expect(expectErrMessage(result)).toContain("Body parameter 2");
  });

  it("rejects a blank header parameter", () => {
    const result = toInteraktPayload({
      contents: contents({ headerValues: [""] }),
      identifier: "+919876543210",
      messageId: MESSAGE_ID,
    });
    expect(result.isErr()).toBe(true);
    expect(expectErrMessage(result)).toContain("Header parameter 1");
  });

  it("rejects a missing template name", () => {
    const result = toInteraktPayload({
      contents: contents({ templateName: "" }),
      identifier: "+919876543210",
      messageId: MESSAGE_ID,
    });
    expect(result.isErr()).toBe(true);
    expect(expectErrMessage(result)).toContain("template name");
  });

  it("rejects button values that did not render to a JSON object", () => {
    const result = toInteraktPayload({
      contents: contents({ buttonValues: "[1,2]" }),
      identifier: "+919876543210",
      messageId: MESSAGE_ID,
    });
    expect(result.isErr()).toBe(true);
    expect(expectErrMessage(result)).toContain("JSON object");
  });

  it("sets callbackData so receipts can be attributed back", () => {
    const payload = unwrap(
      toInteraktPayload({
        contents: contents(),
        identifier: "+919876543210",
        messageId: MESSAGE_ID,
      }),
    );
    // The "df:" prefix is what lets the webhook forwarder skip legacy sends.
    expect(payload.callbackData).toBe(`df:${MESSAGE_ID}`);
  });
});

describe("resolveInteraktAccount", () => {
  it("defaults to the campaign account", () => {
    expect(resolveInteraktAccount(contents())).toBe(InteraktAccount.Campaign);
  });

  it("honours an explicit account", () => {
    expect(
      resolveInteraktAccount(contents({ account: InteraktAccount.Support })),
    ).toBe(InteraktAccount.Support);
  });
});

describe("isInteraktSuccessBody", () => {
  it("accepts an explicit success", () => {
    expect(isInteraktSuccessBody({ result: true, id: "abc" })).toBe(true);
  });

  it("accepts a body carrying only an id", () => {
    expect(isInteraktSuccessBody({ id: "abc" })).toBe(true);
  });

  // The landmine: Interakt answers 200 with result:false for a rejected
  // template. Treating that as sent would inflate the campaign report and
  // hide a broken template.
  it("rejects result:false even though the status was 200", () => {
    expect(
      isInteraktSuccessBody({ result: false, message: "Invalid template" }),
    ).toBe(false);
  });

  it.each([
    ["null", null],
    ["a string", "ok"],
    ["an array", []],
    ["an empty object", {}],
    ["an empty id", { id: "" }],
  ])("rejects %s", (_label, body) => {
    expect(isInteraktSuccessBody(body)).toBe(false);
  });
});

describe("response extraction", () => {
  it("reads the provider message id", () => {
    expect(extractInteraktMessageId({ id: "abc" })).toBe("abc");
    expect(extractInteraktMessageId({ message_id: "xyz" })).toBe("xyz");
    expect(extractInteraktMessageId({})).toBeUndefined();
  });

  it("reads an error message from either shape", () => {
    expect(extractInteraktErrorMessage({ message: "bad" })).toBe("bad");
    expect(extractInteraktErrorMessage({ error: { message: "nested" } })).toBe(
      "nested",
    );
    expect(extractInteraktErrorMessage({})).toBeUndefined();
  });
});

describe("status classification", () => {
  it.each([429, 500, 502, 503])("treats %i as retryable", (status) => {
    expect(isTransientStatus(status)).toBe(true);
  });

  it("treats a missing status as retryable, since nothing was sent", () => {
    expect(isTransientStatus(undefined)).toBe(true);
  });

  it.each([400, 401, 403, 404, 422])("treats %i as permanent", (status) => {
    expect(isTransientStatus(status)).toBe(false);
  });

  it("separates auth failures so they surface as a config error", () => {
    expect(isAuthStatus(401)).toBe(true);
    expect(isAuthStatus(403)).toBe(true);
    expect(isAuthStatus(400)).toBe(false);
  });
});

// SearchDeliveriesResponseItem is a closed union, and parseSearchDeliveryRow
// returns null on a validation failure -- so a missing member would make every
// WhatsApp delivery vanish from the deliveries table while the send itself
// succeeded. This pins the real row shape against the schema.
describe("delivery row compatibility", () => {
  it("validates a WhatsApp delivery against SearchDeliveriesResponseItem", () => {
    const row = {
      sentAt: "2026-09-04 07:15:00",
      updatedAt: "2026-09-04 07:15:00",
      journeyId: "b9f1a3c2-1d4e-4a7b-8c3d-2e5f6a7b8c9d",
      userId: "ZUYJNesWYWdd3QXix_Qbq6_aDG8",
      originMessageId: MESSAGE_ID,
      templateId: "58193e86-5989-4552-a758-7015fa841d25",
      status: InternalEventType.MessageSent,
      variant: {
        type: ChannelType.WhatsApp,
        provider: { type: WhatsAppProviderType.Interakt },
        to: "+919876543210",
        providerMessageId: "interakt-msg-1",
        providerResponse: { result: true, id: "interakt-msg-1" },
        templateName: "abandon_cart2",
        languageCode: "en",
        account: InteraktAccount.Campaign,
        bodyValues: ["Lakshya", "Crocin 650"],
        identifierKey: "phone",
      },
    };
    const result = schemaValidateWithErr(row, SearchDeliveriesResponseItem);
    if (result.isErr()) {
      throw new Error(
        `WhatsApp delivery row failed validation: ${result.error.message}`,
      );
    }
    // The union also carries deprecated flat members without a `variant`, so
    // narrow before reading it.
    const { value } = result;
    expect("variant" in value && value.variant.type).toBe(ChannelType.WhatsApp);
  });
});
