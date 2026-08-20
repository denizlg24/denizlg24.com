export async function captureVideoFrame(
  video: HTMLVideoElement,
  maxDimension = 1800,
): Promise<Blob> {
  if (
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    video.videoWidth <= 0 ||
    video.videoHeight <= 0
  ) {
    throw new Error("The camera is not ready yet");
  }

  const scale = Math.min(
    1,
    maxDimension / Math.max(video.videoWidth, video.videoHeight),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image capture is not supported");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Could not capture the nutrition label")),
      "image/jpeg",
      0.88,
    );
  });
}
