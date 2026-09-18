import type { GraftModelOption } from "@graft/mobile-contract";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

export interface ModelCatalogStatus {
  readonly loading: boolean;
  readonly error?: string;
}

const EMPTY_MODELS: readonly GraftModelOption[] = [];

/** Share one catalog request across composers; a response belongs to its paired session. */
export function useModelCatalog(
  sessionId: string | undefined,
  request: () => Promise<readonly GraftModelOption[]>,
) {
  const [catalog, setCatalog] = useState<{
    sessionId?: string;
    models: readonly GraftModelOption[];
    loading: boolean;
    error?: string;
  }>({ models: EMPTY_MODELS, loading: false });
  const generation = useRef(0);
  const currentSession = useRef<string | undefined>(undefined);
  const loadedSession = useRef<string | undefined>(undefined);
  const inFlight = useRef<{ sessionId: string; promise: Promise<void> } | undefined>(undefined);

  // Commit before the composers' passive discovery effects. A speculative
  // render for another session must not invalidate the currently mounted host.
  useLayoutEffect(() => {
    currentSession.current = sessionId;
    generation.current += 1;
    loadedSession.current = undefined;
    inFlight.current = undefined;
    return () => {
      currentSession.current = undefined;
      generation.current += 1;
      inFlight.current = undefined;
      loadedSession.current = undefined;
    };
  }, [sessionId]);

  const load = useCallback(
    (force = false): Promise<void> => {
      if (!sessionId || currentSession.current !== sessionId) return Promise.resolve();
      if (inFlight.current?.sessionId === sessionId) return inFlight.current.promise;
      if (!force && loadedSession.current === sessionId) return Promise.resolve();
      const active = generation.current;
      const isCurrent = () => active === generation.current && currentSession.current === sessionId;
      setCatalog((current) => ({
        sessionId,
        models: current.sessionId === sessionId ? current.models : EMPTY_MODELS,
        loading: true,
      }));
      const promise: Promise<void> = Promise.resolve()
        .then(() => (isCurrent() ? request() : EMPTY_MODELS))
        .then(
          (models) => {
            if (!isCurrent()) return;
            loadedSession.current = models.length ? sessionId : undefined;
            setCatalog({
              sessionId,
              models,
              loading: false,
              ...(models.length
                ? {}
                : { error: "No models available. Check Studio’s provider settings, then retry." }),
            });
          },
          () => {
            if (isCurrent())
              setCatalog((current) => ({
                ...current,
                loading: false,
                error: "Couldn’t load models. Reconnect to Studio and retry.",
              }));
          },
        )
        .finally(() => {
          if (inFlight.current?.promise === promise) inFlight.current = undefined;
        });
      inFlight.current = { sessionId, promise };
      return promise;
    },
    [sessionId, request],
  );

  return {
    models: catalog.sessionId === sessionId ? catalog.models : EMPTY_MODELS,
    loading: catalog.sessionId === sessionId && catalog.loading,
    error: catalog.sessionId === sessionId ? catalog.error : undefined,
    load,
  };
}
