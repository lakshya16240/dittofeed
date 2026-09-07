import { MESSAGE_EVENTS } from "isomorphic-lib/src/constants";

import {
  BouncedEventsList,
  ClickedEventsList,
  DeliveredEventsList,
  InternalEventType,
  OpenedEventsList,
  StatusEventsList,
} from "./types";

/**
 * These lists have to agree with each other for a channel's delivery statuses
 * to show up anywhere, and nothing fails loudly when they do not -- the events
 * land in ClickHouse and are simply never counted. MobilePush and WhatsApp
 * were each added to one list and missed in another, so the invariants are
 * pinned here rather than left to review.
 */
describe("status event lists", () => {
  const outcomeGroups = {
    delivered: DeliveredEventsList,
    opened: OpenedEventsList,
    clicked: ClickedEventsList,
    bounced: BouncedEventsList,
  };

  it("only counts events that are actually ingested", () => {
    // An outcome group naming an event absent from StatusEventsList would
    // count something the deliveries pipeline never records.
    const ingested = new Set<string>(StatusEventsList);
    for (const [outcome, events] of Object.entries(outcomeGroups)) {
      for (const event of events) {
        expect(ingested.has(event)).toBe(true);
        expect(`${outcome}:${event}`).toBe(`${outcome}:${event}`);
      }
    }
  });

  it("counts each status event toward at most one outcome", () => {
    // Double counting would inflate a campaign report rather than break it,
    // which is the harder kind of bug to notice.
    const seen = new Map<string, string>();
    for (const [outcome, events] of Object.entries(outcomeGroups)) {
      for (const event of events) {
        expect(seen.get(event)).toBeUndefined();
        seen.set(event, outcome);
      }
    }
  });

  it("includes every status event in MESSAGE_EVENTS", () => {
    // getJourneyMessageStats filters its internal_events scan on
    // MESSAGE_EVENTS, so an omission here zeroes a channel's per-node journey
    // stats no matter what the aggregations know how to count.
    const messageEvents = new Set<string>(MESSAGE_EVENTS);
    for (const event of StatusEventsList) {
      expect(messageEvents.has(event)).toBe(true);
    }
  });

  it("wires every WhatsApp status into an outcome", () => {
    const counted = new Set<string>([
      ...DeliveredEventsList,
      ...OpenedEventsList,
      ...ClickedEventsList,
      ...BouncedEventsList,
    ]);
    expect(counted.has(InternalEventType.WhatsAppDelivered)).toBe(true);
    // A read receipt is treated as the open analogue.
    expect(OpenedEventsList).toContain(InternalEventType.WhatsAppRead);
    expect(counted.has(InternalEventType.WhatsAppClicked)).toBe(true);
    expect(counted.has(InternalEventType.WhatsAppFailed)).toBe(true);
  });

  it("documents the statuses that are deliberately not summarized", () => {
    // Both are ingested and drive the deliveries table, but neither maps onto
    // a sent/delivered/opened/clicked/bounced column. Asserted so that adding
    // one to an outcome group is a deliberate edit to this test rather than a
    // silent change in reported numbers.
    const counted = new Set<string>([
      ...DeliveredEventsList,
      ...OpenedEventsList,
      ...ClickedEventsList,
      ...BouncedEventsList,
    ]);
    expect(counted.has(InternalEventType.EmailDropped)).toBe(false);
    expect(counted.has(InternalEventType.EmailMarkedSpam)).toBe(false);
  });
});
