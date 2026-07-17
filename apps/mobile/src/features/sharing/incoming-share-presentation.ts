export interface IncomingSharePresentationState {
  readonly presentedShareId: string | null;
  readonly dismissedShareId: string | null;
}

export interface IncomingSharePresentationTransition {
  readonly state: IncomingSharePresentationState;
  readonly shareIdToPresent: string | null;
}

export const EMPTY_INCOMING_SHARE_PRESENTATION_STATE: IncomingSharePresentationState = {
  presentedShareId: null,
  dismissedShareId: null,
};

/**
 * Tracks presentation by durable share id rather than object identity. A user
 * dismissal suppresses only that inbox item until it is consumed, replaced, or
 * revived by a fresh native handoff with the same id.
 */
export function transitionIncomingSharePresentation(
  state: IncomingSharePresentationState,
  input: {
    readonly isShareSheetPresented: boolean;
    readonly pendingShareId: string | null;
    /** Cleared dismissal when ingest acknowledges a fresh native handoff. */
    readonly revivedShareId?: string | null;
  },
): IncomingSharePresentationTransition {
  if (input.isShareSheetPresented) {
    if (state.presentedShareId !== null && input.pendingShareId !== state.presentedShareId) {
      // Consumption may happen while the sheet remains mounted. Forget the
      // old presentation immediately so a later handoff may reuse its id.
      return {
        state: EMPTY_INCOMING_SHARE_PRESENTATION_STATE,
        shareIdToPresent: null,
      };
    }
    return { state, shareIdToPresent: null };
  }

  let nextState = state;
  if (state.presentedShareId !== null) {
    if (input.pendingShareId === state.presentedShareId) {
      return {
        state: {
          presentedShareId: null,
          dismissedShareId: state.presentedShareId,
        },
        shareIdToPresent: null,
      };
    }
    nextState = { ...state, presentedShareId: null };
  }

  if (input.pendingShareId === null) {
    return {
      state: EMPTY_INCOMING_SHARE_PRESENTATION_STATE,
      shareIdToPresent: null,
    };
  }

  if (
    input.revivedShareId !== null &&
    input.revivedShareId !== undefined &&
    input.revivedShareId === input.pendingShareId &&
    nextState.dismissedShareId === input.pendingShareId
  ) {
    nextState = { ...nextState, dismissedShareId: null };
  }

  if (nextState.dismissedShareId === input.pendingShareId) {
    return { state: nextState, shareIdToPresent: null };
  }

  return {
    state: {
      presentedShareId: input.pendingShareId,
      dismissedShareId: null,
    },
    shareIdToPresent: input.pendingShareId,
  };
}
