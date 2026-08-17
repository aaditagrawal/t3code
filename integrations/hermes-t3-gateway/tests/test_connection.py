from __future__ import annotations

import asyncio
import importlib.util
import json
import pathlib
import sys
import types
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
PACKAGE = "hermes_t3_gateway_test"

package = types.ModuleType(PACKAGE)
package.__path__ = [str(ROOT)]
sys.modules.setdefault(PACKAGE, package)

for name in ("protocol", "connection"):
    spec = importlib.util.spec_from_file_location(
        f"{PACKAGE}.{name}", ROOT / f"{name}.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[f"{PACKAGE}.{name}"] = module
    spec.loader.exec_module(module)

connection = sys.modules[f"{PACKAGE}.connection"]


async def _immediate(value):
    return value


class FakeSocket:
    def __init__(self, response):
        self.response = response
        self.sent = []
        self.closed = False

    async def send(self, value):
        self.sent.append(json.loads(value))

    async def recv(self):
        request_id = self.sent[0]["requestId"]
        return json.dumps({**self.response, "requestId": request_id})

    async def close(self):
        self.closed = True


class ConnectionTests(unittest.IsolatedAsyncioTestCase):
    def test_url_normalization(self):
        self.assertEqual(
            connection.websocket_url("https://t3.example"),
            "wss://t3.example/api/hermes-gateway/ws",
        )
        self.assertEqual(
            connection.websocket_url("http://localhost:8484/"),
            "ws://localhost:8484/api/hermes-gateway/ws",
        )
        with self.assertRaises(ValueError):
            connection.websocket_url("ftp://invalid.example")

    async def test_disconnect_cancels_and_drains_in_flight_handlers(self):
        started = asyncio.Event()
        cancelled = asyncio.Event()
        never_finishes = asyncio.Event()

        async def on_message(_message):
            started.set()
            try:
                await never_finishes.wait()
            finally:
                cancelled.set()

        conn = connection.T3GatewayConnection(
            url="ws://t3.example/api/hermes-gateway/ws",
            instance_id="provider-instance",
            credential="secret",
            hermes_version="0.19.0",
            on_message=on_message,
        )
        conn._spawn_handler({"type": "turn.start", "requestId": "turn-1"})
        await asyncio.wait_for(started.wait(), timeout=1)

        await conn.disconnect()

        self.assertTrue(cancelled.is_set())
        self.assertEqual(conn._handlers, set())

    async def test_enrollment_handshake_returns_credential(self):
        socket = FakeSocket(
            {
                "type": "connection.accepted",
                "protocolVersion": 4,
                "instanceId": "provider-instance",
                "nickname": "Research",
                "credential": "persistent-secret",
            }
        )
        accepted = await connection.authenticate_socket(
            socket,
            authentication={"type": "enrollment-token", "token": "once"},
            hermes_version="0.19.0",
        )
        self.assertEqual(accepted["credential"], "persistent-secret")
        self.assertEqual(
            socket.sent[0]["authentication"],
            {"type": "enrollment-token", "token": "once"},
        )

    async def test_accepted_handshake_rejects_an_incompatible_protocol(self):
        socket = FakeSocket(
            {
                "type": "connection.accepted",
                # A v3 server: the version policy stays fail-closed across the
                # v4 bump, so this must not be silently accepted.
                "protocolVersion": 3,
                "instanceId": "provider-instance",
                "nickname": "Research",
            }
        )
        with self.assertRaisesRegex(RuntimeError, "incompatible version"):
            await connection.authenticate_socket(
                socket,
                authentication={
                    "type": "instance-credential",
                    "instanceId": "provider-instance",
                    "credential": "secret",
                },
                hermes_version="0.19.0",
            )

    async def test_rejected_handshake_fails_closed(self):
        socket = FakeSocket(
            {
                "type": "connection.rejected",
                "code": "version-incompatible",
                "message": "upgrade required",
                "expectedProtocolVersion": 4,
            }
        )
        with self.assertRaises(connection.ConnectionRejected) as raised:
            await connection.authenticate_socket(
                socket,
                authentication={
                    "type": "instance-credential",
                    "instanceId": "provider-instance",
                    "credential": "secret",
                },
                hermes_version="0.19.0",
            )
        self.assertEqual(raised.exception.code, "version-incompatible")

    async def test_handshake_survives_a_ping_racing_the_reply(self):
        """A ping may arrive before `connection.accepted`.

        The server starts probing liveness on its own schedule, so the first
        frame after hello is not guaranteed to be the handshake reply.
        Treating it as one tore down the freshly established connection and
        reconnected in a loop — the plugin logged "unexpected requestId" while
        the server logged missed pongs.
        """
        class RacingSocket:
            def __init__(self):
                self.sent = []
                self._frames = None

            async def send(self, value):
                self.sent.append(json.loads(value))

            async def recv(self):
                if self._frames is None:
                    hello_id = self.sent[0]["requestId"]
                    self._frames = iter(
                        [
                            json.dumps(
                                {
                                    "type": "ping",
                                    "protocolVersion": 4,
                                    "requestId": "server-ping-1",
                                }
                            ),
                            json.dumps(
                                {
                                    "type": "connection.accepted",
                                    "protocolVersion": 4,
                                    "requestId": hello_id,
                                    "instanceId": "provider-instance",
                                    "nickname": "Hermes",
                                }
                            ),
                        ]
                    )
                return next(self._frames)

        socket = RacingSocket()
        accepted = await connection.authenticate_socket(
            socket,
            authentication={
                "type": "instance-credential",
                "instanceId": "provider-instance",
                "credential": "secret",
            },
            hermes_version="0.19.0",
        )
        self.assertEqual(accepted["type"], "connection.accepted")
        pongs = [f for f in socket.sent if f.get("type") == "pong"]
        self.assertEqual(len(pongs), 1, "the racing ping must still be answered")
        self.assertEqual(pongs[0]["requestId"], "server-ping-1")

    async def test_ping_is_answered_while_a_command_handler_is_blocked(self):
        """A ping must not queue behind command dispatch.

        `_on_message` awaits Hermes: `turn.start` blocks for the whole agent
        turn. If the real read loop awaited that before reading the next
        frame, a ping arriving mid-turn would go unanswered for minutes and
        T3 would close a healthy socket as half-open — which is what happened
        in practice. This drives `_supervise` itself so the loop under test is
        the one that ships.
        """
        import asyncio

        blocked = asyncio.Event()
        released = asyncio.Event()

        class BlockingSocket:
            def __init__(self):
                self.sent = []

            async def send(self, value):
                self.sent.append(json.loads(value))

            async def recv(self):
                return json.dumps(
                    {
                        "type": "connection.accepted",
                        "protocolVersion": 4,
                        "requestId": self.sent[0]["requestId"],
                        "instanceId": "provider-instance",
                        "nickname": "Hermes",
                    }
                )

            async def close(self):
                return None

            def __aiter__(self):
                async def frames():
                    yield json.dumps({"type": "turn.start", "requestId": "turn-1"})
                    yield json.dumps(
                        {"type": "ping", "protocolVersion": 4, "requestId": "ping-1"}
                    )
                    await released.wait()

                return frames()

        socket = BlockingSocket()

        async def on_message(message):
            # Stands in for Hermes running a turn: does not return while the
            # test checks whether the pong went out regardless.
            blocked.set()
            await released.wait()

        conn = connection.T3GatewayConnection(
            url="ws://t3.example/api/hermes-gateway/ws",
            instance_id="provider-instance",
            credential="secret",
            hermes_version="0.19.0",
            on_message=on_message,
        )

        original_open = connection._open_socket
        connection._open_socket = lambda url: _immediate(socket)
        try:
            self.assertTrue(await conn.connect(timeout=2))
            await asyncio.wait_for(blocked.wait(), timeout=2)
            # Let the read loop reach the queued ping while on_message is stuck.
            for _ in range(10):
                await asyncio.sleep(0)
            pongs = [f for f in socket.sent if f.get("type") == "pong"]
            self.assertEqual(
                len(pongs), 1, "the ping must be answered while a command is blocked"
            )
            self.assertEqual(pongs[0]["requestId"], "ping-1")
        finally:
            connection._open_socket = original_open
            released.set()
            await conn.disconnect()

    async def test_ping_is_answered_while_the_accepted_callback_flushes(self):
        """Reconnect queue replay must not run ahead of the socket read loop."""
        import asyncio

        callback_started = asyncio.Event()
        release_callback = asyncio.Event()

        class BlockingAcceptedSocket:
            def __init__(self):
                self.sent = []

            async def send(self, value):
                self.sent.append(json.loads(value))

            async def recv(self):
                return json.dumps(
                    {
                        "type": "connection.accepted",
                        "protocolVersion": 4,
                        "requestId": self.sent[0]["requestId"],
                        "instanceId": "provider-instance",
                        "nickname": "Hermes",
                    }
                )

            async def close(self):
                return None

            def __aiter__(self):
                async def frames():
                    await callback_started.wait()
                    yield json.dumps(
                        {
                            "type": "ping",
                            "protocolVersion": 4,
                            "requestId": "ping-during-flush",
                        }
                    )
                    await release_callback.wait()

                return frames()

        socket = BlockingAcceptedSocket()

        async def on_accepted(_message):
            callback_started.set()
            await release_callback.wait()

        conn = connection.T3GatewayConnection(
            url="ws://t3.example/api/hermes-gateway/ws",
            instance_id="provider-instance",
            credential="secret",
            hermes_version="0.19.0",
            on_message=lambda _message: _immediate(None),
            on_accepted=on_accepted,
        )

        original_open = connection._open_socket
        connection._open_socket = lambda url: _immediate(socket)
        try:
            self.assertTrue(await conn.connect(timeout=2))
            await asyncio.wait_for(callback_started.wait(), timeout=2)
            for _ in range(10):
                await asyncio.sleep(0)
            pongs = [frame for frame in socket.sent if frame.get("type") == "pong"]
            self.assertEqual(len(pongs), 1)
            self.assertEqual(pongs[0]["requestId"], "ping-during-flush")
        finally:
            connection._open_socket = original_open
            release_callback.set()
            await conn.disconnect()

    async def test_disconnect_cancels_handlers_before_notifying_disconnected(self):
        handler_started = asyncio.Event()
        handler_drained = asyncio.Event()
        notifications = []

        async def handler(_message):
            handler_started.set()
            try:
                await asyncio.Future()
            finally:
                await asyncio.sleep(0)
                handler_drained.set()

        async def on_state(connected, _reason):
            if not connected:
                notifications.append(handler_drained.is_set())

        conn = connection.T3GatewayConnection(
            url="ws://unused",
            instance_id="provider-instance",
            credential="secret",
            hermes_version="0.19.0",
            on_message=handler,
            on_state=on_state,
        )
        conn._spawn_handler({"type": "turn.start"})
        await handler_started.wait()

        await conn.disconnect()

        self.assertTrue(handler_drained.is_set())
        self.assertEqual(notifications, [True])
        self.assertEqual(conn._handlers, set())


if __name__ == "__main__":
    unittest.main()
