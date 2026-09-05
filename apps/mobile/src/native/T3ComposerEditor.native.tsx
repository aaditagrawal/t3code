import { collectComposerInlineTokens } from "@t3tools/shared/composerInlineTokens";
import { requireNativeView } from "expo";
import { TextInputWrapper } from "expo-paste-input";
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Ref,
} from "react";
import type { NativeSyntheticEvent, ViewProps } from "react-native";
import { Image, StyleSheet } from "react-native";

import { markdownFileIconSource } from "@t3tools/mobile-markdown-text/file-icons";
import { resolveMarkdownFileIcon } from "@t3tools/mobile-markdown-text/links";
import { MOBILE_TYPOGRAPHY } from "../lib/typography";
import { useNativePaste } from "../lib/useNativePaste";
import { useFontFamily } from "../lib/useFontFamily";
import { useUniwindTheme } from "../lib/useUniwindTheme";
import {
  createComposerRevisionStore,
  isComposerNativeEcho,
  resolveComposerControlledEventCount,
} from "./composerEditorRevision";
import type { ComposerEditorProps, ComposerEditorSelection } from "./T3ComposerEditor.types";

const NATIVE_MODULE_NAME = "T3ComposerEditor";
const EMPTY_SKILLS: NonNullable<ComposerEditorProps["skills"]> = [];

type NativeEditorEvent = NativeSyntheticEvent<{
  readonly value: string;
  readonly selection: ComposerEditorSelection;
  readonly eventCount: number;
}>;

type NativeSelectionEvent = NativeSyntheticEvent<{
  readonly value: string;
  readonly selection: ComposerEditorSelection;
  readonly eventCount: number;
}>;

type NativePasteImagesEvent = NativeSyntheticEvent<{
  readonly uris: ReadonlyArray<string>;
}>;

interface NativeComposerEditorRef {
  focus: () => Promise<void>;
  blur: () => Promise<void>;
  setSelection: (start: number, end: number) => Promise<void>;
}

interface NativeComposerEditorProps extends ViewProps {
  readonly ref?: Ref<NativeComposerEditorRef>;
  readonly controlledDocumentJson: string;
  readonly themeJson: string;
  readonly placeholder: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly contentInsetVertical: number;
  readonly singleLineCentered: boolean;
  readonly editable: boolean;
  readonly scrollEnabled: boolean;
  readonly autoFocus: boolean;
  readonly autoCorrect: boolean;
  readonly spellCheck: boolean;
  readonly onComposerChange: (event: NativeEditorEvent) => void;
  readonly onComposerSelectionChange?: (event: NativeSelectionEvent) => void;
  readonly onComposerPasteImages?: (event: NativePasteImagesEvent) => void;
  readonly onComposerFocus?: () => void;
  readonly onComposerBlur?: () => void;
}

const NativeView = requireNativeView<NativeComposerEditorProps>(NATIVE_MODULE_NAME);

function basename(path: string): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separator >= 0 ? path.slice(separator + 1) : path;
}

function fileIconUri(path: string): string {
  return Image.resolveAssetSource(markdownFileIconSource(resolveMarkdownFileIcon(path))).uri;
}

export function ComposerEditor({
  ref,
  skills = EMPTY_SKILLS,
  selection,
  style,
  textStyle,
  onChangeText,
  onSelectionChange,
  onPasteImages,
  onFocus,
  onBlur,
  contentInsetVertical = 0,
  ...props
}: ComposerEditorProps) {
  const nativeRef = useRef<NativeComposerEditorRef>(null);
  const [revisionStore] = useState(createComposerRevisionStore);
  const { eventCount: mostRecentEventCount, events: nativeEventSnapshots } = useSyncExternalStore(
    revisionStore.subscribe,
    revisionStore.getSnapshot,
    revisionStore.getSnapshot,
  );
  const [confirmedTokens, setConfirmedTokens] = useState(() => ({
    value: props.value,
    tokens: collectComposerInlineTokens(props.value),
  }));
  let tokens = confirmedTokens.tokens;
  if (confirmedTokens.value !== props.value) {
    tokens = collectComposerInlineTokens(props.value, {
      preserveTrailingFrom: confirmedTokens.tokens,
    });
    setConfirmedTokens({ value: props.value, tokens });
  }
  const theme = useUniwindTheme();
  const handlePaste = useNativePaste((uris) => onPasteImages?.(uris));

  useImperativeHandle(
    ref,
    () => ({
      focus: () => void nativeRef.current?.focus(),
      blur: () => void nativeRef.current?.blur(),
      setSelection: (nextSelection) =>
        void nativeRef.current?.setSelection(nextSelection.start, nextSelection.end),
    }),
    [],
  );

  const skillLabels = useMemo(
    () => new Map(skills.map((skill) => [skill.name, skill.displayName?.trim() || skill.name])),
    [skills],
  );
  const tokensJson = useMemo(() => {
    return JSON.stringify(
      tokens.map((token) => ({
        type: token.type,
        source: token.source,
        start: token.start,
        end: token.end,
        label:
          token.type === "skill"
            ? (skillLabels.get(token.value) ?? token.value)
            : basename(token.value),
        iconUri: token.type === "mention" ? fileIconUri(token.value) : null,
      })),
    );
  }, [tokens, skillLabels]);
  // Every render resolves against the snapshot history, so a render whose
  // (value, selection) lags the acknowledged native state is stamped behind
  // the native revision and rejected by the editor instead of re-applying a
  // stale caret or stale text mid-typing.
  const controlledEventCount = resolveComposerControlledEventCount(
    props.value,
    selection ?? null,
    mostRecentEventCount,
    nativeEventSnapshots,
  );
  const acknowledgesLatestNativeEvent = isComposerNativeEcho(
    props.value,
    selection ?? null,
    mostRecentEventCount,
    nativeEventSnapshots,
  );
  const isNativeEcho =
    controlledEventCount === mostRecentEventCount && acknowledgesLatestNativeEvent;
  const controlledDocumentJson = JSON.stringify({
    value: props.value,
    selection: isNativeEcho ? null : (selection ?? null),
    tokensJson,
    mostRecentEventCount: controlledEventCount,
    isNativeEcho,
  });
  useEffect(() => {
    if (acknowledgesLatestNativeEvent) revisionStore.prune(mostRecentEventCount);
  }, [acknowledgesLatestNativeEvent, mostRecentEventCount, revisionStore]);
  const assumedValue = props.value;
  useEffect(() => {
    if (!isNativeEcho) revisionStore.assume(controlledEventCount, assumedValue);
  }, [assumedValue, controlledEventCount, isNativeEcho, revisionStore]);
  const acceptNativeEvent = revisionStore.accept;
  const themeJson = JSON.stringify({
    text: theme["--color-foreground"],
    placeholder: theme["--color-placeholder"],
    chipBackground: theme["--color-subtle"],
    chipBorder: theme["--color-border"],
    chipText: theme["--color-foreground"],
    skillBackground: theme["--color-inline-skill-background"],
    skillBorder: theme["--color-inline-skill-border"],
    skillText: theme["--color-inline-skill-foreground"],
    fileTint: theme["--color-icon-muted"],
  });
  const resolvedTextStyle = StyleSheet.flatten(textStyle) ?? {};
  const regularFontFamily = useFontFamily("regular");
  return (
    <TextInputWrapper onPaste={handlePaste} style={[{ minHeight: 0 }, style]}>
      <NativeView
        ref={nativeRef}
        controlledDocumentJson={controlledDocumentJson}
        themeJson={themeJson}
        placeholder={props.placeholder ?? ""}
        fontFamily={
          typeof resolvedTextStyle.fontFamily === "string"
            ? resolvedTextStyle.fontFamily
            : regularFontFamily
        }
        fontSize={
          typeof resolvedTextStyle.fontSize === "number"
            ? resolvedTextStyle.fontSize
            : MOBILE_TYPOGRAPHY.body.fontSize
        }
        lineHeight={
          typeof resolvedTextStyle.lineHeight === "number"
            ? resolvedTextStyle.lineHeight
            : MOBILE_TYPOGRAPHY.body.lineHeight
        }
        contentInsetVertical={contentInsetVertical}
        singleLineCentered={props.singleLineCentered ?? false}
        editable={(props.editable ?? true) && !(props.readOnly ?? false)}
        scrollEnabled={props.scrollEnabled ?? true}
        autoFocus={props.autoFocus ?? false}
        autoCorrect={props.autoCorrect ?? true}
        spellCheck={props.spellCheck ?? true}
        style={{ flex: 1, minHeight: 0 }}
        onComposerChange={(event) => {
          const acknowledgedEventCount = acceptNativeEvent(
            event.nativeEvent.eventCount,
            event.nativeEvent.value,
            event.nativeEvent.selection,
          );
          if (acknowledgedEventCount === false) return;
          onChangeText(event.nativeEvent.value);
          onSelectionChange?.(event.nativeEvent.selection);
        }}
        onComposerSelectionChange={(event) => {
          const acknowledgedEventCount = acceptNativeEvent(
            event.nativeEvent.eventCount,
            event.nativeEvent.value,
            event.nativeEvent.selection,
          );
          if (acknowledgedEventCount === false) return;
          // Android emits the selection change mid-mutation, before the change
          // event, so the payload can carry post-edit text. It must reach the
          // parent alongside the acknowledged revision, or the next render
          // stamps the stale draft at that revision and can re-apply it over
          // the newer native text.
          if (event.nativeEvent.value !== props.value) {
            onChangeText(event.nativeEvent.value);
          }
          onSelectionChange?.(event.nativeEvent.selection);
        }}
        onComposerPasteImages={(event) => onPasteImages?.(event.nativeEvent.uris)}
        onComposerFocus={onFocus}
        onComposerBlur={onBlur}
      />
    </TextInputWrapper>
  );
}

export type {
  ComposerEditorHandle,
  ComposerEditorProps,
  ComposerEditorSelection,
} from "./T3ComposerEditor.types";
