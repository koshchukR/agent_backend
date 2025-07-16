const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function sendToSupabase(callData) {
  try {
    const {
      call_id,
      to,
      from,
      created_at,
      status,
      corrected_duration,
      recording_url,
      concatenated_transcript,
      summary,
      pathway_id,
      disposition_tag,
      metadata = {},
      variables = {},
    } = callData;

    const insertData = {
      id: call_id,
      phone_to: to,
      phone_from: from,
      call_time: created_at,
      status: status,
      duration_sec: parseInt(corrected_duration || 0),
      recording_url: recording_url || null,
      transcript: concatenated_transcript || "",
      summary: summary || "",
      campaign_id:
        metadata?.campaign_id || variables?.metadata?.campaign_id || null,
      pathway_id: pathway_id || null,
      disposition: disposition_tag || null,
      metadata: variables || {},
    };

    const { error } = await supabase
      .from("recruiter_calls")
      .insert([insertData]);

    if (error) {
      console.error("Supabase insert error:", error);
    } else {
      console.log("Sent to Supabase:", insertData.id);
    }
  } catch (err) {
    console.error("sendToSupabase unexpected error:", err.message);
  }
}

module.exports = { sendToSupabase };
