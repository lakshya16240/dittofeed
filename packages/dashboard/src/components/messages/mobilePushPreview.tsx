import {
  Box,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import React, { useState } from "react";

import mobileMock from "../../../public/mobile-mock.svg";

const PLATFORMS = {
  Android: "Android",
  Ios: "iOS",
} as const;

type Platform = (typeof PLATFORMS)[keyof typeof PLATFORMS];

// The preview is best-effort: an unreachable or non-image URL should render as
// no image rather than a broken-image icon.
function isRenderableImage(url?: string): url is string {
  if (!url) {
    return false;
  }
  return (
    /^https?:\/\//.test(url) &&
    /\.(jpg|jpeg|png|webp|avif|gif|svg)(\?.*)?$/i.test(url)
  );
}

export default function MobilePushPreviewBody({
  title,
  body,
  imageUrl,
}: {
  title?: string;
  body?: string;
  imageUrl?: string;
}) {
  const [platform, setPlatform] = useState<Platform>(PLATFORMS.Android);
  const isIos = platform === PLATFORMS.Ios;

  return (
    <Stack
      sx={{ width: "100%", height: "100%", p: 1, overflow: "auto" }}
      alignItems="center"
      spacing={1}
    >
      <ToggleButtonGroup
        exclusive
        size="small"
        value={platform}
        onChange={(_event, value: Platform | null) => {
          if (value) {
            setPlatform(value);
          }
        }}
      >
        <ToggleButton value={PLATFORMS.Android}>Android</ToggleButton>
        <ToggleButton value={PLATFORMS.Ios}>iOS</ToggleButton>
      </ToggleButtonGroup>

      <Box
        sx={{
          position: "relative",
          width: 450,
          height: 855,
          flexShrink: 0,
          // Static import rather than a raw "/mobile-mock.svg": next.config.js
          // sets basePath "/dashboard", so a root-relative path 404s.
          backgroundImage: `url(${mobileMock.src})`,
          backgroundRepeat: "no-repeat",
          backgroundSize: "contain",
          backgroundPosition: "50% 0%",
        }}
      >
        <Box
          sx={{
            position: "absolute",
            top: 150,
            left: 0,
            right: 0,
            width: 380,
            mx: "auto",
            // The frame itself is an Android device; the iOS toggle restyles
            // the notification card rather than swapping the whole mock.
            backgroundColor: isIos ? "rgba(250,250,250,0.92)" : "#fff",
            backdropFilter: isIos ? "blur(8px)" : undefined,
            borderRadius: isIos ? "18px" : "28px",
            boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
            p: isIos ? "12px 14px" : "20px 16px",
            color: "#1a1a1a",
          }}
        >
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
          >
            <Typography
              variant="caption"
              sx={{
                opacity: 0.6,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              Your App
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              now
            </Typography>
          </Stack>
          <Typography
            variant={isIos ? "subtitle2" : "subtitle1"}
            sx={{ fontWeight: 600, mt: 0.5, wordBreak: "break-word" }}
          >
            {title || "Notification title"}
          </Typography>
          <Typography
            variant="body2"
            sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          >
            {body || "Notification body"}
          </Typography>
          {isRenderableImage(imageUrl) && (
            // A plain img, not next/image: the URL is author-templated and
            // arbitrary, so next/image would need remotePatterns and would add
            // a proxy hop for no benefit in a preview.
            <Box
              component="img"
              src={imageUrl}
              alt=""
              sx={{
                mt: 2,
                width: "100%",
                maxHeight: 160,
                objectFit: "cover",
                borderRadius: "16px",
                display: "block",
              }}
            />
          )}
        </Box>
      </Box>
    </Stack>
  );
}
