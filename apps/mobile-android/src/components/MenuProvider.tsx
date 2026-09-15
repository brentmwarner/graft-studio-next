import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { StyleSheet, View } from "react-native";

interface MenuEntry {
  readonly id: string;
  readonly content: ReactNode;
}
interface MenuPortalActions {
  readonly show: (entry: MenuEntry) => void;
  readonly hide: (id: string) => void;
}
const MenuPortalContext = createContext<MenuPortalActions | null>(null);

/** Keeps menus in the app window so opening one preserves the composer keyboard. */
export function MenuProvider({ children }: PropsWithChildren) {
  const [entry, setEntry] = useState<MenuEntry | null>(null);
  const actions = useMemo<MenuPortalActions>(() => ({
    show: setEntry,
    hide: (id) => setEntry((current) => current?.id === id ? null : current),
  }), []);

  return (
    <MenuPortalContext.Provider value={actions}>
      <View style={styles.root}>
        <View style={styles.root} collapsable={false} importantForAccessibility={entry ? "no-hide-descendants" : "auto"}>
          {children}
        </View>
        {entry?.content}
      </View>
    </MenuPortalContext.Provider>
  );
}

export function MenuPortal({ id, children }: PropsWithChildren<{ readonly id: string }>) {
  const actions = useContext(MenuPortalContext);
  if (!actions) throw new Error("Menus must be inside MenuProvider.");

  useLayoutEffect(() => {
    actions.show({ id, content: children });
  }, [actions, children, id]);
  useLayoutEffect(() => () => actions.hide(id), [actions, id]);
  return null;
}

const styles = StyleSheet.create({ root: { flex: 1 } });
