import type {
  MacrosBodyMeasurementResponse,
  MacrosBodyOverview,
  MacrosBodyOverviewResponse,
  MacrosBodyPhotoAngle,
  MacrosBodyPhotoCompleteResponse,
  MacrosBodyPhotoListItem,
  MacrosBodyPhotosResponse,
  MacrosBodyPhotoUploadResponse,
  MacrosDailyActivityResponse,
  MacrosHydrationResponse,
  macrosBodyMeasurementBodySchema,
  macrosBodyPhotoCompleteBodySchema,
  macrosBodyPhotoUploadBodySchema,
  macrosDailyActivityBodySchema,
  macrosHydrationBodySchema,
} from "@repo/schemas/macros";
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { File, UploadType } from "expo-file-system";
import type { z } from "zod";
import { ApiError, api, apiVoid } from "@/lib/api";
import { queryKeys } from "./keys";

export type BodyOverview = MacrosBodyOverview;
export type BodyPhoto = MacrosBodyPhotoListItem;
export type BodyPhotoAngle = MacrosBodyPhotoAngle;
export type MeasurementInput = z.input<typeof macrosBodyMeasurementBodySchema>;
export type ActivityInput = z.input<typeof macrosDailyActivityBodySchema>;
export type HydrationInput = z.input<typeof macrosHydrationBodySchema>;
type PhotoUploadInput = z.input<typeof macrosBodyPhotoUploadBodySchema>;
type PhotoCompleteInput = z.input<typeof macrosBodyPhotoCompleteBodySchema>;

export const bodyKeys = {
  overview: [...queryKeys.body, "overview"] as const,
  photos: [...queryKeys.body, "photos"] as const,
  photosAt: (angle: BodyPhotoAngle) =>
    [...queryKeys.body, "photos", angle] as const,
};

const ML_PER_OZ = 29.5735;

/** Measurements, activity, hydration and habits for the last 90 days. */
export function useBodyOverview() {
  return useQuery({
    queryKey: bodyKeys.overview,
    queryFn: ({ signal }) =>
      api<MacrosBodyOverviewResponse>("/api/body/overview", { signal }).then(
        (body) => body.overview,
      ),
  });
}

function invalidateOverview(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: bodyKeys.overview });
}

/** One value per site per day: posting the same day again replaces it. */
export function useAddMeasurement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: MeasurementInput) =>
      api<MacrosBodyMeasurementResponse>("/api/body/measurements", {
        method: "POST",
        body,
      }),
    onSuccess: () => invalidateOverview(queryClient),
  });
}

/** Upserts the manual row for the day; an imported row for the same day is kept. */
export function useUpsertActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ActivityInput) =>
      api<MacrosDailyActivityResponse>("/api/body/activity", {
        method: "POST",
        body,
      }),
    onSuccess: () => invalidateOverview(queryClient),
  });
}

const hydrationKey = [...queryKeys.body, "hydration"] as const;

/** Adds to the day's total at once so rapid taps on a quick-add button all count. */
export function useAddHydration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: hydrationKey,
    mutationFn: (body: HydrationInput) =>
      api<MacrosHydrationResponse>("/api/body/hydration", {
        method: "POST",
        body,
      }),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: bodyKeys.overview });
      const previous = queryClient.getQueryData<BodyOverview>(
        bodyKeys.overview,
      );
      if (previous) {
        const addedMl =
          body.unit === "oz" ? body.volume * ML_PER_OZ : body.volume;
        const hasDay = previous.hydration.some(
          (entry) => entry.logDate === body.logDate,
        );
        queryClient.setQueryData<BodyOverview>(bodyKeys.overview, {
          ...previous,
          hydration: hasDay
            ? previous.hydration.map((entry) =>
                entry.logDate === body.logDate
                  ? { ...entry, volumeMl: entry.volumeMl + addedMl }
                  : entry,
              )
            : [
                ...previous.hydration,
                { logDate: body.logDate, volumeMl: addedMl },
              ],
        });
      }
      return { previous };
    },
    onError: (_error, _body, context) => {
      if (context?.previous) {
        queryClient.setQueryData(bodyKeys.overview, context.previous);
      }
    },
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: hydrationKey }) === 1) {
        return invalidateOverview(queryClient);
      }
      return undefined;
    },
  });
}

/** Newest weigh-in first; each photo belongs to the weigh-in it was taken with. */
export function useBodyPhotos(angle: BodyPhotoAngle) {
  return useQuery({
    queryKey: bodyKeys.photosAt(angle),
    queryFn: ({ signal }) =>
      api<MacrosBodyPhotosResponse>("/api/body/photos", {
        query: { angle },
        signal,
      }).then((body) => body.photos),
    // Download URLs are presigned for 15 minutes.
    staleTime: 10 * 60_000,
  });
}

/** A JPEG already downscaled and stripped of metadata on the device. */
export interface PreparedBodyPhoto {
  uri: string;
  width: number;
  height: number;
  sha256: string;
}

async function uploadBodyPhoto({
  angle,
  photo,
}: {
  angle: BodyPhotoAngle;
  photo: PreparedBodyPhoto;
}) {
  const reservation = await api<MacrosBodyPhotoUploadResponse>(
    "/api/body/photos",
    {
      method: "POST",
      body: { angle, mimeType: "image/jpeg" } satisfies PhotoUploadInput,
    },
  );

  // The URL is presigned for exactly this Content-Type; the bytes go straight
  // to object storage and never pass through the app server.
  const uploaded = await new File(photo.uri).upload(reservation.uploadUrl, {
    httpMethod: "PUT",
    uploadType: UploadType.BINARY_CONTENT,
    headers: { "Content-Type": "image/jpeg" },
    sessionType: "foreground",
  });
  if (uploaded.status < 200 || uploaded.status >= 300) {
    throw new ApiError(uploaded.status, "The photo could not be uploaded.", []);
  }

  const complete: PhotoCompleteInput = {
    storageKey: reservation.storageKey,
    angle,
    width: photo.width,
    height: photo.height,
    sha256: photo.sha256,
    capturedAt: new Date().toISOString(),
  };
  return api<MacrosBodyPhotoCompleteResponse>("/api/body/photos", {
    method: "PUT",
    body: complete,
  }).then((body) => body.photo);
}

/**
 * Reserve a presigned URL, PUT the bytes, then confirm. The server attaches
 * the photo to the latest weigh-in and refuses (409) when there is none.
 */
export function useUploadBodyPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    // The prepared file lives in the cache directory; a paused upload replayed
    // after a relaunch could find it gone, so an offline attempt fails at once.
    networkMode: "always",
    mutationFn: uploadBodyPhoto,
    onSuccess: (_photo, { angle }) =>
      queryClient.invalidateQueries({ queryKey: bodyKeys.photosAt(angle) }),
  });
}

/** Deletes the stored object as well as the row. */
export function useDeleteBodyPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; angle: BodyPhotoAngle }) =>
      apiVoid(`/api/body/photos/${id}`, { method: "DELETE" }),
    onMutate: async ({ id, angle }) => {
      const key = bodyKeys.photosAt(angle);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<BodyPhoto[]>(key);
      if (previous) {
        queryClient.setQueryData<BodyPhoto[]>(
          key,
          previous.filter((photo) => photo.id !== id),
        );
      }
      return { previous };
    },
    onError: (_error, { angle }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(bodyKeys.photosAt(angle), context.previous);
      }
    },
    onSettled: (_data, _error, { angle }) =>
      queryClient.invalidateQueries({ queryKey: bodyKeys.photosAt(angle) }),
  });
}
