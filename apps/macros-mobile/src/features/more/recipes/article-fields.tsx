import type { MacrosRecipeImageUploadResponse } from "@repo/schemas/macros";
import { File, UploadType } from "expo-file-system";
import { launchImageLibraryAsync } from "expo-image-picker";
import { useRef, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from "react-native";
import { RecipePhoto } from "@/components/recipe-photo";
import { ApiError, api } from "@/lib/api";
import {
  Button,
  colors,
  Hairline,
  Section,
  spacing,
  Text,
  TextField,
  VStack,
} from "@/ui";
import { prepareBodyPhoto } from "../body/prepare-photo";
import { showActionSheet } from "../shared/action-sheet";
import {
  type DraftBlock,
  type DraftStep,
  draftKey,
  emptyBlock,
  minutesValid,
  type RecipeArticleDraft,
} from "./article-draft";

export type { RecipeArticleDraft } from "./article-draft";

const serif = Platform.select({ ios: "Georgia", default: "serif" });

type PhotoTarget =
  | { kind: "cover" }
  | { kind: "story" }
  | { kind: "step"; stepKey: string };

async function uploadPhoto(): Promise<MacrosRecipeImageUploadResponse | null> {
  const result = await launchImageLibraryAsync({
    mediaTypes: "images",
    quality: 1,
    exif: false,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  const prepared = await prepareBodyPhoto(asset);
  try {
    if (new File(prepared.uri).size > 3_000_000)
      throw new Error("This photo is too large. Choose a smaller image.");
    const reservation = await api<MacrosRecipeImageUploadResponse>(
      "/api/recipes/images",
      { method: "POST" },
    );
    if (!reservation.uploadUrl)
      throw new Error("The upload could not be started. Try again.");
    const uploaded = await new File(prepared.uri).upload(
      reservation.uploadUrl,
      {
        httpMethod: "PUT",
        uploadType: UploadType.BINARY_CONTENT,
        headers: { "Content-Type": "image/jpeg" },
        sessionType: "foreground",
      },
    );
    if (uploaded.status < 200 || uploaded.status >= 300)
      throw new ApiError(
        uploaded.status,
        "The image could not be uploaded. Try again.",
        [],
      );
    return reservation;
  } finally {
    try {
      new File(prepared.uri).delete();
    } catch {}
  }
}

function move<T>(rows: readonly T[], index: number, offset: -1 | 1) {
  const next = [...rows];
  const [item] = next.splice(index, 1);
  if (item === undefined) return next;
  next.splice(index + offset, 0, item);
  return next;
}

export function ArticleFields({
  value,
  onChange,
  onBusyChange,
  onError,
}: {
  value: RecipeArticleDraft;
  onChange: (next: RecipeArticleDraft) => void;
  onBusyChange: (busy: boolean) => void;
  onError: (error: unknown) => void;
}) {
  const [uploading, setUploading] = useState<string | null>(null);
  const busy = useRef(false);
  const current = useRef(value);
  current.current = value;
  const update = (changes: Partial<RecipeArticleDraft>) =>
    onChange({ ...current.current, ...changes });
  const updateStep = (stepKey: string, changes: Partial<DraftStep>) =>
    update({
      steps: current.current.steps.map((step) =>
        step.key === stepKey ? { ...step, ...changes } : step,
      ),
    });

  async function photo(target: PhotoTarget) {
    if (busy.current) return;
    busy.current = true;
    const marker = target.kind === "step" ? target.stepKey : target.kind;
    setUploading(marker);
    onBusyChange(true);
    try {
      const uploaded = await uploadPhoto();
      if (!uploaded) return;
      if (target.kind === "cover") {
        update({
          coverImageKey: uploaded.storageKey,
          coverImageUrl: uploaded.previewUrl,
        });
        return;
      }
      const block: DraftBlock = {
        key: draftKey(),
        type: "image",
        imageKey: uploaded.storageKey,
        imageUrl: uploaded.previewUrl,
        caption: "",
      };
      if (target.kind === "story") {
        update({ story: [...current.current.story, block] });
      } else {
        const step = current.current.steps.find(
          (item) => item.key === target.stepKey,
        );
        if (step) updateStep(step.key, { blocks: [...step.blocks, block] });
      }
    } catch (error) {
      onError(error);
    } finally {
      busy.current = false;
      setUploading(null);
      onBusyChange(false);
    }
  }

  const locked = uploading !== null;

  return (
    <VStack gap={spacing.xxl}>
      <View>
        {value.coverImageUrl ? (
          <View style={styles.cover}>
            <RecipePhoto url={value.coverImageUrl} label="Recipe cover" />
            <View style={styles.inlineActions}>
              <TextAction
                label="Change cover"
                disabled={locked}
                onPress={() => void photo({ kind: "cover" })}
              />
              <TextAction
                label="Remove"
                disabled={locked}
                onPress={() =>
                  update({ coverImageKey: null, coverImageUrl: null })
                }
              />
            </View>
          </View>
        ) : (
          <TextAction
            label={uploading === "cover" ? "Uploading photo…" : "+ Cover photo"}
            disabled={locked}
            onPress={() => void photo({ kind: "cover" })}
          />
        )}
        <TextInput
          accessibilityLabel="Subtitle"
          placeholder="A line about the dish"
          placeholderTextColor={colors.placeholder}
          value={value.description}
          maxLength={600}
          multiline
          onChangeText={(description) =>
            update({ description: description.replace(/\n/g, " ") })
          }
          style={styles.subtitle}
        />
      </View>

      <Section
        title="Story"
        footer="**bold**, _italic_ and [links](https://…) are kept as formatting."
      >
        <BlockList
          blocks={value.story}
          locked={locked}
          placeholder="Tell the story of this dish…"
          uploading={uploading === "story"}
          onChange={(story) => update({ story })}
          onAddPhoto={() => void photo({ kind: "story" })}
        />
      </Section>

      <Section title="Timing">
        <View style={styles.timing}>
          <TextField
            label="Prep"
            suffix="min"
            keyboardType="number-pad"
            value={value.prepMinutes}
            error={
              minutesValid(value.prepMinutes) ? undefined : "Whole minutes"
            }
            onChangeText={(prepMinutes) => update({ prepMinutes })}
            containerStyle={styles.timingField}
          />
          <TextField
            label="Cook"
            suffix="min"
            keyboardType="number-pad"
            value={value.cookMinutes}
            error={
              minutesValid(value.cookMinutes) ? undefined : "Whole minutes"
            }
            onChangeText={(cookMinutes) => update({ cookMinutes })}
            containerStyle={styles.timingField}
          />
        </View>
      </Section>

      <Section title="Method">
        <VStack gap={spacing.xl}>
          {value.steps.map((step, index) => (
            <View key={step.key} style={styles.step}>
              <View style={styles.stepHead}>
                <Text variant="footnote" tone="secondary" eyebrow>
                  Step {index + 1}
                </Text>
                <TextAction
                  label="Edit"
                  disabled={locked}
                  onPress={() =>
                    showActionSheet({
                      actions: [
                        ...(index > 0
                          ? [
                              {
                                label: "Move up",
                                onPress: () =>
                                  update({
                                    steps: move(
                                      current.current.steps,
                                      index,
                                      -1,
                                    ),
                                  }),
                              },
                            ]
                          : []),
                        ...(index < value.steps.length - 1
                          ? [
                              {
                                label: "Move down",
                                onPress: () =>
                                  update({
                                    steps: move(
                                      current.current.steps,
                                      index,
                                      1,
                                    ),
                                  }),
                              },
                            ]
                          : []),
                        {
                          label: "Delete step",
                          destructive: true,
                          onPress: () =>
                            update({
                              steps: current.current.steps.filter(
                                (item) => item.key !== step.key,
                              ),
                            }),
                        },
                      ],
                    })
                  }
                />
              </View>
              <TextInput
                accessibilityLabel={`Step ${index + 1} title`}
                placeholder="Step title"
                placeholderTextColor={colors.placeholder}
                value={step.title}
                maxLength={160}
                onChangeText={(title) => updateStep(step.key, { title })}
                style={styles.stepTitle}
              />
              <BlockList
                blocks={step.blocks}
                locked={locked}
                placeholder="What happens in this step?"
                uploading={uploading === step.key}
                onChange={(blocks) => updateStep(step.key, { blocks })}
                onAddPhoto={() =>
                  void photo({ kind: "step", stepKey: step.key })
                }
              />
            </View>
          ))}
          <Button
            label="Add step"
            icon="plus"
            variant="tinted"
            size="regular"
            disabled={locked || value.steps.length >= 60}
            onPress={() =>
              update({
                steps: [
                  ...current.current.steps,
                  {
                    key: draftKey(),
                    title: "",
                    blocks: [emptyBlock("paragraph")],
                  },
                ],
              })
            }
          />
        </VStack>
      </Section>

      <Section
        title="Publishing"
        footer={
          value.isPublished
            ? "Saving publishes this recipe and its photos on macros.denizlg24.com, in Recipes and at its own link."
            : "Private to you until you publish it."
        }
      >
        <View style={styles.publishing}>
          <Text variant="body" style={styles.flex}>
            Publish recipe
          </Text>
          <Switch
            accessibilityLabel="Publish recipe"
            value={value.isPublished}
            onValueChange={(isPublished) => update({ isPublished })}
          />
        </View>
      </Section>
    </VStack>
  );
}

const BLOCK_LABELS: Record<DraftBlock["type"], string> = {
  paragraph: "Text",
  heading: "Heading",
  quote: "Quote",
  list: "List",
  image: "Photo",
};

function BlockList({
  blocks,
  locked,
  placeholder,
  uploading,
  onChange,
  onAddPhoto,
}: {
  blocks: readonly DraftBlock[];
  locked: boolean;
  placeholder: string;
  uploading: boolean;
  onChange: (next: DraftBlock[]) => void;
  onAddPhoto: () => void;
}) {
  const latest = useRef(blocks);
  latest.current = blocks;
  const replace = (key: string, edit: (block: DraftBlock) => DraftBlock) =>
    onChange(
      latest.current.map((block) => (block.key === key ? edit(block) : block)),
    );

  function actions(block: DraftBlock, index: number) {
    const convert = (type: "paragraph" | "heading" | "quote") => ({
      label: `Make ${BLOCK_LABELS[type].toLowerCase()}`,
      onPress: () =>
        onChange(
          latest.current.map((item) =>
            item.key === block.key && item.type !== "image"
              ? { key: item.key, type, text: item.text }
              : item,
          ),
        ),
    });
    showActionSheet({
      actions: [
        ...(block.type !== "image"
          ? (["paragraph", "heading", "quote"] as const)
              .filter((type) => type !== block.type)
              .map(convert)
          : []),
        ...(block.type === "list"
          ? [
              {
                label: block.ordered ? "Use bullets" : "Number the items",
                onPress: () =>
                  replace(block.key, (item) =>
                    item.type === "list"
                      ? { ...item, ordered: !item.ordered }
                      : item,
                  ),
              },
            ]
          : []),
        ...(index > 0
          ? [
              {
                label: "Move up",
                onPress: () => onChange(move(latest.current, index, -1)),
              },
            ]
          : []),
        ...(index < blocks.length - 1
          ? [
              {
                label: "Move down",
                onPress: () => onChange(move(latest.current, index, 1)),
              },
            ]
          : []),
        {
          label: "Delete",
          destructive: true,
          onPress: () =>
            onChange(latest.current.filter((item) => item.key !== block.key)),
        },
      ],
    });
  }

  return (
    <VStack gap={spacing.md}>
      {blocks.map((block, index) => (
        <View key={block.key} style={styles.block}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${BLOCK_LABELS[block.type]} options`}
            disabled={locked}
            hitSlop={8}
            onPress={() => actions(block, index)}
            style={styles.blockLabel}
          >
            <Text variant="caption2" tone="tertiary" eyebrow>
              {BLOCK_LABELS[block.type]}
              {block.type === "list" && block.ordered ? " · numbered" : ""} ···
            </Text>
          </Pressable>
          {block.type === "image" ? (
            <View style={styles.figure}>
              {block.imageUrl ? (
                <RecipePhoto
                  url={block.imageUrl}
                  label={block.caption || "Recipe photo"}
                />
              ) : null}
              <TextInput
                accessibilityLabel="Photo caption"
                placeholder="Caption (optional)"
                placeholderTextColor={colors.placeholder}
                value={block.caption}
                maxLength={500}
                onChangeText={(caption) =>
                  replace(block.key, (item) =>
                    item.type === "image" ? { ...item, caption } : item,
                  )
                }
                style={styles.caption}
              />
            </View>
          ) : (
            <TextInput
              accessibilityLabel={BLOCK_LABELS[block.type]}
              placeholder={
                block.type === "list"
                  ? "One item per line"
                  : block.type === "heading"
                    ? "Heading"
                    : index === 0
                      ? placeholder
                      : "Write…"
              }
              placeholderTextColor={colors.placeholder}
              value={block.text}
              multiline={block.type !== "heading"}
              maxLength={block.type === "heading" ? 200 : 20_000}
              onChangeText={(text) =>
                replace(block.key, (item) =>
                  item.type === "image" ? item : { ...item, text },
                )
              }
              style={[
                styles.prose,
                block.type === "heading" && styles.heading,
                block.type === "quote" && styles.quote,
              ]}
            />
          )}
        </View>
      ))}
      <Hairline />
      <View style={styles.inserts}>
        {(["paragraph", "heading", "list", "quote"] as const).map((type) => (
          <TextAction
            key={type}
            label={`+ ${BLOCK_LABELS[type]}`}
            disabled={locked}
            onPress={() => onChange([...latest.current, emptyBlock(type)])}
          />
        ))}
        <TextAction
          label={uploading ? "Uploading…" : "+ Photo"}
          disabled={locked}
          onPress={onAddPhoto}
        />
      </View>
    </VStack>
  );
}

function TextAction({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.textAction,
        (pressed || disabled) && styles.dimmed,
      ]}
    >
      <Text variant="subheadline" tone="secondary">
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cover: { gap: spacing.sm },
  inlineActions: { flexDirection: "row", gap: spacing.lg },
  subtitle: {
    marginTop: spacing.md,
    fontSize: 19,
    lineHeight: 25,
    color: colors.secondaryLabel,
    padding: 0,
  },
  timing: { flexDirection: "row", gap: spacing.lg },
  timingField: { flex: 1 },
  step: { gap: spacing.sm },
  stepHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  stepTitle: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "700",
    color: colors.label,
    padding: 0,
  },
  block: { gap: spacing.xs },
  blockLabel: { alignSelf: "flex-start" },
  prose: {
    fontFamily: serif,
    fontSize: 18,
    lineHeight: 27,
    color: colors.label,
    padding: 0,
    textAlignVertical: "top",
  },
  heading: {
    fontFamily: undefined,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "700",
  },
  quote: {
    fontStyle: "italic",
    paddingLeft: spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: colors.label,
  },
  figure: { gap: spacing.xs },
  caption: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.secondaryLabel,
    textAlign: "center",
    padding: 0,
  },
  inserts: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.lg },
  textAction: { paddingVertical: spacing.xs },
  dimmed: { opacity: 0.4 },
  publishing: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  flex: { flex: 1 },
});
