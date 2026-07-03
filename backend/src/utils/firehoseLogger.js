const { FirehoseClient, PutRecordCommand } = require("@aws-sdk/client-firehose");

const client = new FirehoseClient({
  region: process.env.AWS_REGION || "ap-south-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const STREAM_NAME = process.env.FIREHOSE_STREAM_NAME || "rate-limiter-log-stream";

function logToFirehose(logData) {
  try {
    const record = {
      Data: Buffer.from(JSON.stringify({
        ...logData,
        timestamp: new Date().toISOString(),
      }) + "\n"),
    };

    const command = new PutRecordCommand({
      DeliveryStreamName: STREAM_NAME,
      Record: record,
    });

    client.send(command).catch((err) => {
      console.warn("[firehoseLogger] Failed to push log (non-fatal):", err.message);
    });
  } catch (err) {
    console.warn("[firehoseLogger] Unexpected error (non-fatal):", err.message);
  }
}

module.exports = { logToFirehose };