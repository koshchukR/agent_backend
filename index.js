const express = require("express");
const axios = require("axios");
const cors = require("cors");
const twilio = require("twilio");
require("dotenv").config();

const { makePathwayCall } = require("./services/blandCall");
const { sendToSupabase } = require("./services/sendToSupabase");
const { createClient } = require("@supabase/supabase-js");

const app = express();

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
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

app.post("/send-sms", async (req, res) => {
  const { name, phone, job_title, candidate_id, user_id } = req.body;

  if (!name || !phone || !job_title || !candidate_id || !user_id) {
    return res.status(400).json({
      error:
        "Missing required fields: name, phone, job_title, candidate_id, user_id",
    });
  }

  const calendarUrl = `https://ai-powered-candidate-screening-plat.vercel.app/calendar?candidate_id=${encodeURIComponent(
    candidate_id
  )}&user_id=${encodeURIComponent(user_id)}`;

  const messageBody = `Hello, ${name}! You have applied for the position of “${job_title}”. Please select a convenient time for a call with our AI recruiter here: ${calendarUrl}`;

  try {
    const message = await twilioClient.messages.create({
      body: messageBody,
      from: process.env.TWILIO_NUMBER,
      to: phone.startsWith("+") ? phone : `+${phone}`,
    });

    console.log("SMS sent:", message.sid);
    res.status(200).json({ success: true, sid: message.sid });
  } catch (error) {
    console.error("Twilio SMS error:", error);
    res.status(500).json({ error: "Failed to send SMS" });
  }
});

app.post("/send-confirmation", async (req, res) => {
  const { name, phone, job_title, datetime } = req.body;

  if (!name || !phone || !job_title || !datetime) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const messageBody = `Your call for the position “${job_title}” has been scheduled for ${datetime}. Thank you!`;

  try {
    const message = await twilioClient.messages.create({
      body: messageBody,
      from: process.env.TWILIO_NUMBER,
      to: phone.startsWith("+") ? phone : `+${phone}`,
    });

    console.log("Confirmation SMS sent:", message.sid);
    res.status(200).json({ success: true, sid: message.sid });
  } catch (error) {
    console.error("SMS error:", error?.message || error);
    res
      .status(500)
      .json({ error: error?.message || "Failed to send confirmation SMS" });
  }
});

// Secure calendar endpoints

app.get("/calendar/candidate-info/:candidateId/:userId", async (req, res) => {
  const { candidateId, userId } = req.params;

  const { data: candidate, error } = await supabaseAdmin
    .from("candidates")
    .select("name, phone, position, user_id")
    .eq("id", candidateId)
    .eq("user_id", userId)
    .single();

  if (error || !candidate) {
    return res.status(404).json({ error: "Candidate not found" });
  }

  const { user_id, ...safeData } = candidate;
  res.json(safeData);
});

app.get("/calendar/availability/:userId", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("candidate_screenings")
    .select("datetime")
    .eq("user_id", req.params.userId)
    .eq("status", "scheduled")
    .gte("datetime", new Date().toISOString());

  res.json(data || []);
});

app.post("/calendar/create-booking", async (req, res) => {
  const { candidate_id, user_id, datetime, status } = req.body;

  const { data: candidate } = await supabaseAdmin
    .from("candidates")
    .select("user_id")
    .eq("id", candidate_id)
    .eq("user_id", user_id)
    .single();

  if (!candidate) {
    return res.status(403).json({ error: "Access denied" });
  }

  const { data, error } = await supabaseAdmin
    .from("candidate_screenings")
    .insert([{ candidate_id, user_id, datetime, status }])
    .select();

  res.json(data[0]);
});

app.post("/send-booking-sms", async (req, res) => {
  const { candidate_id, user_id, selected_date, selected_time } = req.body;

  console.log("Received SMS request:", {
    candidate_id,
    user_id,
    selected_date,
    selected_time,
  });

  try {
    const { data: candidate, error } = await supabaseAdmin
      .from("candidates")
      .select("name, phone, position")
      .eq("id", candidate_id)
      .eq("user_id", user_id)
      .single();

    if (error || !candidate) {
      console.error("Candidate not found:", error);
      return res.status(404).json({ error: "Candidate not found" });
    }

    console.log("Found candidate:", {
      name: candidate.name,
      phone: candidate.phone,
    });

    let jobTitle = candidate.position || "Position";
    try {
      const { data: jobData } = await supabaseAdmin
        .from("candidate_job_assignments")
        .select("job_postings!inner(title)")
        .eq("candidate_id", candidate_id)
        .single();

      if (jobData?.job_postings?.title) {
        jobTitle = jobData.job_postings.title;
      }
    } catch (jobError) {
      console.log("No specific job assignment found, using position");
    }

    const [year, month, day] = selected_date.split("-").map(Number);
    const dateObj = new Date(year, month - 1, day);
    const formattedDate = dateObj.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const formattedDateTime = `${formattedDate} at ${selected_time}`;

    const smsPayload = {
      name: candidate.name,
      phone: candidate.phone,
      job_title: jobTitle,
      datetime: formattedDateTime,
    };

    console.log("Sending SMS with payload:", smsPayload);

    const smsResponse = await fetch(
      `${process.env.BASE_URL || "http://localhost:3001"}/send-confirmation`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(smsPayload),
      }
    );

    const smsData = await smsResponse.json();

    if (smsResponse.ok) {
      console.log("SMS sent successfully");
      res.json({
        success: true,
        message: "SMS sent successfully",
        candidate_name: candidate.name,
        phone: candidate.phone,
      });
    } else {
      console.error("SMS sending failed:", smsData);
      res.status(500).json({
        error: "SMS sending failed",
        details: smsData,
      });
    }
  } catch (error) {
    console.error("Error in send-booking-sms:", error);
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
