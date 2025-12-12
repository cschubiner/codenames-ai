import { withCors, preflight, type Env } from "./cors";
import { jsonResponse, randomId, readJson } from "./utils";
import { listPresets, getPreset } from "./presets";
import { CodenamesRoom } from "./room";

export { CodenamesRoom };

type CreateRoomBody = {
  red_agent: string;
  blue_agent: string;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return preflight(request, env);
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/health") {
        return withCors(jsonResponse({ ok: true, ts: Date.now() }), request, env);
      }

      if (url.pathname === "/api/presets" && request.method === "GET") {
        return withCors(jsonResponse({ presets: listPresets() }), request, env);
      }

      if (url.pathname === "/api/rooms" && request.method === "POST") {
        const body = await readJson<CreateRoomBody>(request);

        // Validate presets exist
        getPreset(body.red_agent);
        getPreset(body.blue_agent);

        const roomId = randomId(8);
        const id = env.ROOM.idFromName(roomId);
        const stub = env.ROOM.get(id);

        const initReq = new Request("https://do/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room_id: roomId, red_agent: body.red_agent, blue_agent: body.blue_agent }),
        });
        const initResp = await stub.fetch(initReq);
        if (!initResp.ok) {
          const txt = await initResp.text();
          return withCors(jsonResponse({ error: "init_failed", details: txt }, { status: 500 }), request, env);
        }

        return withCors(
          jsonResponse({
            room_id: roomId,
            join_paths: {
              red: `?room=${roomId}&team=RED`,
              blue: `?room=${roomId}&team=BLUE`,
              spectator: `?room=${roomId}&team=SPECTATOR`,
            },
          }),
          request,
          env,
        );
      }

      // Proxy /api/rooms/:roomId/* to Durable Object
      if (url.pathname.startsWith("/api/rooms/")) {
        const parts = url.pathname.split("/").filter(Boolean);
        // ["api","rooms",":roomId", ...rest]
        const roomId = parts[2];
        const rest = parts.slice(3).join("/");

        const id = env.ROOM.idFromName(roomId);
        const stub = env.ROOM.get(id);

        const doUrl = new URL(request.url);
        doUrl.pathname = "/" + (rest || "state"); // default
        const doReq = new Request(doUrl.toString(), request);

        const resp = await stub.fetch(doReq);
        return withCors(resp, request, env);
      }

      // Default root: simple landing text
      if (url.pathname === "/") {
        return withCors(
          new Response("Codenames AI Online backend is running. Use /api/* endpoints.", {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }),
          request,
          env,
        );
      }

      return withCors(jsonResponse({ error: "not_found" }, { status: 404 }), request, env);
    } catch (e: any) {
      return withCors(jsonResponse({ error: "exception", message: String(e?.message ?? e) }, { status: 500 }), request, env);
    }
  },
};
