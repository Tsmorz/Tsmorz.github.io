#!/usr/bin/env python3
"""UDP bridge for Tag Tracker (https://tsmorz.github.io/tag-tracker/).

A web page can't send UDP, so the Stream tab sends each message here over a WebSocket and this script passes it
on as one UDP datagram. Python 3.8 or later, standard library only.

    python3 udp-bridge.py                  # listens on ws://127.0.0.1:8770
    python3 udp-bridge.py --port 8771      # another port (set the same one on the page)
    python3 udp-bridge.py --origin http://my-host:4000   # also accept the page from another address

The page says where the datagrams go (host and port on the Stream tab). The bridge listens on this computer only,
and only accepts pages from tsmorz.github.io and localhost unless --origin adds another, so no other website you
open can use it to send packets.
"""
import argparse
import asyncio
import base64
import hashlib
import json
import socket
import struct
import sys
import urllib.parse

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
ORIGINS = {"https://tsmorz.github.io"}
LOCAL = {"localhost", "127.0.0.1", "::1"}
MAX_MESSAGE = 65507  # the most one UDP datagram can carry


def origin_ok(origin, extra):
    # Browsers always send Origin; a program on this computer that leaves it out is trusted like any local program.
    if not origin:
        return True
    if origin in ORIGINS or origin in extra:
        return True
    return urllib.parse.urlsplit(origin).hostname in LOCAL


def frame(opcode, payload=b""):
    n = len(payload)
    head = bytes([0x80 | opcode])
    if n < 126:
        head += bytes([n])
    elif n < 65536:
        head += bytes([126]) + struct.pack("!H", n)
    else:
        head += bytes([127]) + struct.pack("!Q", n)
    return head + payload


async def refuse(writer, status, text):
    body = text.encode()
    writer.write(f"HTTP/1.1 {status}\r\nContent-Type: text/plain\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode() + body)
    await writer.drain()
    writer.close()


async def handle(reader, writer, extra):
    try:
        head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 10)
    except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError):
        writer.close()
        return
    lines = head.decode("latin-1").split("\r\n")
    parts = lines[0].split(" ")
    headers = {}
    for line in lines[1:]:
        if ":" in line:
            k, v = line.split(":", 1)
            headers[k.strip().lower()] = v.strip()
    origin = headers.get("origin", "")
    if not origin_ok(origin, extra):
        print(f"refused a page from {origin} (add it with --origin)", flush=True)
        return await refuse(writer, "403 Forbidden", "This page may not use the bridge.")
    key = headers.get("sec-websocket-key")
    if len(parts) < 2 or parts[0] != "GET" or "websocket" not in headers.get("upgrade", "").lower() or not key:
        return await refuse(writer, "426 Upgrade Required", "Tag Tracker UDP bridge: connect with a WebSocket.")
    query = urllib.parse.parse_qs(urllib.parse.urlsplit(parts[1]).query)
    to = (query.get("to") or ["127.0.0.1:9870"])[0]
    host, _, port = to.rpartition(":")
    host = host.strip("[]") or "127.0.0.1"
    if not port.isdigit() or not 0 < int(port) < 65536:
        return await refuse(writer, "400 Bad Request", "Send to host:port, e.g. ?to=127.0.0.1:9870")
    try:
        addr = socket.getaddrinfo(host, int(port), type=socket.SOCK_DGRAM)[0]
    except socket.gaierror:
        return await refuse(writer, "400 Bad Request", f"Unknown host {host}")
    accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
    writer.write(f"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n".encode())
    udp = socket.socket(addr[0], socket.SOCK_DGRAM)
    # the page waits for this before it says it is connected
    writer.write(frame(1, json.dumps({"bridge": "tag-tracker-udp", "to": f"{host}:{port}"}).encode()))
    await writer.drain()
    print(f"{origin or 'a local program'} connected: sending to {host}:{port}", flush=True)
    sent, parts_ = 0, []
    try:
        while True:
            b1, b2 = await reader.readexactly(2)
            fin, opcode, n = b1 & 0x80, b1 & 0x0F, b2 & 0x7F
            if n == 126:
                n = struct.unpack("!H", await reader.readexactly(2))[0]
            elif n == 127:
                n = struct.unpack("!Q", await reader.readexactly(8))[0]
            if n > 1 << 20:
                break
            mask = await reader.readexactly(4) if b2 & 0x80 else b"\0\0\0\0"
            data = bytearray(await reader.readexactly(n))
            for i in range(n):
                data[i] ^= mask[i & 3]
            if opcode == 8:  # close
                writer.write(frame(8, bytes(data[:2])))
                await writer.drain()
                break
            if opcode == 9:  # ping
                writer.write(frame(10, bytes(data)))
                await writer.drain()
                continue
            if opcode in (0, 1, 2):
                parts_.append(bytes(data))
                if fin:
                    msg = b"".join(parts_)
                    parts_ = []
                    if len(msg) <= MAX_MESSAGE:
                        udp.sendto(msg, addr[4])
                        sent += 1
    except (asyncio.IncompleteReadError, ConnectionError):
        pass
    finally:
        udp.close()
        writer.close()
        print(f"disconnected after {sent} messages", flush=True)


async def main():
    ap = argparse.ArgumentParser(description="Pass Tag Tracker's Stream messages on as UDP datagrams.")
    ap.add_argument("--port", type=int, default=8770, help="WebSocket port to listen on (default 8770)")
    ap.add_argument("--origin", action="append", default=[], help="also accept the page from this origin, e.g. http://my-host:4000")
    a = ap.parse_args()
    server = await asyncio.start_server(lambda r, w: handle(r, w, set(a.origin)), "127.0.0.1", a.port)
    print(f"Tag Tracker UDP bridge on ws://127.0.0.1:{a.port}. Press Ctrl+C to stop.", flush=True)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
    except OSError as e:
        sys.exit(f"Could not listen: {e}")
