import type { ApprovalRequestId, ProviderApprovalDecision } from "@t3tools/contracts";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import type { PendingApproval } from "../../lib/threadActivity";

export interface PendingApprovalCardProps {
  readonly approval: PendingApproval;
  readonly respondingApprovalId: ApprovalRequestId | null;
  readonly onRespond: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
}

export function PendingApprovalCard(props: PendingApprovalCardProps) {
  // Opaque for the same reason as PendingUserInputCard: nothing blurs the feed
  // behind this card, so a translucent surface bleeds messages through it.
  return (
    <View className="gap-2.5 rounded-2xl border border-border bg-card-alt p-4 dark:border-white/6 dark:bg-card-alt">
      <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-info-foreground">
        Approval needed
      </Text>
      <Text className="font-t3-bold text-lg text-foreground">{props.approval.requestKind}</Text>
      {props.approval.detail ? (
        <Text className="font-sans text-sm leading-normal text-foreground-muted">
          {props.approval.detail}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-2.5">
        <Pressable
          className="items-center justify-center rounded-xl bg-info-strong px-3.5 py-3"
          disabled={props.respondingApprovalId === props.approval.requestId}
          onPress={() => void props.onRespond(props.approval.requestId, "accept")}
        >
          <Text className="font-t3-extrabold text-sm text-white">Allow once</Text>
        </Pressable>
        <Pressable
          className="items-center justify-center rounded-xl bg-subtle-strong px-3.5 py-3 dark:bg-subtle-strong"
          disabled={props.respondingApprovalId === props.approval.requestId}
          onPress={() => void props.onRespond(props.approval.requestId, "acceptForSession")}
        >
          <Text className="font-t3-bold text-sm text-foreground">Allow session</Text>
        </Pressable>
        <Pressable
          className="items-center justify-center rounded-xl bg-danger px-3.5 py-3 dark:bg-danger"
          disabled={props.respondingApprovalId === props.approval.requestId}
          onPress={() => void props.onRespond(props.approval.requestId, "decline")}
        >
          <Text className="font-t3-bold text-sm text-danger-foreground">Decline</Text>
        </Pressable>
      </View>
    </View>
  );
}
