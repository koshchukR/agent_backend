async function makePathwayCall({
  phoneNumber,
  pathwayId,
  metadata = {},
  requestData = {},
}) {
  try {
    const response = await axios.post(
      "https://api.bland.ai/v1/calls",
      {
        phone_number: phoneNumber,
        voice: "josh",
        wait_for_greeting: true,
        block_interruptions: false,
        interruption_threshold: 100,
        language: "en-US",
        temperature: 0.7,
        model: "base",
        record: true,
        webhook: `${process.env.BASE_URL}/bland/webhook`,
        webhook_events: ["call"],
        metadata,
        pathway_id: pathwayId,
        pathway_version: 0,
        from: `${process.env.BLAND_PHONE_FROM}`,
        request_data: {},
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.BLAND_AI_API}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("Pathway call initiated:", response.data);
    return response.data;
  } catch (error) {
    console.log(requestData);
    console.error(
      "Error making pathway call:",
      error.response?.data || error.message
    );
    throw error;
  }
}

module.exports = {
  makePathwayCall,
};
