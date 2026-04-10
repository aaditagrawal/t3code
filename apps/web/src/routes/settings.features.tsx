import { createFileRoute } from "@tanstack/react-router";

import { FeaturesSettingsPanel } from "../components/settings/FeaturesPanels";

export const Route = createFileRoute("/settings/features")({
  component: FeaturesSettingsPanel,
});
