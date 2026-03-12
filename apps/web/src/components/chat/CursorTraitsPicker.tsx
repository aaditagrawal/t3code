import {
  CURSOR_REASONING_OPTIONS,
  type CursorReasoningOption,
} from "@t3tools/contracts";
import {
  getCursorModelCapabilities,
  parseCursorModelSelection,
} from "@t3tools/shared/model";
import { memo, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";

export const CursorTraitsPicker = memo(function CursorTraitsPicker(props: {
  selection: ReturnType<typeof parseCursorModelSelection>;
  capabilities: ReturnType<typeof getCursorModelCapabilities>;
  disabled?: boolean;
  onReasoningChange: (reasoning: CursorReasoningOption) => void;
  onFastModeChange: (enabled: boolean) => void;
  onThinkingModeChange: (enabled: boolean) => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const reasoningLabelByOption: Record<CursorReasoningOption, string> = {
    low: "Low",
    normal: "Normal",
    high: "High",
    xhigh: "Extra High",
  };
  const traitSummary = [
    ...(props.capabilities.supportsReasoning
      ? [reasoningLabelByOption[props.selection.reasoning]]
      : []),
    ...(props.capabilities.supportsFast && props.selection.fast ? ["Fast"] : []),
    ...(props.capabilities.supportsThinking && props.selection.thinking ? ["Thinking"] : []),
  ];
  const triggerLabel = traitSummary.length > 0 ? traitSummary.join(" · ") : "Traits";

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={(open) => {
        if (props.disabled) {
          setIsMenuOpen(false);
          return;
        }
        setIsMenuOpen(open);
      }}
    >
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
            disabled={props.disabled}
          />
        }
      >
        <span>{triggerLabel}</span>
        <ChevronDownIcon aria-hidden="true" className="size-3 opacity-60" />
      </MenuTrigger>
      <MenuPopup align="start">
        {props.capabilities.supportsReasoning && (
          <MenuGroup>
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Reasoning</div>
            <MenuRadioGroup
              value={props.selection.reasoning}
              onValueChange={(value) => {
                if (props.disabled) return;
                if (!value) return;
                const nextReasoning = CURSOR_REASONING_OPTIONS.find((option) => option === value);
                if (!nextReasoning) return;
                props.onReasoningChange(nextReasoning);
              }}
            >
              {CURSOR_REASONING_OPTIONS.map((reasoning) => (
                <MenuRadioItem key={reasoning} value={reasoning}>
                  {reasoningLabelByOption[reasoning]}
                  {reasoning === "normal" ? " (default)" : ""}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
        )}
        {props.capabilities.supportsReasoning &&
          (props.capabilities.supportsFast || props.capabilities.supportsThinking) && (
            <MenuDivider />
          )}
        {props.capabilities.supportsFast && (
          <MenuGroup>
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Fast Mode</div>
            <MenuRadioGroup
              value={props.selection.fast ? "on" : "off"}
              onValueChange={(value) => {
                if (props.disabled) return;
                props.onFastModeChange(value === "on");
              }}
            >
              <MenuRadioItem value="off">off</MenuRadioItem>
              <MenuRadioItem value="on">on</MenuRadioItem>
            </MenuRadioGroup>
          </MenuGroup>
        )}
        {props.capabilities.supportsFast && props.capabilities.supportsThinking && <MenuDivider />}
        {props.capabilities.supportsThinking && (
          <MenuGroup>
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Thinking</div>
            <MenuRadioGroup
              value={props.selection.thinking ? "on" : "off"}
              onValueChange={(value) => {
                if (props.disabled) return;
                props.onThinkingModeChange(value === "on");
              }}
            >
              <MenuRadioItem value="off">off</MenuRadioItem>
              <MenuRadioItem value="on">on</MenuRadioItem>
            </MenuRadioGroup>
          </MenuGroup>
        )}
      </MenuPopup>
    </Menu>
  );
});
