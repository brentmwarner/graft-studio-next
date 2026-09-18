import { Ionicons } from "@expo/vector-icons";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { BackHandler, Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { graftRadius, useGraftPalette } from "../theme/tokens";
import { anchoredMenuLayout, type MenuAnchor } from "./anchoredMenuLayout";
import { FloatingSurface } from "./FloatingSurface";
import { MenuPortal } from "./MenuProvider";

function MenuOverlay({
  anchorRef,
  children,
  onClose,
}: {
  readonly anchorRef: RefObject<View | null>;
  readonly children: ReactNode;
  readonly onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const palette = useGraftPalette();
  const rootRef = useRef<View>(null);
  const [geometry, setGeometry] = useState<{
    anchor: MenuAnchor;
    width: number;
    top: number;
    bottom: number;
  }>();
  const [contentHeight, setContentHeight] = useState(0);
  const generation = useRef(0);

  const measure = useCallback(() => {
    const request = ++generation.current;
    rootRef.current?.measureInWindow((rootX, rootY, width, height) => {
      anchorRef.current?.measureInWindow((x, y, anchorWidth, anchorHeight) => {
        if (request !== generation.current || width <= 0 || height <= 0 || anchorWidth <= 0) return;
        const keyboardTop = Keyboard.metrics()?.screenY;
        setGeometry({
          anchor: { x: x - rootX, y: y - rootY, width: anchorWidth, height: anchorHeight },
          width,
          top: Math.max(12, insets.top - rootY + 8),
          bottom: Math.min(
            height - insets.bottom - 8,
            keyboardTop === undefined ? height : keyboardTop - rootY - 8,
          ),
        });
      });
    });
  }, [anchorRef, insets.bottom, insets.top]);

  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => back.remove();
  }, [onClose]);

  useEffect(() => {
    measure();
    const show = Keyboard.addListener("keyboardDidShow", measure);
    // The composer moves when Android dismisses its keyboard. Close the menu
    // with that dismissal so it cannot remain attached to the old position.
    const hide = Keyboard.addListener("keyboardDidHide", onClose);
    return () => {
      generation.current += 1;
      show.remove();
      hide.remove();
    };
  }, [measure, onClose]);

  const layout = geometry
    ? anchoredMenuLayout({
        anchor: geometry.anchor,
        viewportWidth: geometry.width,
        top: geometry.top,
        bottom: geometry.bottom,
        contentHeight: contentHeight || 520,
      })
    : undefined;

  return (
    <View
      ref={rootRef}
      collapsable={false}
      onLayout={measure}
      style={styles.overlay}
      accessibilityViewIsModal
    >
      <Pressable
        accessibilityLabel="Close menu"
        accessibilityRole="button"
        onPress={onClose}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[
          styles.position,
          { left: layout?.left ?? 12, top: layout?.top ?? 0, width: layout?.width ?? 280 },
          { opacity: geometry && contentHeight > 0 ? 1 : 0 },
        ]}
        onAccessibilityEscape={onClose}
      >
        <FloatingSurface
          style={[
            styles.menu,
            { height: layout?.height ?? 520, backgroundColor: palette.elevated },
          ]}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="always"
            showsVerticalScrollIndicator={false}
            onContentSizeChange={(_width, height) => setContentHeight(height)}
          >
            {children}
          </ScrollView>
        </FloatingSurface>
      </View>
    </View>
  );
}

export function AnchoredMenu({
  trigger,
  children,
  onOpenChange,
  openRequest,
}: {
  readonly trigger: (open: () => void) => ReactElement;
  readonly children: (close: () => void) => ReactNode;
  readonly onOpenChange?: (open: boolean) => void;
  readonly openRequest?: number;
}) {
  const id = useId();
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const consumedOpenRequest = useRef(openRequest);
  useEffect(() => {
    if (openRequest === undefined || consumedOpenRequest.current === openRequest) return;
    consumedOpenRequest.current = openRequest;
    setOpen(true);
    onOpenChange?.(true);
  }, [openRequest, onOpenChange]);
  const close = useCallback(() => {
    setOpen(false);
    onOpenChange?.(false);
  }, [onOpenChange]);

  return (
    <>
      <View ref={anchorRef} collapsable={false}>
        {trigger(() => {
          setOpen(true);
          onOpenChange?.(true);
        })}
      </View>
      {open ? (
        <MenuPortal id={id}>
          <MenuOverlay anchorRef={anchorRef} onClose={close}>
            {children(close)}
          </MenuOverlay>
        </MenuPortal>
      ) : null}
    </>
  );
}

export function MenuCaption({ children }: { readonly children: string }) {
  const palette = useGraftPalette();
  return <Text style={[styles.caption, { color: palette.foregroundSubtle }]}>{children}</Text>;
}

export function MenuItem({
  leading,
  icon,
  label,
  detail,
  selected,
  disclosure,
  enabled = true,
  onPress,
}: {
  readonly leading?: ReactNode;
  readonly icon?: ComponentProps<typeof Ionicons>["name"];
  readonly label: string;
  readonly detail?: string;
  readonly selected?: boolean;
  readonly disclosure?: boolean;
  readonly enabled?: boolean;
  readonly onPress: () => void;
}) {
  const palette = useGraftPalette();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityHint={detail}
      accessibilityRole="menuitem"
      accessibilityState={{ selected, disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.item,
        {
          backgroundColor: pressed || selected ? palette.subtle : "transparent",
          opacity: enabled ? 1 : 0.45,
        },
      ]}
    >
      {leading ?? (icon ? <Ionicons color={palette.foregroundMuted} name={icon} size={20} /> : null)}
      <View style={styles.copy}>
        <Text style={[styles.label, { color: palette.foreground }]}>{label}</Text>
        {detail ? (
          <Text style={[styles.detail, { color: palette.foregroundSubtle }]}>{detail}</Text>
        ) : null}
      </View>
      {selected || disclosure ? (
        <Ionicons
          color={palette.foregroundMuted}
          name={selected ? "checkmark" : "chevron-forward"}
          size={18}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 100 },
  position: { position: "absolute" },
  menu: { borderRadius: graftRadius.large, overflow: "hidden" },
  content: { padding: 7, gap: 2 },
  caption: {
    fontSize: 12,
    fontWeight: "500",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 7,
  },
  item: {
    minHeight: 44,
    borderRadius: graftRadius.medium,
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  copy: { flex: 1, gap: 4 },
  label: { fontSize: 14, fontWeight: "500", lineHeight: 19 },
  detail: { fontSize: 12, lineHeight: 17 },
});
