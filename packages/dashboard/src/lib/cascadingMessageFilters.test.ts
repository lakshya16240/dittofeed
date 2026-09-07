import { InternalEventType } from "isomorphic-lib/src/types";

import { expandCascadingMessageFilters } from "./cascadingMessageFilters";

describe("expandCascadingMessageFilters", () => {
  it("returns an empty list for no selection", () => {
    expect(expandCascadingMessageFilters([])).toEqual([]);
  });

  describe("email", () => {
    it("expands clicked to opened and delivered", () => {
      expect(
        expandCascadingMessageFilters([InternalEventType.EmailClicked]).sort(),
      ).toEqual(
        [
          InternalEventType.EmailClicked,
          InternalEventType.EmailOpened,
          InternalEventType.EmailDelivered,
        ].sort(),
      );
    });

    it("does not expand a bounce", () => {
      expect(
        expandCascadingMessageFilters([InternalEventType.EmailBounced]),
      ).toEqual([InternalEventType.EmailBounced]);
    });
  });

  describe("whatsApp", () => {
    // Without these cases the statuses fell through to the default branch and
    // were passed along unexpanded, so filtering the deliveries table for
    // "delivered" silently hid every message that had been read or clicked --
    // exactly the messages the campaign did best on.
    it("expands clicked to read and delivered", () => {
      expect(
        expandCascadingMessageFilters([
          InternalEventType.WhatsAppClicked,
        ]).sort(),
      ).toEqual(
        [
          InternalEventType.WhatsAppClicked,
          InternalEventType.WhatsAppRead,
          InternalEventType.WhatsAppDelivered,
        ].sort(),
      );
    });

    it("expands read to delivered", () => {
      expect(
        expandCascadingMessageFilters([InternalEventType.WhatsAppRead]).sort(),
      ).toEqual(
        [
          InternalEventType.WhatsAppRead,
          InternalEventType.WhatsAppDelivered,
        ].sort(),
      );
    });

    it("leaves delivered and failed alone", () => {
      expect(
        expandCascadingMessageFilters([InternalEventType.WhatsAppDelivered]),
      ).toEqual([InternalEventType.WhatsAppDelivered]);
      expect(
        expandCascadingMessageFilters([InternalEventType.WhatsAppFailed]),
      ).toEqual([InternalEventType.WhatsAppFailed]);
    });
  });

  it("does not mix channels when both are selected", () => {
    const expanded = expandCascadingMessageFilters([
      InternalEventType.EmailOpened,
      InternalEventType.WhatsAppRead,
    ]);
    expect(expanded.sort()).toEqual(
      [
        InternalEventType.EmailOpened,
        InternalEventType.EmailDelivered,
        InternalEventType.WhatsAppRead,
        InternalEventType.WhatsAppDelivered,
      ].sort(),
    );
    // An email selection must not drag in the WhatsApp equivalent.
    expect(expanded).not.toContain(InternalEventType.SmsDelivered);
  });
});
