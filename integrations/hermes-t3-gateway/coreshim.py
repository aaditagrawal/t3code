"""In-process compensation for two upstream `send_message` media defects.

Both defects live in Hermes core's `tools/send_message_tool.py` and both are
about plugin platforms that *can* carry media but are not on core's hard-coded
prose list. Line numbers below are against **Hermes v0.19.0**.

**Bug A — the false warning (cosmetic, but it lies to the agent).**
`tools/send_message_tool.py:1108-1113` precomputes::

    warning = f"MEDIA attachments were omitted for {platform.value}; ..."

whenever `media_files` is non-empty and the platform is not one of the nine
names spelled out in that string. Line 1154-1157 then appends it to *any*
successful result without ever consulting whether the send actually dropped
anything. Our standalone sender delivers media as `media.deliver` frames and
waits for the acks — and is then told, in the same JSON blob, that the files
were omitted. A live agent read that warning and reported a delivery failure to
the user for files T3 had already rendered.

**Bug B — the silent drop (the one that actually loses data).**
`tools/send_message_tool.py:711-732`: when the gateway is co-resident, the
runner weakref resolves and `runner.adapters.get(platform)` returns our live
adapter, so core calls::

    result = await adapter.send(chat_id=chat_id, content=chunk, metadata=metadata)

and returns. `media_files` is never passed. It cannot be recovered from
`content` either, because `BasePlatformAdapter.extract_media`
(`tools/send_message_tool.py:442`) already stripped the `MEDIA:` directives out
of the text before chunking. So `send_message` / `hermes send` with attachments,
run in the same process as `hermes gateway`, loses the files with no error and
no warning. This went unnoticed in live testing only because `hermes send` ran
out-of-process, where the runner weakref is empty and core falls through to the
`standalone_sender_fn` path (line 731+), which does pass `media_files`.

**What this module does.** At plugin load it wraps the two functions in the
already-imported `tools.send_message_tool` module object:

* `_send_via_adapter` — for platform `t3` with non-empty `media_files`, skip
  core's live-adapter shortcut entirely and call our own `standalone_send`
  (from `.home`), which handles media correctly. Text-only `t3` sends and every
  other platform reach the original function untouched.
* `_send_to_platform` — post-process the result, dropping the Bug A warning from
  `result["warnings"]`. Matched by the stable prefix `"MEDIA attachments were
  omitted for t3"`, never the full prose: the nine-platform list inside that
  sentence changes between releases, and matching it exactly would silently
  stop working on the next upgrade.

**Removable.** Both wrappers become dead weight the moment upstream grows
capability-driven media handling — i.e. once `PlatformEntry` can advertise
"this platform delivers media" and core consults it instead of the hard-coded
list, and once the co-resident branch forwards `media_files` to `adapter.send`.
Delete this module and its `register()` call at that point; nothing else in the
plugin depends on it.

**Fail-open contract.** This module never raises into the plugin's `register()`
and never makes a working Hermes worse:

* Every patch feature-detects its target first — the module must be importable,
  the attribute must exist, it must be a coroutine function, and its signature
  must carry the parameters we rely on. Any mismatch means no patch.
* On any failure we log exactly one warning and leave core untouched. The
  fallback is the current upstream behaviour: buggy, but working and known.
* An upstream upgrade that renames, re-signatures, or restructures these
  functions therefore degrades to "unpatched", never to a crash.
* Applying twice is a no-op — the wrappers carry a marker attribute.

Even fully failed open, the residual damage is bounded: `standalone_send`
stamps `media_count` / `acked_count` / a delivered-count `note` onto every
success result (see `home.py`), so the false warning always sits next to
counter-evidence. The un-compensated Bug B remains a real silent drop, which is
why the patch is attempted at all.
"""

from __future__ import annotations

import inspect
import logging
from typing import Any, Callable

logger = logging.getLogger(__name__)

PLATFORM = "t3"

# Bug A's warning text, matched by prefix only. The remainder of the sentence
# names the platforms core believes support media, and that list has changed
# across releases — pinning the full prose would silently stop matching. The
# trailing ";" is part of the prefix and load-bearing: without it the match is
# also satisfied by a platform whose name merely *starts with* "t3".
_OMISSION_WARNING_PREFIX = f"MEDIA attachments were omitted for {PLATFORM};"

# Marker set on every wrapper we install, so a second `register()` (or a
# `discover_plugins(force=True)` rescan) does not stack wrappers on wrappers.
_MARKER = "_t3_gateway_shim"


def _platform_name(platform: Any) -> str:
    """Core passes a `Platform` enum member; be liberal about what we accept."""
    value = getattr(platform, "value", platform)
    return str(value or "").strip().lower()


def _target_module() -> Any | None:
    """Return the upstream module, or None when it cannot be imported.

    Imported lazily and defensively: this plugin is loaded by Hermes itself, so
    the module is normally already in `sys.modules` and this is a dict hit, but
    a stripped or restructured install must degrade to "no patch" rather than
    breaking plugin registration.
    """
    try:
        import tools.send_message_tool as module

        return module
    except Exception:  # noqa: BLE001 - any import failure means "do not patch"
        logger.warning(
            "T3 gateway: tools.send_message_tool is unavailable; leaving core "
            "send_message unpatched (media may be dropped on the co-resident "
            "path and a false omission warning may appear)",
            exc_info=True,
        )
        return None


def _usable(module: Any, name: str, required_params: tuple[str, ...]) -> Callable | None:
    """Feature-detect one patch target. Returns the function, or None.

    Checks, in order: the attribute exists, it is a coroutine function (we wrap
    it with `async def`, so a sync target would break every caller), it is not
    already wrapped, and its signature exposes the parameters this shim reads by
    name. A `*args, **kwargs`-style signature is accepted only if the named
    parameters are genuinely present — we never guess positionally.
    """
    original = getattr(module, name, None)
    if original is None:
        logger.warning(
            "T3 gateway: %s.%s is missing; leaving it unpatched", module.__name__, name
        )
        return None
    if getattr(original, _MARKER, False):
        return None  # already patched; idempotent no-op, nothing to report
    if not inspect.iscoroutinefunction(original):
        logger.warning(
            "T3 gateway: %s.%s is not a coroutine function; leaving it unpatched",
            module.__name__,
            name,
        )
        return None
    try:
        parameters = inspect.signature(original).parameters
    except (TypeError, ValueError):
        logger.warning(
            "T3 gateway: %s.%s has an unreadable signature; leaving it unpatched",
            module.__name__,
            name,
            exc_info=True,
        )
        return None
    missing = [param for param in required_params if param not in parameters]
    if missing:
        logger.warning(
            "T3 gateway: %s.%s no longer takes %s; leaving it unpatched (upstream "
            "may have fixed this, or changed shape)",
            module.__name__,
            name,
            ", ".join(missing),
        )
        return None
    return original


def _patch_send_via_adapter(module: Any) -> bool:
    """Bug B: route co-resident `t3` media sends through our own sender."""
    original = _usable(
        module,
        "_send_via_adapter",
        ("platform", "pconfig", "chat_id", "chunk", "thread_id", "media_files"),
    )
    if original is None:
        return False

    from .home import standalone_send
    signature = inspect.signature(original)

    async def _send_via_adapter(*args, **kwargs):
        bound = signature.bind(*args, **kwargs)
        bound.apply_defaults()
        values = bound.arguments
        platform = values["platform"]
        media_files = values["media_files"]
        if _platform_name(platform) == PLATFORM and media_files:
            # Core would hand this to `adapter.send(chat_id, content, metadata)`
            # and drop `media_files` on the floor. Our sender takes the whole
            # send — text frame plus one media frame per file — over a
            # short-lived `role: "delivery"` socket, which by design cannot
            # displace the live gateway connection sitting in the same process.
            return await standalone_send(
                values["pconfig"],
                values["chat_id"],
                values["chunk"],
                thread_id=values.get("thread_id"),
                media_files=media_files,
                force_document=values.get("force_document", False),
            )
        return await original(*args, **kwargs)

    setattr(_send_via_adapter, _MARKER, True)
    _send_via_adapter.__wrapped__ = original
    module._send_via_adapter = _send_via_adapter
    return True


def _strip_false_warning(result: Any) -> Any:
    """Drop Bug A's warning from a result dict, in place. Anything else passes."""
    if not isinstance(result, dict):
        return result
    warnings = result.get("warnings")
    if not isinstance(warnings, list):
        return result
    kept = [
        warning
        for warning in warnings
        if not (
            isinstance(warning, str)
            and warning.startswith(_OMISSION_WARNING_PREFIX)
        )
    ]
    if len(kept) == len(warnings):
        return result
    if kept:
        result["warnings"] = kept
    else:
        # An empty list would still read as "this send had warnings" to a
        # skimming agent; the key is optional upstream, so remove it.
        result.pop("warnings", None)
    return result


def _patch_send_to_platform(module: Any) -> bool:
    """Bug A: strip the unconditional omission warning, and rescue media-only sends.

    Two interceptions, both scoped to media-bearing `t3` sends:

    *Before* the original, one narrow bypass. A send with attachments and no
    text hard-errors at `tools/send_message_tool.py:1101-1107` (v0.19.0)::

        if media_files and not message.strip():
            return {"error": "... target t3 had only media attachments"}

    That check sits above the chunk loop, so the send never reaches
    `_send_via_adapter` and the Bug B patch cannot see it. `MEDIA:/tmp/x.png`
    with no prose — a perfectly ordinary agent send — fails outright. We route
    it straight to our sender, which already handles an empty message by
    emitting media frames only. Chunking is not skipped in any meaningful sense:
    there is no text to chunk.

    *After* the original, warning removal. Post-processing is the least invasive
    seam available: `_send_to_platform` is a ~380-line router whose warning is
    computed at line 1111 and attached at line 1154 with nothing interceptable
    in between. The original runs in full and we drop only the one warning we
    know to be false; every other warning it may add survives, and non-`t3`
    results are returned without even being inspected.

    A success from our sender means the frames were handed over — acked, or
    durably queued for the next connect (`media_count` / `acked_count` on the
    result say which). Nothing deliverable is reported as a hard `error`.
    """
    original = _usable(
        module,
        "_send_to_platform",
        ("platform", "pconfig", "chat_id", "message", "thread_id", "media_files"),
    )
    if original is None:
        return False

    from .home import standalone_send
    signature = inspect.signature(original)

    async def _send_to_platform(*args, **kwargs):
        bound = signature.bind(*args, **kwargs)
        bound.apply_defaults()
        values = bound.arguments
        platform = values["platform"]
        media_files = values["media_files"]
        message = values["message"]
        is_t3_media = _platform_name(platform) == PLATFORM and bool(media_files)
        if is_t3_media and not str(message or "").strip():
            return await standalone_send(
                values["pconfig"],
                values["chat_id"],
                message or "",
                thread_id=values.get("thread_id"),
                media_files=media_files,
                force_document=values.get("force_document", False),
            )
        result = await original(*args, **kwargs)
        if not is_t3_media:
            return result
        if isinstance(result, dict) and result.get("success"):
            return _strip_false_warning(result)
        return result

    setattr(_send_to_platform, _MARKER, True)
    _send_to_platform.__wrapped__ = original
    module._send_to_platform = _send_to_platform
    return True


def apply(module: Any | None = None) -> dict[str, bool]:
    """Install both wrappers. Never raises.

    Returns a per-patch applied/not-applied map, which is what the tests assert
    on. `module` is injectable so tests can drive a faithful fake of the
    upstream shape without importing Hermes.
    """
    applied = {"_send_via_adapter": False, "_send_to_platform": False}
    try:
        target = module if module is not None else _target_module()
        if target is None:
            return applied
        applied["_send_via_adapter"] = _patch_send_via_adapter(target)
        applied["_send_to_platform"] = _patch_send_to_platform(target)
    except Exception:  # noqa: BLE001 - a broken shim must not break the plugin
        logger.warning(
            "T3 gateway: could not patch core send_message; leaving it unpatched",
            exc_info=True,
        )
    return applied
