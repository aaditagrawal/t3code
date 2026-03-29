import * as Schema from "effect/Schema";
import { useCallback, useEffect, useRef, useState } from "react";

function getStorage(): Storage {
  if (typeof window !== "undefined") {
    try {
      const storage = window.localStorage;
      if (storage) {
        return storage;
      }
    } catch {
      // localStorage blocked (e.g. sandboxed iframe, privacy mode)
    }
  }
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (_) => store.get(_) ?? null,
    key: (index) => {
      if (index < 0 || index >= store.size) return null;
      return Array.from(store.keys())[index] ?? null;
    },
    get length() {
      return store.size;
    },
    removeItem: (_) => {
      store.delete(_);
    },
    setItem: (_, value) => {
      store.set(_, value);
    },
  };
}

let _storage: Storage | undefined;
function resolveStorage(): Storage {
  return (_storage ??= getStorage());
}

const decode = <T, E>(schema: Schema.Codec<T, E>, value: string) =>
  Schema.decodeSync(Schema.fromJsonString(schema))(value);

const encode = <T, E>(schema: Schema.Codec<T, E>, value: T) =>
  Schema.encodeSync(Schema.fromJsonString(schema))(value);

export const getLocalStorageItem = <T, E>(key: string, schema: Schema.Codec<T, E>): T | null => {
  const item = resolveStorage().getItem(key);
  return item ? decode(schema, item) : null;
};

export const setLocalStorageItem = <T, E>(key: string, value: T, schema: Schema.Codec<T, E>) => {
  const valueToSet = encode(schema, value);
  resolveStorage().setItem(key, valueToSet);
};

export const removeLocalStorageItem = (key: string) => {
  resolveStorage().removeItem(key);
};

const LOCAL_STORAGE_CHANGE_EVENT = "t3code:local_storage_change";

interface LocalStorageChangeDetail {
  key: string;
}

function dispatchLocalStorageChange(key: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<LocalStorageChangeDetail>(LOCAL_STORAGE_CHANGE_EVENT, {
      detail: { key },
    }),
  );
}

export function useLocalStorage<T, E>(
  key: string,
  initialValue: T,
  schema: Schema.Codec<T, E>,
): [T, (value: T | ((val: T) => T)) => void] {
  // Get the initial value from localStorage or use the provided initialValue
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = getLocalStorageItem(key, schema);
      return item ?? initialValue;
    } catch (error) {
      console.error("[LOCALSTORAGE] Error:", error);
      return initialValue;
    }
  });

  // Return a wrapped version of useState's setter function that persists the new value to localStorage.
  // Persistence is done outside the setState updater to avoid side-effects that React StrictMode replays.
  const setValue = useCallback((value: T | ((val: T) => T)) => {
    try {
      setStoredValue((prev) => {
        const valueToStore = typeof value === "function" ? (value as (val: T) => T)(prev) : value;
        return valueToStore;
      });
    } catch (error) {
      console.error("[LOCALSTORAGE] Error:", error);
    }
  }, []);

  // Persist to localStorage whenever storedValue changes.
  // Use a flag to prevent self-triggered local-change events from causing a feedback loop.
  const isInitialMount = useRef(true);
  const isSelfDispatch = useRef(false);
  const prevKeyRef = useRef(key);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    // Skip persistence during key transitions — the key-sync effect below
    // will establish the correct storedValue for the new key first.
    if (prevKeyRef.current !== key) {
      return;
    }
    try {
      // Compare encoded values to avoid dispatching when the serialized form hasn't changed.
      // This prevents cross-instance ping-pong loops when multiple hooks share the same key
      // (re-decoded objects create new references, triggering the effect again).
      const currentRaw = resolveStorage().getItem(key);
      const nextRaw = storedValue === null ? null : encode(schema, storedValue);
      if (storedValue === null) {
        removeLocalStorageItem(key);
      } else if (nextRaw !== currentRaw) {
        resolveStorage().setItem(key, nextRaw!);
      } else {
        // Value unchanged — skip dispatch entirely
        return;
      }
      isSelfDispatch.current = true;
      dispatchLocalStorageChange(key);
    } catch (error) {
      console.error("[LOCALSTORAGE] Error:", error);
    }
  }, [storedValue, key, schema]);

  // Re-sync from localStorage when key changes
  useEffect(() => {
    if (prevKeyRef.current !== key) {
      prevKeyRef.current = key;
      try {
        const newValue = getLocalStorageItem(key, schema);
        setStoredValue(newValue ?? initialValue);
      } catch (error) {
        console.error("[LOCALSTORAGE] Error:", error);
      }
    }
  }, [key, initialValue, schema]);

  // Listen for storage events from other tabs AND custom events from the same tab
  useEffect(() => {
    const syncFromStorage = () => {
      try {
        const newValue = getLocalStorageItem(key, schema);
        setStoredValue(newValue ?? initialValue);
      } catch (error) {
        console.error("[LOCALSTORAGE] Error:", error);
      }
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === key) {
        syncFromStorage();
      }
    };

    const handleLocalChange = (event: CustomEvent<LocalStorageChangeDetail>) => {
      if (event.detail.key === key) {
        if (isSelfDispatch.current) {
          isSelfDispatch.current = false;
          return;
        }
        syncFromStorage();
      }
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener(LOCAL_STORAGE_CHANGE_EVENT, handleLocalChange as EventListener);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener(LOCAL_STORAGE_CHANGE_EVENT, handleLocalChange as EventListener);
    };
  }, [key, initialValue, schema]);

  return [storedValue, setValue];
}
