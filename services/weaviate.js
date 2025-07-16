const axios = require("axios");
require("dotenv").config();

async function sendToWeaviate(callData) {
  try {
    const response = await axios.post(
      `${process.env.WEAVIATE_URL}/v1/objects`,
      {
        class: "Recruiter_Calls",
        id: callData.call_id,
        properties: {
          phone_to: { input: callData.to },
          phone_from: { input: callData.from },
          call_time: callData.created_at,
          status: callData.status,
          duration_sec: parseInt(callData.corrected_duration || 0),
          recording_url: callData.recording_url,
          transcript: callData.concatenated_transcript,
          summary: callData.summary,
          campaign_id: callData.metadata?.campaign_id,
          pathway_id: callData.pathway_id,
          disposition: callData.disposition_tag,
          metadata: JSON.stringify(callData.variables || {}),
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WEAVIATE_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("Sent to Weaviate:", response.data);
  } catch (error) {
    console.error(
      "Weaviate push error:",
      error.response?.data || error.message
    );
  }
}

module.exports = { sendToWeaviate };
