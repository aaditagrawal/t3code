"""Tests for the in-process compensation of two upstream `send_message` bugs.

The fake `tools.send_message_tool` below models the shape `coreshim` actually
depends on at Hermes v0.19.0 — the two coroutine signatures, the live-adapter
shortcut that drops `media_files` (Bug B, upstream line 711), the unconditional
omission warning (Bug A, upstream line 1108), and the media-only hard error
(upstream line 1101). It is deliberately a stand-in and not an import of the
real module: these tests must run with no Hermes installed.
"""

from __future__ import annotations

import enum
import importlib.util
import pathlib
import sys
import types
import unittest
import unittest.mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
PACKAGE = "hermes_t3_gateway_coreshim_test"

package = types.ModuleType(PACKAGE)
package.__path__ = [str(ROOT)]
sys.modules.setdefault(PACKAGE, package)

for _name in ("protocol", "connection", "home", "coreshim"):
    _spec = importlib.util.spec_from_file_location(
        f"{PACKAGE}.{_name}", ROOT / f"{_name}.py"
    )
    assert _spec and _spec.loader
    _module = importlib.util.module_from_spec(_spec)
    sys.modules[f"{PACKAGE}.{_name}"] = _module
    _spec.loader.exec_module(_module)

coreshim = sys.modules[f"{PACKAGE}.coreshim"]
home = sys.modules[f"{PACKAGE}.home"]


class Platform(str, enum.Enum):
    """Core passes an enum whose `.value` is the platform name."""

    T3 = "t3"
    TELEGRAM = "telegram"


# The nine platforms core hard-codes into the warning at upstream line 1112.
# The exact list is version-dependent, which is precisely why the shim matches
# on prefix — this fake spells it out so a prefix regression would be caught.
_SUPPORTED = (
    "telegram, discord, matrix, weixin, signal, yuanbao, feishu, whatsapp and slack"
)


def _fake_core() -> types.ModuleType:
    """Build a module that reproduces the two defects faithfully."""
    module = types.ModuleType("tools.send_message_tool")
    module.calls = []
    # Set by the test to simulate a co-resident gateway (Bug B's precondition).
    module.live_adapter = None
    # Warnings from unrelated causes, which the shim must never touch.
    module.extra_warnings = []

    async def _send_via_adapter(
        platform,
        pconfig,
        chat_id,
        chunk,
        *,
        thread_id=None,
        media_files=None,
        force_document=False,
    ):
        module.calls.append(
            {
                "fn": "_send_via_adapter",
                "platform": platform,
                "chat_id": chat_id,
                "chunk": chunk,
                "media_files": media_files,
                "thread_id": thread_id,
            }
        )
        if module.live_adapter is not None:
            # Bug B, upstream `tools/send_message_tool.py:711-732`: the live
            # adapter is handed content and metadata only. `media_files` is
            # dropped here, and the text was already stripped of its `MEDIA:`
            # directives upstream at line 442, so nothing downstream can
            # recover the attachments.
            return await module.live_adapter(chat_id=chat_id, content=chunk)
        return {"success": True, "message_id": "standalone-fallback"}

    async def _send_to_platform(
        platform,
        pconfig,
        chat_id,
        message,
        thread_id=None,
        media_files=None,
        force_document=False,
    ):
        module.calls.append(
            {
                "fn": "_send_to_platform",
                "platform": platform,
                "message": message,
                "media_files": media_files,
            }
        )
        name = platform.value if hasattr(platform, "value") else str(platform)
        # Upstream line 1101-1107.
        if media_files and not message.strip():
            return {
                "error": (
                    "send_message MEDIA delivery is currently only supported for "
                    f"{_SUPPORTED}; target {name} had only media attachments"
                )
            }
        # Upstream line 1108-1113: computed with no reference to what the
        # sender below actually does.
        warning = None
        if media_files:
            warning = (
                f"MEDIA attachments were omitted for {name}; native send_message "
                f"media delivery is currently only supported for {_SUPPORTED}"
            )
        # Resolved off the module, exactly as upstream's module-level call does
        # — so a patched `_send_via_adapter` is genuinely reached from here,
        # which is what makes the co-resident interception testable.
        result = await module._send_via_adapter(
            platform,
            pconfig,
            chat_id,
            message,
            thread_id=thread_id,
            media_files=media_files,
            force_document=force_document,
        )
        # Upstream line 1154-1157.
        if warning and isinstance(result, dict) and result.get("success"):
            warnings = list(result.get("warnings", []))
            warnings.extend(module.extra_warnings)
            warnings.append(warning)
            result["warnings"] = warnings
        return result

    module._send_via_adapter = _send_via_adapter
    module._send_to_platform = _send_to_platform
    return module


class ShimApplicationTests(unittest.TestCase):
    def test_both_wrappers_attach_to_a_faithful_module(self):
        module = _fake_core()
        self.assertEqual(
            coreshim.apply(module),
            {"_send_via_adapter": True, "_send_to_platform": True},
        )

    def test_applying_twice_does_not_stack_wrappers(self):
        """`register()` can run more than once (e.g. discover_plugins(force=True))."""
        module = _fake_core()
        coreshim.apply(module)
        first = module._send_via_adapter
        second_pass = coreshim.apply(module)

        self.assertEqual(
            second_pass, {"_send_via_adapter": False, "_send_to_platform": False}
        )
        self.assertIs(module._send_via_adapter, first)
        # One layer deep, still the genuine original.
        self.assertFalse(
            hasattr(module._send_via_adapter.__wrapped__, "__wrapped__")
        )


class FailOpenTests(unittest.TestCase):
    """A shape mismatch must leave core exactly as it was, never raise."""

    def _assert_untouched(self, module, applied, attribute):
        self.assertFalse(applied[attribute])
        self.assertFalse(getattr(getattr(module, attribute, None), "_t3_gateway_shim", False))

    def test_a_renamed_parameter_blocks_the_patch(self):
        module = _fake_core()

        async def _renamed(platform, pconfig, chat_id, chunk, *, thread_id=None, attachments=None):
            return {"success": True}

        module._send_via_adapter = _renamed
        with self.assertLogs(coreshim.logger, level="WARNING") as logs:
            applied = coreshim.apply(module)

        self._assert_untouched(module, applied, "_send_via_adapter")
        self.assertIs(module._send_via_adapter, _renamed)
        self.assertTrue(any("media_files" in line for line in logs.output))
        # The unrelated patch still lands — one mismatch does not disarm both.
        self.assertTrue(applied["_send_to_platform"])

    def test_a_missing_function_blocks_the_patch(self):
        module = _fake_core()
        del module._send_to_platform
        with self.assertLogs(coreshim.logger, level="WARNING") as logs:
            applied = coreshim.apply(module)

        self.assertFalse(applied["_send_to_platform"])
        self.assertFalse(hasattr(module, "_send_to_platform"))
        self.assertTrue(any("is missing" in line for line in logs.output))

    def test_a_sync_rewrite_blocks_the_patch(self):
        """If upstream ever makes these sync, an async wrapper would break callers."""
        module = _fake_core()

        def _sync(platform, pconfig, chat_id, chunk, *, thread_id=None, media_files=None):
            return {"success": True}

        module._send_via_adapter = _sync
        with self.assertLogs(coreshim.logger, level="WARNING") as logs:
            applied = coreshim.apply(module)

        self._assert_untouched(module, applied, "_send_via_adapter")
        self.assertTrue(any("coroutine" in line for line in logs.output))

    def test_an_unimportable_core_is_survivable(self):
        """The real `apply()` with no Hermes on the path must not raise."""
        with unittest.mock.patch.dict(sys.modules, {}, clear=False):
            sys.modules.pop("tools.send_message_tool", None)
            with self.assertLogs(coreshim.logger, level="WARNING"):
                applied = coreshim.apply()
        self.assertEqual(
            applied, {"_send_via_adapter": False, "_send_to_platform": False}
        )


class RoutingTests(unittest.IsolatedAsyncioTestCase):
    """Behaviour of the patched functions, with `standalone_send` stubbed."""

    def setUp(self):
        self.module = _fake_core()
        self.sends = []

        async def _standalone_send(
            pconfig, chat_id, message, *, thread_id=None, media_files=None, force_document=False
        ):
            self.sends.append(
                {
                    "chat_id": chat_id,
                    "message": message,
                    "media_files": media_files,
                    "thread_id": thread_id,
                    "force_document": force_document,
                }
            )
            return {
                "success": True,
                "message_id": "t3-delivery",
                "media_count": len(media_files or []),
                "acked_count": 1 + len(media_files or []),
                "note": f"{len(media_files or [])} media file(s) delivered and acknowledged",
            }

        patch = unittest.mock.patch.object(home, "standalone_send", _standalone_send)
        patch.start()
        self.addCleanup(patch.stop)
        coreshim.apply(self.module)

        async def _live_adapter(*, chat_id, content):
            # Whatever core hands the live adapter is all it ever sees.
            return {"success": True, "message_id": "live-adapter"}

        self.module.live_adapter = _live_adapter

    async def test_co_resident_t3_media_bypasses_the_live_adapter(self):
        """Bug B: the files must reach our sender, not the media-blind adapter."""
        result = await self.module._send_via_adapter(
            Platform.T3,
            None,
            "home-thread",
            "Here is the chart",
            thread_id="thread-1",
            media_files=[("/tmp/chart.png", False)],
        )

        self.assertEqual(result["message_id"], "t3-delivery")
        self.assertEqual(len(self.sends), 1)
        self.assertEqual(self.sends[0]["media_files"], [("/tmp/chart.png", False)])
        self.assertEqual(self.sends[0]["message"], "Here is the chart")
        self.assertEqual(self.sends[0]["thread_id"], "thread-1")
        # The original never ran, so the adapter never got a chance to drop it.
        self.assertEqual(self.module.calls, [])

    async def test_a_text_only_t3_send_keeps_the_original_path(self):
        result = await self.module._send_via_adapter(
            Platform.T3, None, "home-thread", "No attachments here"
        )

        self.assertEqual(result["message_id"], "live-adapter")
        self.assertEqual(self.sends, [])
        self.assertEqual(len(self.module.calls), 1)

    async def test_another_platform_with_media_is_untouched(self):
        result = await self.module._send_via_adapter(
            Platform.TELEGRAM,
            None,
            "chat-1",
            "Telegram body",
            media_files=[("/tmp/chart.png", False)],
        )

        self.assertEqual(result["message_id"], "live-adapter")
        self.assertEqual(self.sends, [])
        self.assertEqual(len(self.module.calls), 1)
        self.assertEqual(
            self.module.calls[0]["media_files"], [("/tmp/chart.png", False)]
        )

    async def test_the_false_omission_warning_is_stripped_for_t3(self):
        """Bug A: the warning is removed, and the rest of the result survives."""
        result = await self.module._send_to_platform(
            Platform.T3,
            None,
            "home-thread",
            "Here is the chart",
            media_files=[("/tmp/chart.png", False)],
        )

        self.assertTrue(result["success"])
        self.assertNotIn("warnings", result)
        self.assertEqual(result["media_count"], 1)

    async def test_an_unrelated_warning_is_preserved(self):
        """Only the one known-false warning is removed, not the whole key."""
        self.module.extra_warnings = ["Something else happened"]
        result = await self.module._send_to_platform(
            Platform.T3,
            None,
            "home-thread",
            "Here is the chart",
            media_files=[("/tmp/chart.png", False)],
        )

        self.assertEqual(result["warnings"], ["Something else happened"])

    async def test_the_warning_survives_for_a_platform_that_really_omits(self):
        """Only `t3` is compensated; another platform's warning is truthful."""
        self.module.live_adapter = None
        result = await self.module._send_to_platform(
            Platform.TELEGRAM,
            None,
            "chat-1",
            "Telegram body",
            media_files=[("/tmp/chart.png", False)],
        )

        self.assertEqual(len(result["warnings"]), 1)
        self.assertTrue(
            result["warnings"][0].startswith("MEDIA attachments were omitted for telegram")
        )

    async def test_a_media_only_t3_send_is_rescued_from_the_hard_error(self):
        """Upstream returns an error before routing; the shim sends instead."""
        result = await self.module._send_to_platform(
            Platform.T3, None, "home-thread", "", media_files=[("/tmp/chart.png", False)]
        )

        self.assertTrue(result["success"])
        self.assertEqual(self.sends[0]["media_files"], [("/tmp/chart.png", False)])
        # The original router never ran, so its hard error never happened.
        self.assertEqual(self.module.calls, [])

    async def test_a_media_only_send_on_another_platform_still_errors(self):
        result = await self.module._send_to_platform(
            Platform.TELEGRAM, None, "chat-1", "", media_files=[("/tmp/chart.png", False)]
        )

        self.assertIn("had only media attachments", result["error"])
        self.assertEqual(self.sends, [])

    async def test_a_text_only_send_is_byte_identical_through_the_wrapper(self):
        """No media means the wrapper is a pure pass-through, both platforms."""
        for platform in (Platform.T3, Platform.TELEGRAM):
            with self.subTest(platform=platform):
                result = await self.module._send_to_platform(
                    platform, None, "chat-1", "Plain text"
                )
                self.assertEqual(
                    result, {"success": True, "message_id": "live-adapter"}
                )
                self.assertEqual(self.sends, [])


class WarningMatchTests(unittest.TestCase):
    """The prefix match must be robust to upstream's changing platform list."""

    def test_a_future_platform_list_still_matches(self):
        result = {
            "success": True,
            "warnings": [
                "MEDIA attachments were omitted for t3; native send_message media "
                "delivery is currently only supported for telegram, discord and "
                "seventeen other platforms nobody has written yet"
            ],
        }
        self.assertNotIn("warnings", coreshim._strip_false_warning(result))

    def test_a_similar_warning_for_another_platform_is_not_matched(self):
        warning = "MEDIA attachments were omitted for t3000; ..."
        result = {"success": True, "warnings": [warning]}
        self.assertEqual(
            coreshim._strip_false_warning(result)["warnings"], [warning]
        )

    def test_a_non_dict_result_passes_through(self):
        self.assertIsNone(coreshim._strip_false_warning(None))
        self.assertEqual(coreshim._strip_false_warning("nope"), "nope")


if __name__ == "__main__":
    unittest.main()
