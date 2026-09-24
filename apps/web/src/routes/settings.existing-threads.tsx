import { createFileRoute } from "@tanstack/react-router";
import { ExistingThreadsPanel } from "../components/settings/ExistingThreadsPanel";
export const Route = createFileRoute("/settings/existing-threads")({
  component: ExistingThreadsPanel,
});
