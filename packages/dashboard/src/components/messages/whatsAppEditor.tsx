import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import {
  Autocomplete,
  Box,
  Button,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  ChannelType,
  CompletionStatus,
  InteraktAccount,
  RenderMessageTemplateRequestContents,
  RenderMessageTemplateType,
  UserPropertyDefinitionType,
  WorkspaceMemberResource,
} from "isomorphic-lib/src/types";
import { DEFAULT_WHATSAPP_IDENTIFIER } from "isomorphic-lib/src/whatsApp";
import { useMemo } from "react";

import { useAppStorePick } from "../../lib/appStore";
import TemplateEditor, {
  DraftToPreview,
  RenderEditorParams,
  SetDraft,
  TemplateEditorMode,
} from "../templateEditor";
import WhatsAppPreviewBody from "./whatsAppPreview";

const ACCOUNT_OPTIONS: {
  value: InteraktAccount;
  label: string;
  help: string;
}[] = [
  {
    value: InteraktAccount.Campaign,
    label: "Campaign",
    help: "Marketing traffic. Use this for anything promotional.",
  },
  {
    value: InteraktAccount.Support,
    label: "Support",
    help: "Transactional traffic, e.g. order and payment updates.",
  },
];

// Narrows the select's string value back to the enum via a lookup rather than
// a cast, so an unrecognised value yields undefined instead of a bad enum.
function parseAccount(value: string): InteraktAccount | undefined {
  return ACCOUNT_OPTIONS.find((o) => String(o.value) === value)?.value;
}

/**
 * An ordered list of liquid-bearing parameters.
 *
 * Position is the whole point: the provider fills {{1}}, {{2}} by index, so the
 * row number is shown next to each field and reordering is explicit rather than
 * something that happens by editing text.
 */
function PositionalValues({
  label,
  placeholderPrefix,
  values,
  onChange,
  disabled,
  helpText,
}: {
  label: string;
  placeholderPrefix: string;
  values: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  helpText: string;
}) {
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="subtitle2">{label}</Typography>
        <Typography variant="caption" sx={{ opacity: 0.7 }}>
          {helpText}
        </Typography>
      </Stack>
      {values.map((value, index) => (
        // The index IS the identity here -- these are positional slots, not a
        // keyed collection.
        // eslint-disable-next-line react/no-array-index-key
        <Stack direction="row" spacing={1} alignItems="center" key={index}>
          <Typography
            variant="body2"
            sx={{ fontFamily: "monospace", opacity: 0.6, width: "3.5em" }}
          >
            {`{{${index + 1}}}`}
          </Typography>
          <TextField
            fullWidth
            size="small"
            disabled={disabled}
            value={value}
            placeholder={`${placeholderPrefix} ${index + 1}`}
            onChange={(e) => {
              const next = [...values];
              next[index] = e.target.value;
              onChange(next);
            }}
          />
          <Tooltip title="Remove">
            <span>
              <IconButton
                size="small"
                disabled={disabled}
                onClick={() => onChange(values.filter((_, i) => i !== index))}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      ))}
      <Box>
        <Button
          size="small"
          startIcon={<AddIcon />}
          disabled={disabled}
          onClick={() => onChange([...values, ""])}
        >
          Add {label.toLowerCase()}
        </Button>
      </Box>
    </Stack>
  );
}

function WhatsAppEditorBody({ draft, setDraft, disabled }: RenderEditorParams) {
  if (draft.type !== ChannelType.WhatsApp) {
    return null;
  }
  const headerValues = draft.headerValues ?? [];
  const bodyValues = draft.bodyValues ?? [];

  return (
    <Stack spacing={3} sx={{ p: 2, overflowY: "auto" }}>
      <Stack spacing={2}>
        <TextField
          label="Template name"
          required
          size="small"
          disabled={disabled}
          value={draft.templateName}
          helperText="Must match the approved template name on the provider exactly."
          onChange={(e) =>
            setDraft((defn) => {
              if (defn.type !== ChannelType.WhatsApp) return defn;
              defn.templateName = e.target.value;
              return defn;
            })
          }
        />
        <Stack direction="row" spacing={2}>
          <TextField
            label="Language"
            required
            size="small"
            sx={{ width: "12em" }}
            disabled={disabled}
            value={draft.languageCode}
            placeholder="en"
            onChange={(e) =>
              setDraft((defn) => {
                if (defn.type !== ChannelType.WhatsApp) return defn;
                defn.languageCode = e.target.value;
                return defn;
              })
            }
          />
          <TextField
            select
            label="Account"
            size="small"
            sx={{ width: "14em" }}
            disabled={disabled}
            value={draft.account ?? InteraktAccount.Campaign}
            helperText={
              ACCOUNT_OPTIONS.find(
                (o) => o.value === (draft.account ?? InteraktAccount.Campaign),
              )?.help
            }
            onChange={(e) =>
              setDraft((defn) => {
                if (defn.type !== ChannelType.WhatsApp) return defn;
                defn.account = parseAccount(e.target.value);
                return defn;
              })
            }
          >
            {ACCOUNT_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </Stack>

      <Divider />

      <PositionalValues
        label="Body parameters"
        placeholderPrefix="Body value"
        helpText="Order must match the approved template."
        values={bodyValues}
        disabled={disabled}
        onChange={(next) =>
          setDraft((defn) => {
            if (defn.type !== ChannelType.WhatsApp) return defn;
            defn.bodyValues = next;
            return defn;
          })
        }
      />

      <Divider />

      <PositionalValues
        label="Header parameters"
        placeholderPrefix="Header value"
        helpText="Usually a single media URL. Leave empty for a text-only template."
        values={headerValues}
        disabled={disabled}
        onChange={(next) =>
          setDraft((defn) => {
            if (defn.type !== ChannelType.WhatsApp) return defn;
            defn.headerValues = next;
            return defn;
          })
        }
      />

      <Divider />

      <TextField
        label="Button values"
        size="small"
        multiline
        minRows={2}
        disabled={disabled}
        value={draft.buttonValues ?? ""}
        placeholder='{"0": ["DRG-10422"]}'
        helperText="JSON keyed by button index. Supplies the dynamic suffix for URL buttons."
        onChange={(e) =>
          setDraft((defn) => {
            if (defn.type !== ChannelType.WhatsApp) return defn;
            defn.buttonValues = e.target.value;
            return defn;
          })
        }
      />
    </Stack>
  );
}

function IdentifierSelect({
  draft,
  setDraft,
  disabled,
}: {
  draft: RenderEditorParams["draft"];
  // Absent in the preview pane, which renders a disabled mirror of this
  // control purely so the two panes line up.
  setDraft?: SetDraft;
  disabled?: boolean;
}) {
  const { userProperties } = useAppStorePick(["userProperties"]);

  const options = useMemo(() => {
    if (userProperties.type !== CompletionStatus.Successful) {
      return [];
    }
    return userProperties.value
      .filter((up) => up.definition.type === UserPropertyDefinitionType.Trait)
      .map((up) => up.name);
  }, [userProperties]);

  if (draft.type !== ChannelType.WhatsApp) {
    return null;
  }

  return (
    <Autocomplete
      freeSolo
      disabled={disabled ?? !setDraft}
      options={options}
      sx={{ width: "18em" }}
      value={draft.identifierKey ?? DEFAULT_WHATSAPP_IDENTIFIER}
      onInputChange={(_event, value) =>
        setDraft?.((defn) => {
          if (defn.type !== ChannelType.WhatsApp) return defn;
          defn.identifierKey = value;
          return defn;
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          size="small"
          label="Recipient property"
          helperText="Must hold an E.164 number, e.g. +919876543210"
        />
      )}
    />
  );
}

function fieldToReadable(field: string) {
  if (field.startsWith("bodyValues.")) {
    const index = Number(field.split(".")[1]);
    return `Body parameter ${Number.isNaN(index) ? field : index + 1}`;
  }
  if (field.startsWith("headerValues.")) {
    const index = Number(field.split(".")[1]);
    return `Header parameter ${Number.isNaN(index) ? field : index + 1}`;
  }
  if (field === "buttonValues") {
    return "Button values";
  }
  return null;
}

// Mirrors collectWhatsAppTemplates on the backend: each positional parameter
// previews as its own field, so a liquid error points at one slot.
const draftToPreview: DraftToPreview = (definition) => {
  if (definition.type !== ChannelType.WhatsApp) {
    throw new Error("Invalid channel type");
  }
  const content: RenderMessageTemplateRequestContents = {};
  definition.headerValues?.forEach((value, i) => {
    content[`headerValues.${i}`] = {
      type: RenderMessageTemplateType.PlainText,
      value,
    };
  });
  definition.bodyValues?.forEach((value, i) => {
    content[`bodyValues.${i}`] = {
      type: RenderMessageTemplateType.PlainText,
      value,
    };
  });
  content.buttonValues = {
    type: RenderMessageTemplateType.PlainText,
    value: definition.buttonValues ?? "",
  };
  return content;
};

export default function WhatsAppEditor({
  templateId: messageId,
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
  return (
    <TemplateEditor
      templateId={messageId}
      channel={ChannelType.WhatsApp}
      member={member}
      disabled={disabled}
      hideTitle={hideTitle}
      hidePublisher={hidePublisher}
      renderEditorOptions={() => null}
      renderEditorHeader={({ draft, setDraft }) => (
        <IdentifierSelect
          draft={draft}
          setDraft={setDraft}
          disabled={disabled}
        />
      )}
      renderEditorBody={(params) => <WhatsAppEditorBody {...params} />}
      renderPreviewHeader={({ draft }) => (
        // Disabled mirror of the editor header, so the preview pane lines up
        // with the editor pane.
        <IdentifierSelect draft={draft} disabled />
      )}
      renderPreviewBody={({ rendered, draft }) => {
        if (draft.type !== ChannelType.WhatsApp) {
          return null;
        }
        const collect = (prefix: string, source: string[] | undefined) =>
          (source ?? []).map(
            (original, i) => rendered[`${prefix}.${i}`] ?? original,
          );
        return (
          <WhatsAppPreviewBody
            templateName={draft.templateName}
            languageCode={draft.languageCode}
            headerValues={collect("headerValues", draft.headerValues)}
            bodyValues={collect("bodyValues", draft.bodyValues)}
            buttonValues={rendered.buttonValues ?? draft.buttonValues ?? ""}
          />
        );
      }}
      draftToPreview={draftToPreview}
      fieldToReadable={fieldToReadable}
      mode={mode}
      defaultIsUserPropertiesMinimised={defaultIsUserPropertiesMinimised}
      hideUserPropertiesPanel={hideUserPropertiesPanel}
      hideEditor={hideEditor}
    />
  );
}
