const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.MOCK_PORT || 3600;

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readUserMessage(body) {
  if (!body || typeof body !== "object") return "你好";
  return (
    body.message ||
    body.question ||
    body.prompt ||
    body.input ||
    body.query ||
    body.content ||
    "你好"
  );
}

function buildReply(userMessage) {
  return [
    "这是本地 Mock 服务返回的结果。",
    `你刚刚发送的是：${userMessage}`,
    "你现在可以验证：请求链路、流式输出、回调触发是否正常。"
  ].join("\n");
}

function splitChunks(text, size = 12) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks.length ? chunks : [text];
}

function sendJson(res, payload) {
  res.json({
    code: 0,
    ...payload
  });
}

async function sendSSE(res, fullText) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const chunks = splitChunks(fullText, 10);
  for (const part of chunks) {
    const frame = {
      code: 0,
      result: part,
      is_end: false
    };
    res.write(`data: ${JSON.stringify(frame)}\n\n`);
    await sleep(120);
  }

  res.write(`data: ${JSON.stringify({ code: 0, result: "", is_end: true })}\n\n`);
  res.end();
}

app.get("/health", (_, res) => {
  res.json({ ok: true, service: "ai-chat-embed-mock", now: Date.now() });
});

app.post("/api/chat", async (req, res) => {
  const message = readUserMessage(req.body);
  const reply = buildReply(message);

  const streamQuery = String(req.query.stream || "").toLowerCase();
  const wantsStream =
    streamQuery === "1" ||
    streamQuery === "true" ||
    req.headers.accept?.includes("text/event-stream");

  if (wantsStream) {
    await sendSSE(res, reply);
    return;
  }

  sendJson(res, {
    result: reply,
    is_end: true
  });
});

app.post("/api/chat-stream", async (req, res) => {
  const message = readUserMessage(req.body);
  const reply = buildReply(message);
  await sendSSE(res, reply);
});

app.post("/api/chat-nonstream", (req, res) => {
  const message = readUserMessage(req.body);
  const reply = buildReply(message);
  sendJson(res, {
    result: reply,
    is_end: true
  });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[mock] listening on http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log("[mock] endpoints:");
  // eslint-disable-next-line no-console
  console.log("  GET  /health");
  // eslint-disable-next-line no-console
  console.log("  POST /api/chat?stream=1|0");
  // eslint-disable-next-line no-console
  console.log("  POST /api/chat-stream");
  // eslint-disable-next-line no-console
  console.log("  POST /api/chat-nonstream");
});
