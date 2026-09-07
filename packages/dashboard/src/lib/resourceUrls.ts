import { messageTemplatePath } from "isomorphic-lib/src/messageTemplates";
import { ChannelType } from "isomorphic-lib/src/types";

import { ResourceType } from "./types";

export function getResourceUrl(
  resourceType: ResourceType,
  resourceId: string,
  options?: { channel?: ChannelType },
): string {
  switch (resourceType) {
    case ResourceType.Segment:
      return `/segments/v1?id=${resourceId}`;
    case ResourceType.SubscriptionGroup:
      return `/subscription-groups/${resourceId}`;
    case ResourceType.MessageTemplate: {
      if (!options?.channel) {
        throw new Error("Channel required for message template URL");
      }
      return messageTemplatePath({
        id: resourceId,
        channel: options.channel,
      });
    }
    case ResourceType.Journey:
      return `/journeys/v2?id=${resourceId}`;
    case ResourceType.UserProperty:
      return `/user-properties/${resourceId}`;
  }
}
