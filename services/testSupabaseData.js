const { sendToSupabase } = require("./sendToSupabase");
const { v4: uuidv4 } = require("uuid");

const mockCallData = {
  call_id: uuidv4(),
  to: "+380664374069",
  from: "+15126437743",
  created_at: new Date().toISOString(),
  status: "completed",
  corrected_duration: "14",
  recording_url: "https://example.com/test.mp3",
  concatenated_transcript: "Test transcript text",
  summary: "This is a test call summary.",
  pathway_id: "a0446c50-6479-4cf3-9536-686da92a6148",
  disposition_tag: "NO_CONTACT_MADE",
  metadata: {
    campaign_id: "cold_call_test_campaign",
    source: "manual-test",
  },
  variables: {
    name: "Test User",
    metadata: {
      campaign_id: "cold_call_test_campaign",
    },
  },
};

sendToSupabase(mockCallData);
