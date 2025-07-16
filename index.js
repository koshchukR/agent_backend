const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { makePathwayCall } = require("./services/blandCall");
const { sendToSupabase } = require("./services/sendToSupabase");

const app = express();

app.use(
  cors({
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true,
  })
);

app.use(express.json());

const port = process.env.PORT || 3000;

app.get("/start-call", async (req, res) => {
  try {
    const phoneNumber = req.query.phone || "+380664374069";
    const pathwayId = req.query.pathway || process.env.BLAND_PATHWAY_ID;

    const metadata = {
      campaign_id: "cold_call_july_pathway",
      source: "manual-trigger",
    };

    const result = await makePathwayCall({ phoneNumber, pathwayId, metadata });
    res.status(200).json(result);
  } catch (error) {
    console.error("Error initiating call:", error.message);
    res.status(500).json({ error: "Pathway call initiation failed" });
  }
});

app.post("/bland/webhook", async (req, res) => {
  const data = req.body;
  console.log("Webhook received from Bland.ai:");
  console.log(JSON.stringify(data, null, 2));

  if (data.status === "completed" && data.concatenated_transcript) {
    await sendToSupabase(data);
  }

  res.status(200).send("Webhook received");
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
