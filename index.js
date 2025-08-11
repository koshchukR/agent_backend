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

async function sendSMS(phone, message) {
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromPhone = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromPhone) {
      throw new Error("Missing SMS configuration");
    }

    const client = require("twilio")(accountSid, authToken);

    const result = await client.messages.create({
      body: message,
      from: fromPhone,
      to: phone,
    });

    return { success: true, sid: result.sid };
  } catch (error) {
    console.error("SMS sending failed:", error);
    throw error;
  }
}

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://screen-iq.onrender.com",
      "https://ai-powered-candidate-screening-plat.vercel.app",
      "https://agent-frontend-navy.vercel.app",
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

  const calendarUrl = `${
    process.env.FRONT_URL
  }/calendar?candidate_id=${encodeURIComponent(
    candidate_id
  )}&user_id=${encodeURIComponent(user_id)}`;

  const messageBody = `Hi ${name}, you applied for ${job_title}. Pick a time for a call: ${calendarUrl}
  `;

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

  console.log("Getting candidate info:", { candidateId, userId });

  try {
    // First try with user_id validation
    let { data: candidate, error } = await supabaseAdmin
      .from("candidates")
      .select("name, phone, position, user_id")
      .eq("id", candidateId)
      .eq("user_id", userId)
      .single();

    // If not found with user_id validation, try without it (for public calendar links)
    if (error || !candidate) {
      console.log(
        "Candidate not found with user_id validation, trying without:",
        error?.message
      );

      const { data: candidatePublic, error: publicError } = await supabaseAdmin
        .from("candidates")
        .select("name, phone, position, user_id")
        .eq("id", candidateId)
        .single();

      if (publicError || !candidatePublic) {
        console.error("Candidate not found at all:", publicError?.message);
        return res.status(404).json({ error: "Candidate not found" });
      }

      candidate = candidatePublic;
    }

    console.log("Found candidate:", {
      name: candidate.name,
      phone: candidate.phone,
      hasPhone: !!candidate.phone,
    });

    const { user_id, ...safeData } = candidate;
    res.json(safeData);
  } catch (error) {
    console.error("Error in candidate-info endpoint:", error);
    res.status(500).json({ error: "Server error" });
  }
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
  const { candidate_id, user_id, datetime, status = "scheduled" } = req.body;

  console.log("Creating booking:", { candidate_id, user_id, datetime, status });

  try {
    // Verify candidate exists (without strict user_id validation for public bookings)
    const { data: candidate, error: candidateError } = await supabaseAdmin
      .from("candidates")
      .select("id, name, phone, user_id")
      .eq("id", candidate_id)
      .single();

    if (candidateError || !candidate) {
      console.error("Candidate validation failed:", candidateError?.message);
      return res.status(404).json({ error: "Candidate not found" });
    }

    console.log("Candidate validated for booking:", candidate.name);

    // Check for duplicate booking
    const { data: existingBooking } = await supabaseAdmin
      .from("candidate_screenings")
      .select("id")
      .eq("candidate_id", candidate_id)
      .eq("user_id", user_id)
      .eq("datetime", datetime)
      .single();

    if (existingBooking) {
      console.log("Duplicate booking detected, returning existing booking");
      return res.json({
        id: existingBooking.id,
        message: "Booking already exists",
        duplicate: true,
      });
    }

    // Create the booking
    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("candidate_screenings")
      .insert([
        {
          candidate_id,
          user_id,
          datetime,
          status,
          notes: "Booked via calendar link",
        },
      ])
      .select()
      .single();

    if (bookingError) {
      console.error("Booking creation failed:", bookingError);
      return res.status(500).json({
        error: "Failed to create booking",
        details: bookingError.message,
      });
    }

    console.log("Booking created successfully:", booking.id);

    res.json(booking);
  } catch (error) {
    console.error("Error in create-booking endpoint:", error);
    res.status(500).json({ error: "Server error", details: error.message });
  }
});

app.post("/send-booking-sms", async (req, res) => {
  const { candidate_id, user_id, selected_date, selected_time } = req.body;

  console.log("SMS booking request:", {
    candidate_id,
    user_id,
    selected_date,
    selected_time,
  });

  try {
    // Get candidate data (without strict user_id validation)
    const { data: candidate, error: candidateError } = await supabaseAdmin
      .from("candidates")
      .select("name, phone, position")
      .eq("id", candidate_id)
      .single();

    if (candidateError || !candidate) {
      console.error("Candidate not found for SMS:", candidateError?.message);
      return res.status(404).json({ error: "Candidate not found" });
    }

    console.log("Found candidate for SMS:", {
      name: candidate.name,
      phone: candidate.phone,
      hasValidPhone: candidate.phone && candidate.phone !== "000-000-0000",
    });

    if (!candidate.phone || candidate.phone === "000-000-0000") {
      console.error("Invalid phone number for candidate:", candidate.phone);
      return res.status(400).json({
        error: "Invalid phone number",
        candidate_name: candidate.name,
        phone: candidate.phone,
      });
    }

    // Get job title
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

    // Format date and time
    const [year, month, day] = selected_date.split("-").map(Number);
    const dateObj = new Date(year, month - 1, day);
    const formattedDate = dateObj.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const formattedDateTime = `${formattedDate} at ${selected_time}`;

    // Create the booking first
    const datetime = `${selected_date}T${selected_time}:00.000Z`;

    console.log("Creating booking in database...");
    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("candidate_screenings")
      .insert([
        {
          candidate_id,
          user_id,
          datetime,
          status: "scheduled",
          notes: "Booked via SMS confirmation",
        },
      ])
      .select()
      .single();

    if (bookingError) {
      console.error("Failed to create booking:", bookingError);
      // Continue with SMS anyway - booking might have been created by another process
      console.log("Continuing with SMS despite booking error...");
    } else {
      console.log("Booking created successfully:", booking.id);
    }

    // Prepare SMS message
    const message = `Hi ${candidate.name}! Your screening interview for the ${jobTitle} position has been scheduled for ${formattedDateTime}. We look forward to speaking with you!`;

    console.log("Sending SMS:", {
      to: candidate.phone,
      message: message.substring(0, 100) + "...",
    });

    // Send SMS directly here instead of calling another endpoint
    // Replace this with your actual SMS service (Twilio, etc.)
    const smsResult = await sendSMS(candidate.phone, message);

    console.log("SMS sent successfully:", smsResult);

    res.json({
      success: true,
      message: "Booking created and SMS sent successfully",
      candidate_name: candidate.name,
      phone: candidate.phone,
      booking_id: booking?.id,
      sms_result: smsResult,
    });
  } catch (error) {
    console.error("Error in send-booking-sms:", error);
    res.status(500).json({
      error: "Server error",
      details: error.message,
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
