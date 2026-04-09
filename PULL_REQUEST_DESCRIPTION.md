# Pull Request Description: Gemini CLI Enhancements & Persistence Improvements

This PR introduces several significant improvements to the Gemini CLI provider, core orchestration persistence, and overall system reliability.

## Key Changes

### 1. Gemini CLI Provider Enhancements
- **Improved Server Management:** Refined `geminiCliServerManager.ts` for more robust lifecycle management of the Gemini CLI process.
- **Enhanced Testing:** Expanded test coverage for `geminiCliServerManager.test.ts` to ensure reliable behavior across different runtime scenarios.
- **Provider Kind Normalization:** Added internal `providerKind.ts` and `providerModelOptions.ts` to unify how different providers are handled across the system.

### 2. Persistence Layer Upgrades
- **Robust Event Sourcing:** Optimized `OrchestrationEventStore.ts` for better reliability when persisting and retrieving orchestration events.
- **Database Migrations:**
  - `020_NormalizeLegacyProviderKinds.ts`: Migration to normalize provider kind names in existing databases.
  - `021_RepairProjectionThreadProposedPlanImplementationColumns.ts`: Fix for missing or inconsistent columns in thread projections.
- **Session Management:** Improved `ProviderSessionDirectory.ts` to more accurately track active and stale provider sessions.

### 3. UI/UX Refinements
- **Settings Enhancements:** Updated `SettingsPanels.tsx` and `SettingsPanels.browser.tsx` to provide a more intuitive configuration experience for custom model slugs and themes.
- **Model Picker Improvements:** Refined `ProviderModelPicker.tsx` (and added logic tests) for smoother provider and model selection in the chat view.
- **Sidebar Updates:** Minor UI tweaks to `sidebar.tsx` for better alignment and styling.

### 4. Core System Improvements
- **Command Path Resolution:** Added `commandPath.ts` to centralize and improve how CLI binary paths are resolved.
- **Type Safety:** Updated `packages/contracts/src/model.ts` and `packages/shared/src/model.ts` to reflect the improved provider and event structures.
- **Shell Utilities:** Refined `packages/shared/src/shell.ts` for more reliable command execution across different platforms.

## Why These Changes?
These updates were driven by a need for more reliable Gemini CLI integration and better persistence for long-running orchestration sessions. The migrations ensure that existing users' data is correctly transitioned to the new, more consistent internal models.

## Verification Results
- **Unit Tests:** All updated tests in `apps/server` and `apps/web` pass.
- **Manual Verification:** Verified the new Gemini CLI flow and the updated settings UI in both desktop and web modes.
- **Database Migrations:** Successfully ran and verified the new migrations on a test database.

---
*Maintained by [mtdewwolf](https://github.com/mtdewwolf) | Forked from [aaditagrawal/t3code](https://github.com/aaditagrawal/t3code)*
