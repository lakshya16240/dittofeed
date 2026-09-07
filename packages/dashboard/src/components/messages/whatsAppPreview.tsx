import { Box, Stack, Typography, useTheme } from "@mui/material";

export interface WhatsAppPreviewProps {
  templateName: string;
  languageCode: string;
  headerValues: string[];
  bodyValues: string[];
  buttonValues: string;
}

function parseButtons(raw: string): string[] {
  if (!raw.trim()) {
    return [];
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [];
    }
    return Object.entries(parsed)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([index, value]) =>
        Array.isArray(value)
          ? `Button ${index}: ${value.join(", ")}`
          : `Button ${index}`,
      );
  } catch {
    return [];
  }
}

/**
 * Renders what will actually be sent.
 *
 * The message copy itself lives in the approved template on the provider's
 * side, so it cannot be shown here. What the author needs to check is which
 * value lands in which numbered placeholder -- getting that order wrong is the
 * failure mode this channel exists to prevent -- so parameters are listed
 * against their {{1}}, {{2}} positions rather than inlined into prose.
 */
export default function WhatsAppPreviewBody({
  templateName,
  languageCode,
  headerValues,
  bodyValues,
  buttonValues,
}: WhatsAppPreviewProps) {
  const theme = useTheme();
  const buttons = parseButtons(buttonValues);
  const isDark = theme.palette.mode === "dark";

  return (
    <Stack
      sx={{
        height: "100%",
        p: 3,
        // The familiar WhatsApp chat ground, so the preview reads as a phone
        // rather than as a form.
        backgroundColor: isDark ? "#0b141a" : "#e5ddd5",
        overflowY: "auto",
      }}
      alignItems="flex-start"
    >
      <Box
        sx={{
          maxWidth: "90%",
          minWidth: "60%",
          backgroundColor: isDark ? "#005c4b" : "#d9fdd3",
          color: isDark ? "#e9edef" : "#111b21",
          borderRadius: "8px",
          borderTopLeftRadius: 0,
          p: 1.5,
          boxShadow: "0 1px 0.5px rgba(11,20,26,.13)",
        }}
      >
        <Stack spacing={1}>
          <Stack
            direction="row"
            spacing={1}
            alignItems="baseline"
            sx={{ flexWrap: "wrap" }}
          >
            <Typography
              variant="caption"
              sx={{ fontWeight: 700, letterSpacing: "0.02em" }}
            >
              {templateName || "(no template name)"}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.7 }}>
              {languageCode}
            </Typography>
          </Stack>

          {headerValues.length > 0 && (
            <Box
              sx={{
                backgroundColor: isDark
                  ? "rgba(255,255,255,0.06)"
                  : "rgba(0,0,0,0.05)",
                borderRadius: "6px",
                p: 1,
              }}
            >
              <Typography
                variant="caption"
                sx={{ opacity: 0.7, display: "block" }}
              >
                Header
              </Typography>
              {headerValues.map((value, i) => (
                <Typography
                  // eslint-disable-next-line react/no-array-index-key
                  key={i}
                  variant="body2"
                  sx={{ wordBreak: "break-all" }}
                >
                  {value || "(empty)"}
                </Typography>
              ))}
            </Box>
          )}

          {bodyValues.length > 0 ? (
            <Stack spacing={0.5}>
              {bodyValues.map((value, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <Stack direction="row" spacing={1} key={i}>
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: "monospace",
                      opacity: 0.6,
                      flexShrink: 0,
                    }}
                  >
                    {`{{${i + 1}}}`}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      // An empty parameter is rejected by the provider, so
                      // make it obvious rather than showing blank space.
                      opacity: value.trim() ? 1 : 0.5,
                      fontStyle: value.trim() ? "normal" : "italic",
                    }}
                  >
                    {value.trim() ? value : "(empty — this will fail)"}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" sx={{ opacity: 0.6 }}>
              No body parameters.
            </Typography>
          )}

          {buttons.length > 0 && (
            <Stack
              spacing={0.5}
              sx={{
                borderTop: `1px solid ${
                  isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)"
                }`,
                pt: 1,
              }}
            >
              {buttons.map((label) => (
                <Typography
                  key={label}
                  variant="body2"
                  sx={{
                    color: isDark ? "#53bdeb" : "#027eb5",
                    textAlign: "center",
                  }}
                >
                  {label}
                </Typography>
              ))}
            </Stack>
          )}
        </Stack>
      </Box>

      <Typography
        variant="caption"
        sx={{
          mt: 2,
          color: isDark ? "rgba(233,237,239,0.6)" : "rgba(17,27,33,0.6)",
        }}
      >
        Message copy comes from the approved template on the provider. Only the
        parameters above are supplied by Dittofeed.
      </Typography>
    </Stack>
  );
}
