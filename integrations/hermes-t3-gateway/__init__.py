"""T3 Code gateway plugin registration for Hermes Agent."""
# ruff: noqa: N999 - Hermes loads hyphenated plugin directories dynamically.

from __future__ import annotations

from .adapter import (
    T3PlatformAdapter,
    check_requirements,
    env_enablement,
    validate_config,
)
from .cli import register_cli, t3_command
from .coreshim import apply as apply_core_shim
from .home import HOME_CHANNEL_ENV, standalone_send


def _pre_tool_call(
    tool_name: str,
    args: dict,
    task_id: str,
    **kwargs,
) -> None:
    session_id = str(kwargs.get("session_id") or task_id)
    tool_call_id = str(kwargs.get("tool_call_id") or "")
    T3PlatformAdapter.route_tool_started(tool_name, args, session_id, tool_call_id)


def _post_tool_call(
    tool_name: str,
    args: dict,
    result: str,
    task_id: str,
    duration_ms: int | None = None,
    **kwargs,
) -> None:
    del args
    session_id = str(kwargs.get("session_id") or task_id)
    tool_call_id = str(kwargs.get("tool_call_id") or "")
    status = str(kwargs.get("status") or "")
    T3PlatformAdapter.route_tool_completed(
        tool_name, result, session_id, duration_ms, tool_call_id, status
    )


def register(ctx) -> None:
    ctx.register_platform(
        name="t3",
        label="T3 Code",
        adapter_factory=lambda config: T3PlatformAdapter(config),
        check_fn=check_requirements,
        validate_config=validate_config,
        required_env=[
            "HERMES_T3_GATEWAY_URL",
            "HERMES_T3_GATEWAY_INSTANCE_ID",
            "HERMES_T3_GATEWAY_CREDENTIAL",
        ],
        env_enablement_fn=env_enablement,
        # Cron home-channel delivery. The name is not free-form: Hermes
        # resolves a platform's cron home target through `_home_target_env_var`
        # (`gateway/run.py:1541`), which falls back to
        # f"{PLATFORM.upper()}_HOME_CHANNEL" for any platform without a
        # built-in override entry — exactly this string for platform `t3`. So
        # `send_message`'s error hints, `/sethome` messaging, and cron's
        # env-only resolution all agree with the value the plugin writes, with
        # no upstream override table entry. Without this, `deliver=t3` is
        # silently dropped by cron.
        cron_deliver_env_var=HOME_CHANNEL_ENV,
        # Out-of-process cron delivery: when `hermes cron` runs in a separate
        # process from `hermes gateway` there is no live adapter, and without
        # this hook `deliver=t3` fails with "No live adapter for platform".
        # Dials T3 over a short-lived `role: "delivery"` socket so it cannot
        # displace the live gateway connection.
        standalone_sender_fn=standalone_send,
        max_message_length=120_000,
        emoji="🔺",
        pii_safe=True,
        platform_hint=(
            "You are chatting through T3 Code. Preserve normal Hermes behavior; "
            "T3 renders streamed text, tool activity, approvals, and questions."
        ),
    )
    ctx.register_cli_command(
        name="t3",
        help="Pair and inspect the T3 Code gateway",
        setup_fn=register_cli,
        handler_fn=t3_command,
        description=(
            "Connect this Hermes process to a named T3 Code provider instance."
        ),
    )
    ctx.register_hook("pre_tool_call", _pre_tool_call)
    ctx.register_hook("post_tool_call", _post_tool_call)
    # Compensate two upstream `send_message` media defects in-process (see
    # `coreshim.py` for the file:line analysis). Applied after the platform is
    # registered because the Bug B wrapper routes through `standalone_send`,
    # which resolves the same enrollment the entry above advertises. This runs
    # in every process that loads plugins — `hermes gateway`, `hermes cron`, and
    # the `hermes send` CLI, which reaches `register()` via
    # `tools/send_message_tool.py:399` -> `gateway/config.py:2530` well before
    # it routes a send. Never raises: on any mismatch it logs one warning and
    # leaves core untouched.
    apply_core_shim()


__all__ = ["register"]
