import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, View } from "react-native";

import type { ThreadActivity } from "../state/threadActivity";
import { useGraftPalette } from "../theme/tokens";

export function ThreadActivityIndicator({ activity }: { readonly activity: ThreadActivity }) {
  const palette = useGraftPalette();
  switch (activity) {
    case "working":
      return (
        <ActivityIndicator
          accessibilityLabel="Working"
          size="small"
          color={palette.foregroundSubtle}
        />
      );
    case "unread":
      return (
        <View
          accessibilityLabel="Unread response"
          style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.info }}
        />
      );
    case "needs_attention":
      return (
        <Ionicons
          accessibilityLabel="Needs attention"
          name="alert-circle-outline"
          size={18}
          color={palette.foregroundSubtle}
        />
      );
    case "idle":
      return null;
    default: {
      const unexpected: never = activity;
      return unexpected;
    }
  }
}
