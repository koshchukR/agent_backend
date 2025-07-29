const express = require("express");
const axios = require("axios");
const cors = require("cors");
const twilio = require("twilio");
require("dotenv").config();

const { makePathwayCall } = require("./services/blandCall");
const { sendToSupabase } = require("./services/sendToSupabase");

const app = express();

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://screen-iq.onrender.com",
      "https://ai-powered-candidate-screening-plat.vercel.app",
    ],
    methods: ["GET", "POST"],
    credentials: true,
  })
);

app.use(express.json());

const port = process.env.PORT || 3000;

app.post("/start-call", async (req, res) => {
  try {
    const { phone, name, position } = req.body;
    const phoneNumber = phone || "+380664374069";
    const pathwayId = process.env.BLAND_PATHWAY_ID;

    const metadata = {
      campaign_id: "cold_call_july_pathway",
      source: "manual-trigger",
    };

    const result = await makePathwayCall({
      phoneNumber,
      pathwayId,
      metadata,
      requestData: {
        name,
        position,
      },
    });

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

app.get("/api/contacts", async (req, res) => {
  try {
    const response = await axios.get(
      "https://api.hubapi.com/crm/v3/objects/contacts",
      {
        headers: {
          Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    res.json(response.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Failed to fetch contacts from HubSpot" });
  }
});

app.post("/elevenlabs/call", async (req, res) => {
  try {
    const { phone, candidate_name, job_title } = req.body;

    if (!phone || !candidate_name || !job_title) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const response = await fetch(
      "https://api.elevenlabs.io/v1/convai/twilio/outbound-call",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          agent_id: process.env.ELEVENLABS_AGENT_ID,
          agent_phone_number_id: process.env.ELEVENLABS_PHONE_NUMBER_ID,
          to_number: phone,

          conversation_initiation_client_data: {
            dynamic_variables: {
              candidate_name,
              job_title,
            },
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error("ElevenLabs API error:", error);
      return res
        .status(500)
        .json({ error: "Failed to initiate outbound call via ElevenLabs" });
    }

    const data = await response.json();
    res.status(200).json({
      message: "Call initiated successfully",
      conversation_id: data.conversation_id,
      call_sid: data.callSid,
    });
  } catch (error) {
    console.error("Internal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
