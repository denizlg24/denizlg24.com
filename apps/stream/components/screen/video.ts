type CompatibilityFormat = "h264" | "vp8";
export type ScreenVideoFormat = "auto" | CompatibilityFormat;

const formats = {
  h264: { width: 1280, height: 720, maxBitrate: 2_500_000 },
  vp8: { width: 960, height: 540, maxBitrate: 1_500_000 },
} satisfies Record<
  CompatibilityFormat,
  { width: number; height: number; maxBitrate: number }
>;

const frameRate = 24;

export function screenCaptureOptions(
  format: ScreenVideoFormat,
): DisplayMediaStreamOptions {
  if (format === "auto") {
    return {
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: true,
    };
  }
  const { width, height } = formats[format];
  return {
    video: {
      width: { ideal: width, max: width },
      height: { ideal: height, max: height },
      frameRate: { ideal: frameRate, max: frameRate },
    },
    audio: true,
  };
}

function isBaselineH264(codec: RTCRtpCodec) {
  if (codec.mimeType.toLowerCase() !== "video/h264") return false;
  const profile = /(?:^|;)\s*profile-level-id=([a-f\d]{6})(?:;|$)/i.exec(
    codec.sdpFmtpLine ?? "",
  )?.[1];
  // An omitted profile-level-id defaults to Constrained Baseline.
  return (
    !profile ||
    /^(42[4567cdef]0|4d[89abcdef]0|58[cdef]0)[a-f\d]{2}$/i.test(profile)
  );
}

export function addScreenVideo(
  peer: RTCPeerConnection,
  video: MediaStreamTrack,
  capture: MediaStream,
  format: ScreenVideoFormat,
): RTCRtpTransceiver {
  const settings = video.getSettings();
  // Window and tab sharing keep the browser's normal negotiation.
  // Entire displays can exceed a TV's decoder limits, especially on Retina Macs.
  const selected =
    format === "auto" && settings.displaySurface === "monitor"
      ? "h264"
      : format;
  const senderOptions: RTCRtpTransceiverInit = {
    direction: "sendonly",
    streams: [capture],
  };
  if (selected === "auto") return peer.addTransceiver(video, senderOptions);
  const { width, height, maxBitrate } = formats[selected];
  const transceiver = peer.addTransceiver(video, {
    ...senderOptions,
    sendEncodings: [
      {
        maxBitrate,
        maxFramerate: frameRate,
        scaleResolutionDownBy: Math.max(
          1,
          (settings.width ?? width) / width,
          (settings.height ?? height) / height,
        ),
      },
    ],
  });
  if (typeof transceiver.setCodecPreferences !== "function") return transceiver;

  const available = RTCRtpSender.getCapabilities?.("video")?.codecs ?? [];
  const h264 = available.filter(isBaselineH264);
  const vp8 = available.filter(
    (codec) => codec.mimeType.toLowerCase() === "video/vp8",
  );
  const preferred = selected === "h264" && h264.length ? h264 : vp8;
  if (preferred.length) {
    // Keep repair codecs available so packet loss can be recovered normally.
    const repair = available.filter((codec) =>
      ["video/rtx", "video/red", "video/ulpfec"].includes(
        codec.mimeType.toLowerCase(),
      ),
    );
    transceiver.setCodecPreferences([...preferred, ...repair]);
  }
  return transceiver;
}
