import { formatFoodQuantity } from "@repo/macros-core/foods/display";
import type {
  MacrosFoodDetailResponse,
  MacrosVisionLabelFormat,
} from "@repo/schemas/macros";
import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { getLocales } from "expo-localization";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import {
  foodKeys,
  useCreateFood,
  useDeleteFood,
  useFoodDetail,
  useUpdateFood,
} from "@/api/foods";
import { confirmDestructive } from "@/features/more/shared/action-sheet";
import { errorMessage } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import { newClientMutationId } from "@/lib/ids";
import { useSinglePress } from "@/lib/use-single-press";
import {
  Button,
  colors,
  Icon,
  InlineNotice,
  parseDecimal,
  Row,
  Screen,
  Section,
  spacing,
  Text,
  TextField,
  VStack,
} from "@/ui";
import { SegmentedControl } from "@/ui/segmented-control";
import { toolbarText } from "@/ui/toolbar";
import { IconPicker } from "./components/icon-picker";
import {
  CoreNutrientFields,
  MoreNutrientFields,
} from "./components/nutrient-fields";
import {
  basisServing,
  emptyFoodForm,
  type FoodFormState,
  formFromDetail,
  newServingDraft,
  prefillFromLabel,
  type ServingDraft,
  toFoodPayload,
  withDisplay,
} from "./food-form";
import { clearLabelDraft, readLabelDraft } from "./label-draft";
import { repaintPlate } from "./plate-store";
import { forwardedTimeParams, readParam, useZone } from "./target";

const MAX_SERVINGS = 11;

type Notice = { tone: "error" | "info"; message: string };

function defaultLabelFormat(): MacrosVisionLabelFormat {
  return getLocales()[0]?.regionCode === "US" ? "us" : "eu";
}

export function CreateFoodScreen() {
  const params = useLocalSearchParams();
  const id = readParam(params.id);
  if (id) return <EditFood id={id} />;
  return <FoodForm mode={{ kind: "create" }} />;
}

function EditFood({ id }: { id: string }) {
  const detail = useFoodDetail(id);
  const zone = useZone();

  if (!detail.data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Edit food" }} />
        {detail.isError ? (
          <InlineNotice
            message={`Couldn’t load this food. ${errorMessage(detail.error)}`}
            action={{ label: "Retry", onPress: () => void detail.refetch() }}
          />
        ) : (
          <ActivityIndicator style={styles.loading} />
        )}
      </Screen>
    );
  }
  if (!detail.data.item.isUserFood) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Edit food" }} />
        <InlineNotice
          tone="info"
          message="Only foods you created can be edited. Create your own version instead."
        />
      </Screen>
    );
  }
  return (
    <FoodForm
      mode={{ kind: "edit", id, detail: detail.data }}
      initial={formFromDetail(detail.data, { energyUnit: zone.energyUnit })}
    />
  );
}

type Mode =
  | { kind: "create" }
  | { kind: "edit"; id: string; detail: MacrosFoodDetailResponse };

function FoodForm({ mode, initial }: { mode: Mode; initial?: FoodFormState }) {
  const params = useLocalSearchParams();
  const zone = useZone();
  const queryClient = useQueryClient();
  const createFood = useCreateFood();
  const updateFood = useUpdateFood();
  const deleteFood = useDeleteFood();
  const clientMutationId = useRef(newClientMutationId());

  const [setup] = useState(() => {
    if (initial) return { state: initial, notice: null, basisUncertain: false };
    const draft = readParam(params.draft) === "label" ? readLabelDraft() : null;
    const base = emptyFoodForm({
      barcode: readParam(params.barcode),
      energyUnit: zone.energyUnit,
      labelFormat: draft?.labelFormat ?? defaultLabelFormat(),
    });
    const named = { ...base, name: readParam(params.name) ?? "" };
    if (!draft) return { state: named, notice: null, basisUncertain: false };
    const prefill = prefillFromLabel(named, draft.label);
    const notice: Notice = {
      tone: prefill.warnings.length > 0 ? "error" : "info",
      message: [
        `${prefill.read} values read from the label. Check each against the package before saving.`,
        ...prefill.warnings,
      ].join(" "),
    };
    return {
      state: prefill.state,
      notice,
      basisUncertain: prefill.basisUncertain,
    };
  });
  const [state, setState] = useState<FoodFormState>(setup.state);
  const [notice, setNotice] = useState<Notice | null>(setup.notice);
  const [dirty, setDirty] = useState(setup.notice !== null);

  useEffect(() => {
    clearLabelDraft();
  }, []);

  const saving =
    createFood.isPending || updateFood.isPending || deleteFood.isPending;
  const editing = mode.kind === "edit";
  const basis = basisServing(state);
  const basisGrams = basis ? parseDecimal(basis.grams) : null;

  function change(next: FoodFormState) {
    setState(next);
    setDirty(true);
  }

  function updateServing(
    uid: string,
    patch: Partial<Omit<ServingDraft, "uid">>,
  ) {
    change({
      ...state,
      servings: state.servings.map((serving) =>
        serving.uid === uid ? { ...serving, ...patch } : serving,
      ),
    });
  }

  function cancel() {
    if (!dirty) {
      router.back();
      return;
    }
    if (Platform.OS === "android") {
      confirmDestructive({
        confirmLabel: "Discard changes",
        onConfirm: () => router.back(),
      });
      return;
    }
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ["Discard changes", "Keep editing"],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (index) => {
        if (index === 0) router.back();
      },
    );
  }

  async function save() {
    if (saving) return;
    const result = toFoodPayload(state);
    if (!result.ok) {
      haptics.error();
      setNotice({ tone: "error", message: result.message });
      return;
    }
    if (!onlineManager.isOnline()) {
      haptics.error();
      setNotice({
        tone: "error",
        message: "You’re offline. Connect to save this food.",
      });
      return;
    }
    setNotice(null);
    try {
      if (mode.kind === "edit") {
        const { item } = await updateFood.mutateAsync({
          id: mode.id,
          ...result.payload,
        });
        // Editing a food someone else created saves a copy with a new id.
        const ids = [mode.id, item.id];
        repaintPlate(
          (staged) =>
            staged.kind === "food" && ids.includes(staged.input.sourceItemId),
          item.iconKey,
        );
        haptics.success();
        router.back();
        return;
      }
      const created = await createFood.mutateAsync({
        ...result.payload,
        barcode: result.barcode,
        clientMutationId: clientMutationId.current,
      });
      const createdDetail: MacrosFoodDetailResponse = {
        item: created.item,
        nutrition: created.nutrition,
        localFoodId: created.localFoodId,
        snapshotId: created.snapshotId,
        createdSnapshot: true,
        fetchedAt: created.fetchedAt,
      };
      queryClient.setQueryData(foodKeys.detail(created.item.id), createdDetail);
      haptics.success();
      router.replace({
        pathname: "/food/[id]",
        params: {
          id: created.item.id,
          name: created.item.name,
          ...(created.sharingWithheld
            ? { withheld: created.sharingWithheld }
            : {}),
          ...forwardedTimeParams(params, zone.today),
        },
      });
    } catch (error) {
      haptics.error();
      setNotice({ tone: "error", message: errorMessage(error) });
    }
  }

  function confirmDelete() {
    if (mode.kind !== "edit") return;
    const id = mode.id;
    const title = `Delete ${state.name.trim() || "this food"}?`;
    const message = "Entries already logged keep their nutrition.";
    const remove = () =>
      deleteFood.mutate(id, {
        onSuccess: () => {
          haptics.success();
          router.back();
        },
        onError: (error) => {
          haptics.error();
          setNotice({ tone: "error", message: errorMessage(error) });
        },
      });
    if (Platform.OS === "android") {
      confirmDestructive({
        title,
        message,
        confirmLabel: "Delete food",
        onConfirm: remove,
      });
      return;
    }
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        message,
        options: ["Delete food", "Cancel"],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (index) => {
        if (index === 0) remove();
      },
    );
  }

  const basisValues = ["Per 100 g"];
  if (basis && basisGrams) {
    basisValues.push(
      `Per ${basis.label.trim()} (${formatFoodQuantity(basisGrams)} g)`,
    );
  }

  const saveOnce = useSinglePress(() => void save());
  return (
    <>
      <Stack.Screen
        options={{
          title: editing ? "Edit food" : "New food",
          gestureEnabled: !dirty,
        }}
      />
      <Stack.Toolbar placement="left">
        {toolbarText({
          onPress: cancel,
          children: "Cancel",
        })}
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        {toolbarText({
          variant: "done",
          disabled: saving,
          onPress: saveOnce,
          children: "Save",
        })}
      </Stack.Toolbar>

      <Screen automaticallyAdjustKeyboardInsets>
        <VStack gap={spacing.xxl}>
          {notice ? (
            <InlineNotice
              tone={notice.tone}
              message={notice.message}
              onDismiss={() => setNotice(null)}
            />
          ) : null}
          {saving ? <ActivityIndicator /> : null}

          <Section title="Food">
            <VStack gap={spacing.lg}>
              <TextField
                label="Name"
                value={state.name}
                onChangeText={(name) => change({ ...state, name })}
                placeholder="Greek yoghurt"
                autoCapitalize="sentences"
                autoFocus={!editing && state.name === ""}
                returnKeyType="next"
              />
              <TextField
                label="Brand"
                value={state.brand}
                onChangeText={(brand) => change({ ...state, brand })}
                placeholder="Optional"
                autoCapitalize="words"
              />
              {editing ? (
                state.barcode ? (
                  <Row
                    title="Barcode"
                    value={state.barcode}
                    separator={false}
                  />
                ) : null
              ) : (
                <TextField
                  label="Barcode"
                  value={state.barcode}
                  onChangeText={(barcode) => change({ ...state, barcode })}
                  placeholder="Optional"
                  keyboardType="number-pad"
                  hint={
                    state.barcode.trim()
                      ? "Shared with everyone who scans this barcode, without your name. Offensive or misleading foods are removed."
                      : undefined
                  }
                />
              )}
            </VStack>
          </Section>

          <Section title="Icon">
            <IconPicker
              value={state.iconKey}
              name={state.name}
              onChange={(iconKey) => change({ ...state, iconKey })}
            />
          </Section>

          <Section
            title="Servings"
            footer="Add the sizes you actually eat — a slice, a pot, a bar. Weights are in grams."
          >
            {state.servings.map((serving, index) => (
              <View key={serving.uid} style={styles.serving}>
                <TextField
                  containerStyle={styles.servingLabel}
                  value={serving.label}
                  onChangeText={(label) =>
                    updateServing(serving.uid, { label })
                  }
                  placeholder="1 slice"
                  accessibilityLabel={`Serving ${index + 1} name`}
                />
                <TextField
                  containerStyle={styles.servingGrams}
                  value={serving.grams}
                  onChangeText={(grams) =>
                    updateServing(serving.uid, { grams })
                  }
                  placeholder="30"
                  keyboardType="decimal-pad"
                  suffix="g"
                  accessibilityLabel={`Serving ${index + 1} weight in grams`}
                />
                <Pressable
                  onPress={() => {
                    haptics.light();
                    // Values typed per this serving are converted before it goes.
                    const wasBasis =
                      state.basis === "serving" && basis?.uid === serving.uid;
                    change({
                      ...(wasBasis
                        ? withDisplay(state, { basis: "100g" })
                        : state),
                      servings: state.servings.filter(
                        (item) => item.uid !== serving.uid,
                      ),
                    });
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove serving ${index + 1}`}
                >
                  <Icon
                    name="circle-minus"
                    size={22}
                    color={colors.destructive}
                  />
                </Pressable>
              </View>
            ))}
            {state.servings.length < MAX_SERVINGS ? (
              <Button
                label="Add serving"
                icon="circle-plus"
                variant="plain"
                size="regular"
                block={false}
                style={styles.addServing}
                onPress={() =>
                  change({
                    ...state,
                    servings: [...state.servings, newServingDraft("", "")],
                  })
                }
              />
            ) : null}
          </Section>

          <Section title="Nutrition">
            <VStack gap={spacing.md}>
              {basisValues.length > 1 ? (
                <SegmentedControl
                  values={basisValues}
                  selectedIndex={state.basis === "serving" ? 1 : 0}
                  onChange={({ nativeEvent }) => {
                    haptics.selection();
                    change(
                      withDisplay(state, {
                        basis:
                          nativeEvent.selectedSegmentIndex === 1
                            ? "serving"
                            : "100g",
                      }),
                    );
                  }}
                />
              ) : (
                <Text variant="footnote" tone="secondary">
                  Values per 100 g. Add a serving weight to enter them per
                  serving instead.
                </Text>
              )}
              {setup.basisUncertain ? (
                <InlineNotice
                  tone="info"
                  message="The label didn’t say whether these are per 100 g or per serving. Check the basis above."
                />
              ) : null}
              <CoreNutrientFields state={state} onChange={change} />
            </VStack>
          </Section>

          <Section
            title="More nutrients"
            footer="Optional. Leave anything the label doesn’t list empty — that is different from 0."
          >
            <MoreNutrientFields state={state} onChange={change} />
          </Section>

          {editing ? (
            <Button
              label="Delete food"
              variant="destructive"
              icon="trash"
              disabled={saving}
              onPress={confirmDelete}
            />
          ) : null}
        </VStack>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    paddingVertical: spacing.xxxl,
  },
  serving: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  servingLabel: {
    flex: 1,
  },
  servingGrams: {
    width: 96,
  },
  addServing: {
    alignSelf: "flex-start",
    marginTop: spacing.sm,
  },
});
