import { Autocomplete, TextField } from "@mui/material";
import { emailProviderLabel } from "isomorphic-lib/src/email";
import {
  ChannelType,
  MobilePushProviderType,
  SmsProviderType,
  WhatsAppProviderType,
  WorkspaceWideEmailProviders,
  WorkspaceWideEmailProviderType,
} from "isomorphic-lib/src/types";

type ChannelProvider =
  | WorkspaceWideEmailProviders
  | SmsProviderType
  | MobilePushProviderType
  | WhatsAppProviderType;

// Switches on channel rather than sniffing the value: MobilePushProviderType
// and SmsProviderType both contain "Test", so a value-based check would
// misattribute it.
function getProviderLabel(channel: ChannelType, provider: ChannelProvider) {
  switch (channel) {
    case ChannelType.Sms:
    case ChannelType.MobilePush:
    case ChannelType.WhatsApp:
      return provider;
    default:
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      return emailProviderLabel(provider as WorkspaceWideEmailProviders);
  }
}

export type ProviderOverrideChangeHandler = (
  provider: ChannelProvider | null,
) => void;

export default function ChannelProviderAutocomplete({
  channel,
  providerOverride,
  disabled,
  handler,
}: {
  providerOverride?: ChannelProvider | null;
  disabled?: boolean;
  channel: ChannelType;
  handler: ProviderOverrideChangeHandler;
}) {
  let providerOptions: ChannelProvider[] = [];
  switch (channel) {
    case ChannelType.Email:
      providerOptions = Object.values(WorkspaceWideEmailProviderType);
      break;
    case ChannelType.Sms:
      providerOptions = Object.values(SmsProviderType);
      break;
    case ChannelType.MobilePush:
      // Firebase is the only real provider; Test renders and resolves devices
      // without calling FCM.
      providerOptions = Object.values(MobilePushProviderType);
      break;
    case ChannelType.WhatsApp:
      // Interakt is the only real provider; Test renders and resolves the
      // recipient without calling it.
      providerOptions = Object.values(WhatsAppProviderType);
      break;
    case ChannelType.Webhook:
      // Webhooks don't have provider overrides
      return null;
  }

  const provider = providerOverride ?? null;

  return (
    <Autocomplete
      value={provider}
      options={providerOptions}
      disabled={disabled}
      getOptionLabel={(p) => getProviderLabel(channel, p)}
      onChange={(_event, p) =>
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        handler(p as ChannelProvider | null)
      }
      renderInput={(params) => (
        <TextField {...params} label="Provider Override" variant="outlined" />
      )}
    />
  );
}
