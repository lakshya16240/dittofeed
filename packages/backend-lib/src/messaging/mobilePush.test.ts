import { DEVICE_REGISTERED_EVENT } from "isomorphic-lib/src/mobilePush";
import { unwrap } from "isomorphic-lib/src/resultHandling/resultUtils";
import { schemaValidateWithErr } from "isomorphic-lib/src/resultHandling/schemaValidation";
import {
  ChannelType,
  InternalEventType,
  MobilePushProviderType,
  SearchDeliveriesResponseItem,
} from "isomorphic-lib/src/types";

import {
  collectMobilePushTemplates,
  inflateMobilePushTemplates,
  resolveDeviceTokens,
  toFcmMessage,
} from "./mobilePush";

const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);
const TOKEN_C = "c".repeat(64);

function registrationEvent(
  properties: Record<string, unknown>,
  timestamp = "2024-01-01T00:00:00",
) {
  return { event: DEVICE_REGISTERED_EVENT, timestamp, properties };
}

describe("resolveDeviceTokens", () => {
  it("resolves a bare token string from a Trait property", () => {
    expect(resolveDeviceTokens(TOKEN_A)).toEqual([{ token: TOKEN_A }]);
  });

  it("resolves a PerformedMany array of registration events", () => {
    const result = resolveDeviceTokens([
      registrationEvent({
        deviceToken: TOKEN_A,
        deviceId: "d1",
        platform: "Android",
      }),
      registrationEvent({
        deviceToken: TOKEN_B,
        deviceId: "d2",
        platform: "iOS",
      }),
    ]);
    expect(result).toEqual([
      { token: TOKEN_A, deviceId: "d1", platform: "android" },
      { token: TOKEN_B, deviceId: "d2", platform: "ios" },
    ]);
  });

  it("parses a JSON-encoded array, which only the test-send endpoint produces", () => {
    const raw = JSON.stringify([
      registrationEvent({ deviceToken: TOKEN_A, deviceId: "d1" }),
    ]);
    expect(resolveDeviceTokens(raw)).toEqual([
      { token: TOKEN_A, deviceId: "d1", platform: undefined },
    ]);
  });

  it("keeps only the newest token per deviceId", () => {
    // Input is newest-first, as produced by computePropertiesIncremental.
    const result = resolveDeviceTokens([
      registrationEvent({ deviceToken: TOKEN_B, deviceId: "same-phone" }),
      registrationEvent({ deviceToken: TOKEN_A, deviceId: "same-phone" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.token).toEqual(TOKEN_B);
  });

  it("dedupes a token that migrated between deviceIds", () => {
    const result = resolveDeviceTokens([
      registrationEvent({ deviceToken: TOKEN_A, deviceId: "new-phone" }),
      registrationEvent({ deviceToken: TOKEN_A, deviceId: "old-phone" }),
    ]);
    expect(result).toEqual([
      { token: TOKEN_A, deviceId: "new-phone", platform: undefined },
    ]);
  });

  it("caps devices after deduping, so the cap is a device cap", () => {
    const events = Array.from({ length: 50 }, (_, i) =>
      registrationEvent({
        deviceToken: `${i}`.padStart(64, "x"),
        deviceId: `d${i}`,
      }),
    );
    expect(resolveDeviceTokens(events, { maxDevices: 10 })).toHaveLength(10);
  });

  it("skips garbage entries without failing the whole resolution", () => {
    const result = resolveDeviceTokens([
      null,
      42,
      { properties: {} },
      { properties: { deviceToken: "has whitespace in it" } },
      registrationEvent({ deviceToken: TOKEN_C }),
    ]);
    expect(result).toEqual([
      { token: TOKEN_C, deviceId: undefined, platform: undefined },
    ]);
  });

  it("returns an empty list for null, undefined and empty input", () => {
    expect(resolveDeviceTokens(null)).toEqual([]);
    expect(resolveDeviceTokens(undefined)).toEqual([]);
    expect(resolveDeviceTokens([])).toEqual([]);
    expect(resolveDeviceTokens("")).toEqual([]);
  });
});

describe("toFcmMessage", () => {
  it("maps an Android-only template, re-nesting the flattened fields", () => {
    const result = toFcmMessage({
      title: "Hello",
      body: "World",
      android: { channelId: "default", priority: "high", ttlSeconds: 60 },
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({
      notification: { title: "Hello", body: "World" },
      android: {
        priority: "high",
        ttl: 60000,
        notification: { channelId: "default" },
      },
    });
  });

  it("maps an iOS-only template into apns.payload.aps", () => {
    const result = toFcmMessage({
      title: "Hello",
      body: "World",
      apns: {
        badge: "3",
        sound: "default",
        contentAvailable: true,
        interruptionLevel: "time-sensitive",
      },
    });
    expect(unwrap(result)).toEqual({
      notification: { title: "Hello", body: "World" },
      apns: {
        payload: {
          aps: {
            alert: { title: "Hello", body: "World" },
            badge: 3,
            sound: "default",
            contentAvailable: true,
            "interruption-level": "time-sensitive",
          },
        },
      },
    });
  });

  it("maps a template targeting both platforms", () => {
    const result = toFcmMessage({
      title: "T",
      body: "B",
      imageUrl: "https://example.com/a.png",
      data: '{"orderId":"123"}',
      android: { channelId: "orders" },
      apns: { badge: "1" },
    });
    const message = unwrap(result);
    expect(message.notification).toEqual({
      title: "T",
      body: "B",
      imageUrl: "https://example.com/a.png",
    });
    expect(message.data).toEqual({ orderId: "123" });
    expect(message.android?.notification?.channelId).toEqual("orders");
    expect(message.apns?.payload?.aps.badge).toEqual(1);
  });

  it("rejects a badge that does not render to a non-negative integer", () => {
    const result = toFcmMessage({
      title: "T",
      apns: { badge: "not-a-number" },
    });
    expect(result.isErr()).toBe(true);
  });

  it("rejects non-string data values, which FCM does not accept", () => {
    const result = toFcmMessage({ title: "T", data: '{"count":3}' });
    expect(result.isErr()).toBe(true);
  });

  it("rejects FCM's reserved data keys", () => {
    expect(toFcmMessage({ title: "T", data: '{"from":"x"}' }).isErr()).toBe(
      true,
    );
    expect(toFcmMessage({ title: "T", data: '{"google_x":"y"}' }).isErr()).toBe(
      true,
    );
  });

  it("omits an empty notification rather than sending empty strings", () => {
    const message = unwrap(toFcmMessage({ data: '{"k":"v"}' }));
    expect(message.notification).toBeUndefined();
  });
});

describe("collect/inflate round trip", () => {
  it("drops fields that render to an empty string", () => {
    const definition = {
      title: "Hi {{ user.firstName }}",
      body: "Body",
      imageUrl: "{{ user.avatar }}",
      android: { channelId: "default" },
    };
    const templates = collectMobilePushTemplates(definition);
    expect(Object.keys(templates).sort()).toEqual([
      "android.channelId",
      "body",
      "imageUrl",
      "title",
    ]);

    // renderLiquid returns "" (not undefined) for an unresolved field; an
    // unpruned imageUrl:"" would reach FCM as messaging/invalid-argument.
    const inflated = inflateMobilePushTemplates(
      {
        title: "Hi Matt",
        body: "Body",
        imageUrl: "",
        "android.channelId": "default",
      },
      definition,
    );
    expect(inflated.title).toEqual("Hi Matt");
    expect(inflated.imageUrl).toBeUndefined();
    expect(inflated.android).toEqual({ channelId: "default" });
  });

  it("carries non-string literals through without rendering them", () => {
    const definition = {
      title: "T",
      android: { priority: "high" as const, ttlSeconds: 30 },
      apns: { contentAvailable: true, mutableContent: false },
    };
    const inflated = inflateMobilePushTemplates({ title: "T" }, definition);
    expect(inflated.android).toEqual({ priority: "high", ttlSeconds: 30 });
    // An explicit `false` is kept: it is a deliberate author choice and a valid
    // FCM value. Only empty strings and nullish values are pruned.
    expect(inflated.apns).toEqual({
      contentAvailable: true,
      mutableContent: false,
    });
  });
});

describe("mobile push deliveries", () => {
  // SearchDeliveriesResponseItem is a closed union and parseSearchDeliveryRow
  // returns null when validation fails, so a missing member here would drop
  // every push delivery from the deliveries table while the send still
  // succeeded -- a silent hole rather than an error.
  it("validates a real push delivery row, so deliveries are not silently dropped", () => {
    const variant = {
      type: ChannelType.MobilePush,
      provider: { type: MobilePushProviderType.Firebase },
      to: TOKEN_A,
      devices: [
        {
          token: TOKEN_A,
          deviceId: "d1",
          platform: "android",
          status: "Sent",
          fcmMessageId: "projects/p/messages/1",
        },
        {
          token: TOKEN_B,
          deviceId: "d2",
          platform: "ios",
          status: "Unregistered",
          errorCode: "messaging/registration-token-not-registered",
        },
      ],
      sentCount: 1,
      failureCount: 1,
      title: "Hello",
      body: "World",
      android: { channelId: "default" },
    };

    // Shaped exactly as parseSearchDeliveryRow builds it.
    const unvalidatedItem = {
      sentAt: "2024-01-01 00:00:00",
      updatedAt: "2024-01-01 00:00:00",
      status: InternalEventType.MessageSent,
      originMessageId: "11111111-1111-1111-1111-111111111111",
      userId: "user-1",
      templateId: "22222222-2222-2222-2222-222222222222",
      journeyId: "33333333-3333-3333-3333-333333333333",
      channel: ChannelType.MobilePush,
      to: TOKEN_A,
      variant,
    };

    const result = schemaValidateWithErr(
      unvalidatedItem,
      SearchDeliveriesResponseItem,
    );
    if (result.isErr()) {
      throw new Error(
        `push delivery row failed validation: ${result.error.message}`,
      );
    }
    expect(result.isOk()).toBe(true);
  });
});
