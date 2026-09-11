import type { GraftApprovalPolicyOption, GraftModelOption } from "@graft/mobile-contract";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { BottomSheet } from "../../components/BottomSheet";
import { PressScale } from "../../components/PressScale";
import { graftRadius, useGraftPalette } from "../../theme/tokens";
import { displayName } from "./displayName";
import { PickerRow } from "./PickerRow";

export function ComposerActionsSheet({
  hasApprovalOptions,
  onClose,
  onOpenApproval,
  onOpenModel,
  visible,
}: {
  readonly hasApprovalOptions: boolean;
  readonly onClose: () => void;
  readonly onOpenApproval: () => void;
  readonly onOpenModel: () => void;
  readonly visible: boolean;
}) {
  return (
    <BottomSheet onClose={onClose} title="Composer options" visible={visible}>
      <View style={styles.pickerList}>
        <PickerRow
          detail="Model and reasoning effort"
          label="Intelligence"
          onPress={() => {
            onClose();
            onOpenModel();
          }}
          selected={false}
        />
        {hasApprovalOptions ? (
          <PickerRow
            detail="Control what the agent can change"
            label="Permissions"
            onPress={() => {
              onClose();
              onOpenApproval();
            }}
            selected={false}
          />
        ) : null}
      </View>
    </BottomSheet>
  );
}

export function ApprovalPickerSheet({
  currentApproval,
  onClose,
  onSelect,
  options,
  visible,
}: {
  readonly currentApproval: string | undefined;
  readonly onClose: () => void;
  readonly onSelect: (policy: string) => void;
  readonly options: readonly GraftApprovalPolicyOption[];
  readonly visible: boolean;
}) {
  return (
    <BottomSheet onClose={onClose} title="Permissions" visible={visible}>
      <ScrollView contentContainerStyle={styles.pickerList}>
        {options.map((option) => (
          <PickerRow
            key={option.value}
            detail={option.description}
            label={option.label}
            onPress={() => {
              onClose();
              onSelect(option.value);
            }}
            selected={option.value === currentApproval}
          />
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

export function ModelPickerSheet({
  currentModel,
  efforts,
  models,
  onClose,
  onSelectEffort,
  onSelectModel,
  resolvedEffort,
  visible,
}: {
  readonly currentModel: GraftModelOption | undefined;
  readonly efforts: readonly string[];
  readonly models: readonly GraftModelOption[];
  readonly onClose: () => void;
  readonly onSelectEffort: (effort: string) => void;
  readonly onSelectModel: (model: GraftModelOption) => void;
  readonly resolvedEffort: string | undefined;
  readonly visible: boolean;
}) {
  const palette = useGraftPalette();
  return (
    <BottomSheet onClose={onClose} title="Model" visible={visible}>
      <ScrollView contentContainerStyle={styles.pickerList}>
        {models.map((model) => (
          <PickerRow
            detail={model.providerLabel ?? displayName(model.providerId)}
            key={`${model.providerId}:${model.id}`}
            label={model.label}
            onPress={() => {
              onSelectModel(model);
            }}
            selected={model.id === currentModel?.id && model.providerId === currentModel.providerId}
          />
        ))}
        {efforts.length > 0 ? (
          <View style={styles.effortSection}>
            <Text style={[styles.sectionLabel, { color: palette.foregroundSubtle }]}>
              Reasoning effort
            </Text>
            <View style={styles.effortOptions}>
              {efforts.map((effort) => (
                <PressScale
                  accessibilityLabel={`${displayName(effort)} reasoning effort`}
                  key={effort}
                  onPress={() => onSelectEffort(effort)}
                >
                  <View
                    style={[
                      styles.effortPill,
                      {
                        backgroundColor:
                          effort === resolvedEffort ? palette.foreground : palette.subtle,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.effortText,
                        {
                          color:
                            effort === resolvedEffort
                              ? palette.background
                              : palette.foregroundMuted,
                        },
                      ]}
                    >
                      {displayName(effort)}
                    </Text>
                  </View>
                </PressScale>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  pickerList: { paddingBottom: 12, paddingHorizontal: 18 },
  effortSection: { gap: 10, paddingBottom: 8, paddingTop: 22 },
  sectionLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.7 },
  effortOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  effortPill: {
    borderRadius: graftRadius.pill,
    justifyContent: "center",
    minHeight: 34,
    paddingHorizontal: 13,
  },
  effortText: { fontSize: 13, fontWeight: "600" },
});
