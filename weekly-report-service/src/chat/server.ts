import "dotenv/config";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { answerReportQuestion } from "../orchestrator/summarize.js";
import { openDb } from "../storage/db.js";
import { getSnapshotByWeek, listSnapshotWeeks } from "../storage/snapshot.js";

const requestSchema = z.object({
  week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  question: z.string().min(1).max(1000)
});

const app = express();
const allowedOrigin = process.env.CHAT_ALLOWED_ORIGIN;
if (!allowedOrigin) throw new Error("CHAT_ALLOWED_ORIGIN is required");

app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

app.use(express.json({ limit: "32kb" }));
app.use(cors({ origin: allowedOrigin, methods: ["POST"], allowedHeaders: ["Content-Type"] }));
app.use(rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }));

app.post("/api/chat", async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request" });

  const db = await openDb();
  try {
    const weeks = new Set(await listSnapshotWeeks(db));
    if (!weeks.has(parsed.data.week)) return res.status(404).json({ error: "Unknown report week" });
    const snapshot = await getSnapshotByWeek(db, parsed.data.week);
    if (!snapshot) return res.status(404).json({ error: "Unknown report week" });
    const payload = {
      week_start: snapshot.week_start,
      week_end: snapshot.week_end,
      reconciled: JSON.parse(snapshot.reconciled_json),
      summary_text: snapshot.summary_text
    };
    const answer = await answerReportQuestion(parsed.data.question, payload);
    return res.json({ answer });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Chat unavailable" });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.info(`Chat service listening on ${port}`));
