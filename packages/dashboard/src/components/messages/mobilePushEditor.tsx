import { json as codeMirrorJson, jsonParseLinter } from "@codemirror/lang-json";
import { linter, lintGutter } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Autocomplete,
  Chip,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import ReactCodeMirror from "@uiw/react-codemirror";
import {
  ChannelType,
  CompletionStatus,
  MobilePushAndroidConfig,
  MobilePushApnsConfig,
  RenderMessageTemplateRequestContents,
  RenderMessageTemplateType,
  UserPropertyDefinitionType,
  WorkspaceMemberResource,
} from "isomorphic-lib/src/types";
import React, { useMemo } from "react";

import { useAppStorePick } from "../../lib/appStore";
import TemplateEditor, {
  DraftToPreview,
  getDisabledInputStyles,
  RenderEditorParams,
  TemplateEditorMode,
} from "../templateEditor";
import MobilePushPreviewBody from "./mobilePushPreview";

function fieldToReadable(field: string) {
  switch (field) {
    case "title":
      return "Title";
    case "body":
      return "Body";
    case "imageUrl":
      return "Image URL";
    case "data":
      return "Custom Data";
    case "android.channelId":
      return "Android Channel ID";
    case "apns.badge":
      return "iOS Badge";
    default:
      return null;
  }
}

// Only flat string fields can be previewed: RenderMessageTemplateRequestContents
// is a flat Record<string, Content>. The remaining fields are literals that are
// never liquid-rendered, so nothing is lost.
const draftToPreview: DraftToPreview = (definition) => {
  if (definition.type !== ChannelType.MobilePush) {
    throw new Error("Invalid channel type");
  }
  const contents: RenderMessageTemplateRequestContents = {
    title: {
      type: RenderMessageTemplateType.PlainText,
      value: definition.title ?? "",
    },
    body: {
      type: RenderMessageTemplateType.PlainText,
      value: definition.body ?? "",
    },
  };
  if (definition.imageUrl) {
    contents.imageUrl = {
      type: RenderMessageTemplateType.PlainText,
      value: definition.imageUrl,
    };
  }
  return contents;
};

type SetDraft = RenderEditorParams["setDraft"];

function patchAndroid(
  setDraft: SetDraft,
  patch: Partial<MobilePushAndroidConfig>,
) {
  setDraft((defn) => {
    if (defn.type !== ChannelType.MobilePush) {
      return defn;
    }
    defn.android = { ...(defn.android ?? {}), ...patch };
    return defn;
  });
}

function patchApns(setDraft: SetDraft, patch: Partial<MobilePushApnsConfig>) {
  setDraft((defn) => {
    if (defn.type !== ChannelType.MobilePush) {
      return defn;
    }
    defn.apns = { ...(defn.apns ?? {}), ...patch };
    return defn;
  });
}

const ANDROID_PRIORITIES = ["normal", "high"] as const;

const INTERRUPTION_LEVELS = [
  "passive",
  "active",
  "time-sensitive",
  "critical",
] as const;

// Narrow a Select's string value back to the union. `find` yields undefined for
// the empty "Default" option, which is exactly what should be stored.
function parseAndroidPriority(
  value: string,
): MobilePushAndroidConfig["priority"] {
  return ANDROID_PRIORITIES.find((p) => p === value);
}

function parseInterruptionLevel(
  value: string,
): MobilePushApnsConfig["interruptionLevel"] {
  return INTERRUPTION_LEVELS.find((l) => l === value);
}

function countSet(obj: object | undefined): number {
  if (!obj) {
    return 0;
  }
  return Object.values(obj).filter(
    (v) => v !== undefined && v !== "" && v !== false,
  ).length;
}

function AdvancedSection({
  label,
  count,
  children,
}: React.PropsWithChildren<{ label: string; count: number }>) {
  return (
    <Accordion
      disableGutters
      elevation={0}
      square
      sx={{ "&:before": { display: "none" } }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="subtitle2">{label}</Typography>
          {count > 0 && <Chip size="small" label={`${count} set`} />}
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2}>{children}</Stack>
      </AccordionDetails>
    </Accordion>
  );
}

export default function MobilePushEditor({
  templateId,
  hideTitle,
  hidePublisher,
  disabled,
  member,
  mode,
  defaultIsUserPropertiesMinimised,
  hideUserPropertiesPanel,
  hideEditor,
}: {
  templateId: string;
  hideTitle?: boolean;
  hidePublisher?: boolean;
  disabled?: boolean;
  member?: WorkspaceMemberResource;
  mode?: TemplateEditorMode;
  defaultIsUserPropertiesMinimised?: boolean;
  hideUserPropertiesPanel?: boolean;
  hideEditor?: boolean;
}) {
  const theme = useTheme();
  const { userProperties } = useAppStorePick(["userProperties"]);

  // Device tokens normally live in a PerformedMany property over
  // DeviceRegistered events, but a single-device Trait works too -- so group
  // rather than filter.
  const identifierOptions = useMemo(() => {
    if (userProperties.type !== CompletionStatus.Successful) {
      return [];
    }
    return userProperties.value
      .map((up) => ({
        name: up.name,
        group:
          up.definition.type === UserPropertyDefinitionType.PerformedMany
            ? "Device token properties"
            : "Other user properties",
      }))
      .sort((a, b) => a.group.localeCompare(b.group));
  }, [userProperties]);

  return (
    <TemplateEditor
      templateId={templateId}
      channel={ChannelType.MobilePush}
      member={member}
      disabled={disabled}
      hideTitle={hideTitle}
      hidePublisher={hidePublisher}
      renderEditorHeader={({ draft, setDraft }) => {
        if (draft.type !== ChannelType.MobilePush) {
          return null;
        }
        return (
          <Autocomplete
            disabled={disabled}
            options={identifierOptions}
            groupBy={(option) => option.group}
            getOptionLabel={(option) => option.name}
            isOptionEqualToValue={(option, value) => option.name === value.name}
            value={
              identifierOptions.find((o) => o.name === draft.identifierKey) ??
              null
            }
            autoComplete
            renderInput={(params) => (
              <TextField
                {...params}
                variant="filled"
                label="Device Token Property"
                InputProps={{
                  ...params.InputProps,
                  sx: {
                    fontSize: ".75rem",
                    borderTopRightRadius: 0,
                  },
                }}
              />
            )}
            onChange={(_, value) => {
              setDraft((defn) => {
                if (defn.type !== ChannelType.MobilePush) {
                  return defn;
                }
                defn.identifierKey = value?.name;
                return defn;
              });
            }}
          />
        );
      }}
      renderEditorBody={({ draft, setDraft }) => {
        if (draft.type !== ChannelType.MobilePush) {
          return null;
        }
        return (
          <Stack spacing={2} sx={{ p: 2 }}>
            <TextField
              label="Title"
              fullWidth
              disabled={disabled}
              value={draft.title ?? ""}
              onChange={(e) => {
                setDraft((defn) => {
                  if (defn.type !== ChannelType.MobilePush) {
                    return defn;
                  }
                  defn.title = e.target.value;
                  return defn;
                });
              }}
            />
            <TextField
              label="Body"
              fullWidth
              multiline
              rows={4}
              disabled={disabled}
              value={draft.body ?? ""}
              onChange={(e) => {
                setDraft((defn) => {
                  if (defn.type !== ChannelType.MobilePush) {
                    return defn;
                  }
                  defn.body = e.target.value;
                  return defn;
                });
              }}
            />
            <TextField
              label="Image URL"
              fullWidth
              disabled={disabled}
              helperText="On iOS, images require a Notification Service Extension in your app."
              value={draft.imageUrl ?? ""}
              onChange={(e) => {
                setDraft((defn) => {
                  if (defn.type !== ChannelType.MobilePush) {
                    return defn;
                  }
                  defn.imageUrl = e.target.value;
                  return defn;
                });
              }}
            />

            <AdvancedSection label="Android" count={countSet(draft.android)}>
              <TextField
                label="Notification Channel ID"
                fullWidth
                disabled={disabled}
                helperText="Must match a NotificationChannel created by your app on Android 8+."
                value={draft.android?.channelId ?? ""}
                onChange={(e) =>
                  patchAndroid(setDraft, { channelId: e.target.value })
                }
              />
              <TextField
                select
                label="Priority"
                fullWidth
                disabled={disabled}
                value={draft.android?.priority ?? ""}
                onChange={(e) =>
                  patchAndroid(setDraft, {
                    priority: parseAndroidPriority(e.target.value),
                  })
                }
              >
                <MenuItem value="">Default</MenuItem>
                <MenuItem value="normal">Normal</MenuItem>
                <MenuItem value="high">High</MenuItem>
              </TextField>
              <TextField
                label="Time to live (seconds)"
                type="number"
                fullWidth
                disabled={disabled}
                value={draft.android?.ttlSeconds ?? ""}
                onChange={(e) =>
                  patchAndroid(setDraft, {
                    ttlSeconds:
                      e.target.value === ""
                        ? undefined
                        : Number(e.target.value),
                  })
                }
              />
              <TextField
                label="Collapse Key"
                fullWidth
                disabled={disabled}
                value={draft.android?.collapseKey ?? ""}
                onChange={(e) =>
                  patchAndroid(setDraft, { collapseKey: e.target.value })
                }
              />
              <TextField
                label="Icon"
                fullWidth
                disabled={disabled}
                value={draft.android?.icon ?? ""}
                onChange={(e) =>
                  patchAndroid(setDraft, { icon: e.target.value })
                }
              />
              <TextField
                label="Color"
                fullWidth
                disabled={disabled}
                helperText="#rrggbb"
                value={draft.android?.color ?? ""}
                onChange={(e) =>
                  patchAndroid(setDraft, { color: e.target.value })
                }
              />
              <TextField
                label="Tag"
                fullWidth
                disabled={disabled}
                value={draft.android?.tag ?? ""}
                onChange={(e) =>
                  patchAndroid(setDraft, { tag: e.target.value })
                }
              />
              <TextField
                label="Click Action"
                fullWidth
                disabled={disabled}
                value={draft.android?.clickAction ?? ""}
                onChange={(e) =>
                  patchAndroid(setDraft, { clickAction: e.target.value })
                }
              />
            </AdvancedSection>

            <AdvancedSection label="iOS (APNs)" count={countSet(draft.apns)}>
              <TextField
                label="Subtitle"
                fullWidth
                disabled={disabled}
                value={draft.apns?.subtitle ?? ""}
                onChange={(e) =>
                  patchApns(setDraft, { subtitle: e.target.value })
                }
              />
              <TextField
                label="Badge"
                fullWidth
                disabled={disabled}
                helperText="A number, or liquid resolving to one, e.g. {{ user.unreadCount }}"
                value={draft.apns?.badge ?? ""}
                onChange={(e) => patchApns(setDraft, { badge: e.target.value })}
              />
              <TextField
                label="Sound"
                fullWidth
                disabled={disabled}
                value={draft.apns?.sound ?? ""}
                onChange={(e) => patchApns(setDraft, { sound: e.target.value })}
              />
              <TextField
                label="Thread ID"
                fullWidth
                disabled={disabled}
                helperText="Groups related notifications together."
                value={draft.apns?.threadId ?? ""}
                onChange={(e) =>
                  patchApns(setDraft, { threadId: e.target.value })
                }
              />
              <TextField
                label="Category"
                fullWidth
                disabled={disabled}
                value={draft.apns?.category ?? ""}
                onChange={(e) =>
                  patchApns(setDraft, { category: e.target.value })
                }
              />
              <TextField
                select
                label="Interruption Level"
                fullWidth
                disabled={disabled}
                value={draft.apns?.interruptionLevel ?? ""}
                onChange={(e) =>
                  patchApns(setDraft, {
                    interruptionLevel: parseInterruptionLevel(e.target.value),
                  })
                }
              >
                <MenuItem value="">Default</MenuItem>
                <MenuItem value="passive">Passive</MenuItem>
                <MenuItem value="active">Active</MenuItem>
                <MenuItem value="time-sensitive">Time Sensitive</MenuItem>
                <MenuItem value="critical">Critical</MenuItem>
              </TextField>
              <FormControlLabel
                control={
                  <Switch
                    disabled={disabled}
                    checked={draft.apns?.contentAvailable ?? false}
                    onChange={(e) =>
                      patchApns(setDraft, {
                        contentAvailable: e.target.checked,
                      })
                    }
                  />
                }
                label="Content Available (background delivery)"
              />
              <FormControlLabel
                control={
                  <Switch
                    disabled={disabled}
                    checked={draft.apns?.mutableContent ?? false}
                    onChange={(e) =>
                      patchApns(setDraft, { mutableContent: e.target.checked })
                    }
                  />
                }
                label="Mutable Content (required for images)"
              />
            </AdvancedSection>

            <AdvancedSection
              label="Custom Data (JSON)"
              count={draft.data ? 1 : 0}
            >
              <Typography variant="caption" color="text.secondary">
                A JSON object delivered alongside the notification. FCM requires
                every value to be a string.
              </Typography>
              <ReactCodeMirror
                value={draft.data ?? ""}
                onChange={(value) => {
                  setDraft((defn) => {
                    if (defn.type !== ChannelType.MobilePush) {
                      return defn;
                    }
                    defn.data = value;
                    return defn;
                  });
                }}
                readOnly={disabled}
                extensions={[
                  codeMirrorJson(),
                  linter(jsonParseLinter()),
                  EditorView.theme({
                    "&": {
                      fontFamily: theme.typography.fontFamily,
                    },
                  }),
                  EditorView.lineWrapping,
                  lintGutter(),
                ]}
              />
            </AdvancedSection>
          </Stack>
        );
      }}
      renderPreviewHeader={({ draft }) => {
        if (draft.type !== ChannelType.MobilePush) {
          return null;
        }
        const disabledStyles = getDisabledInputStyles(theme);
        return (
          <TextField
            label="Device Token Property"
            variant="filled"
            disabled
            InputProps={{
              sx: {
                fontSize: ".75rem",
                borderTopLeftRadius: 0,
              },
            }}
            sx={disabledStyles}
            value={draft.identifierKey ?? ""}
          />
        );
      }}
      renderPreviewBody={({ rendered }) => (
        <MobilePushPreviewBody
          title={rendered.title}
          body={rendered.body}
          imageUrl={rendered.imageUrl}
        />
      )}
      draftToPreview={draftToPreview}
      fieldToReadable={fieldToReadable}
      mode={mode}
      defaultIsUserPropertiesMinimised={defaultIsUserPropertiesMinimised}
      hideUserPropertiesPanel={hideUserPropertiesPanel}
      hideEditor={hideEditor}
    />
  );
}
