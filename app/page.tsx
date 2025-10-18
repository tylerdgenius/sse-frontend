"use client";

import { useEffect, useRef, useState } from "react";

// React SSE Client Component
// - TypeScript-ready (drop types if you prefer plain JS)
// - Uses EventSource to connect to /sse
// - Supports a short-lived token via query param (e.g. ?t=JWT)
// - Shows connection state, received events, and allows manual POST to /broadcast
// - Tailwind classes used for quick styling

export default function SseClient({
  url = "/sse",
  token = "",
  reconnectOnError = true,
}: {
  url?: string;
  token?: string;
  reconnectOnError?: boolean;
}) {
  const [connected, setConnected] = useState(false);
  const [statusText, setStatusText] = useState("idle");
  const [messages, setMessages] = useState<
    Array<{ id?: string; event?: string; data: any; raw?: string }>
  >([]);
  const [manualPayload, setManualPayload] = useState(
    '{ "msg": "hello from client" }'
  );
  const [autoConnect, setAutoConnect] = useState(true);
  const [attempts, setAttempts] = useState(0);

  const esRef = useRef<EventSource | null>(null);
  const attemptsRef = useRef(0);

  const buildUrl = () => {
    // Use token in query string so EventSource can reconnect automatically.
    const u = new URL(url, window.location.origin);
    if (token) u.searchParams.set("t", token);
    // include a client id to help server logs (optional)
    u.searchParams.set("clientId", String(Math.floor(Math.random() * 1000000)));
    return u.toString();
  };

  const fullUrl = "http://localhost:3001";

  useEffect(() => {
    // automatically connect on mount if autoConnect true
    if (!autoConnect) return;
    connect();
    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, url]);

  function pushMessage(msg: {
    id?: string;
    event?: string;
    data: any;
    raw?: string;
  }) {
    setMessages((m) => [msg, ...m].slice(0, 200)); // keep recent 200
  }

  function connect() {
    cleanup();
    // const fullUrl = buildUrl();
    setStatusText("connecting...");
    const url = `${fullUrl}/sse`;

    try {
      const es = new EventSource(url, { withCredentials: false });
      esRef.current = es;

      es.onopen = () => {
        attemptsRef.current = 0;
        setAttempts(0);
        setConnected(true);
        setStatusText("open");
        pushMessage({ event: "__meta", data: `connected to ${fullUrl}` });
      };

      es.onerror = (err) => {
        setConnected(false);
        setStatusText("error");
        attemptsRef.current += 1;
        setAttempts(attemptsRef.current);
        pushMessage({
          event: "__meta",
          data: `error (attempt ${attemptsRef.current})`,
        });

        // If EventSource is closed permanently by server, try manual reconnect if enabled
        if (reconnectOnError) {
          // Exponential backoff capped at 30s
          const backoff = Math.min(
            30000,
            1000 * Math.pow(2, Math.min(6, attemptsRef.current))
          );
          setStatusText(`retrying in ${Math.round(backoff / 1000)}s`);
          setTimeout(() => {
            // If still no ref (or closed), re-create
            if (
              !esRef.current ||
              esRef.current.readyState === EventSource.CLOSED
            ) {
              connect();
            }
          }, backoff);
        }
      };

      es.onmessage = (e) => {
        console.log("SSE message", e);
        // default message
        let data = e.data;
        try {
          data = JSON.parse(e.data);
        } catch (e) {
          // keep as string
        }
        pushMessage({
          id: (e as any).lastEventId,
          event: "message",
          data,
          raw: e.data,
        });
      };

      // example: listen to custom event 'tick'
      es.addEventListener("tick", (e: Event) => {
        // @ts-ignore
        const d = (e as MessageEvent).data;
        let parsed = d;
        try {
          parsed = JSON.parse(d);
        } catch {}
        pushMessage({ event: "tick", data: parsed, raw: d });
      });

      // custom handler for server-sent comments (heartbeat) — browsers don't surface comments
      // so server can instead send an event like `event: heartbeat`.
      es.addEventListener("heartbeat", (e: Event) => {
        // @ts-ignore
        pushMessage({ event: "heartbeat", data: (e as MessageEvent).data });
      });

      // custom handler for update events
      es.addEventListener("update", (e: Event) => {
        const messageEvent = e as MessageEvent;
        let data = messageEvent.data;
        try {
          data = JSON.parse(messageEvent.data);
        } catch (err) {
          // keep as string if parsing fails
        }
        pushMessage({ 
          event: "update", 
          data, 
          raw: messageEvent.data,
          id: messageEvent.lastEventId 
        });
      });
    } catch (err) {
      setStatusText("failed to create EventSource");
      pushMessage({ event: "__meta", data: String(err) });
    }
  }

  function cleanup() {
    const es = esRef.current;
    if (es) {
      try {
        es.close();
      } catch {}
      esRef.current = null;
    }
    setConnected(false);
    setStatusText("closed");
  }

  async function sendManual() {
    try {
      const body = JSON.parse(manualPayload);
      const res = await fetch(`${fullUrl}/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      pushMessage({ event: "manual-send-result", data: json });
    } catch (err) {
      pushMessage({ event: "manual-send-error", data: String(err) });
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">SSE Client</h2>
        <div className="text-sm">
          <span
            className={`px-2 py-1 rounded text-white ${
              connected ? "bg-green-600" : "bg-gray-500"
            }`}
          >
            {connected ? "connected" : "disconnected"}
          </span>
          <span className="ml-3 text-xs text-gray-600">{statusText}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div className="col-span-2">
          <label className="block text-sm mb-1">SSE URL</label>
          <input className="w-full p-2 border rounded" value={url} readOnly />
        </div>

        <div>
          <label className="block text-sm mb-1">Token (query)</label>
          <input className="w-full p-2 border rounded" value={token} readOnly />
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          className="px-3 py-1 bg-blue-600 text-white rounded"
          onClick={() => connect()}
        >
          Connect
        </button>
        <button
          className="px-3 py-1 bg-red-600 text-white rounded"
          onClick={() => cleanup()}
        >
          Disconnect
        </button>
        <label className="ml-2 flex items-center gap-2">
          <input
            type="checkbox"
            checked={autoConnect}
            onChange={(e) => setAutoConnect(e.target.checked)}
          />{" "}
          Auto-connect
        </label>
        <div className="ml-auto text-xs text-gray-600">
          Reconnect attempts: {attempts}
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-sm mb-1">Manual broadcast payload</label>
        <textarea
          className="w-full p-2 border rounded h-24"
          value={manualPayload}
          onChange={(e) => setManualPayload(e.target.value)}
        />
        <div className="flex gap-2 mt-2">
          <button
            className="px-3 py-1 bg-green-600 text-white rounded"
            onClick={sendManual}
          >
            Send
          </button>
          <button
            className="px-3 py-1 bg-gray-200 rounded"
            onClick={() => setManualPayload('{ "msg": "hello from client" }')}
          >
            Reset
          </button>
        </div>
      </div>

      <div>
        <h3 className="font-medium mb-2">Events</h3>
        <div className="bg-white border rounded shadow-inner p-2 max-h-96 overflow-auto">
          {messages.length === 0 && (
            <div className="text-sm text-gray-500">No events yet</div>
          )}
          {messages.map((m, i) => (
            <div key={i} className="mb-2 p-2 border-b last:border-b-0">
              <div className="text-xs text-gray-500">
                {m.event ?? "message"} {m.id ? `• id:${m.id}` : ""}
              </div>
              <pre className="text-sm whitespace-pre-wrap">
                {typeof m.data === "string"
                  ? m.data
                  : JSON.stringify(m.data, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/*
  Server expectations (minimal):
  - GET /sse should return `Content-Type: text/event-stream` and stream events.
  - POST /broadcast accepts JSON and broadcasts to connected SSE clients.

  Notes & tips:
  - If you need Authorization headers for SSE, browsers don't let you set custom headers on EventSource.
    Use a short-lived token in the querystring, or perform an authenticated handshake before opening the EventSource.
  - For cluster/broadcast support, run a Redis pub/sub on the server side and publish events to a channel all Node instances subscribe to.
  - Ensure proxies (nginx, Cloudflare) have buffering disabled for the SSE endpoint.
*/
