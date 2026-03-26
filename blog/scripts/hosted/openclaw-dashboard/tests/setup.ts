// Set env vars BEFORE any app code is imported
process.env.GATEWAY_TOKEN = "test-gateway-token-12345";
process.env.DB_PATH = ":memory:";
process.env.INSTANCE_ID = "test-instance";
process.env.PROVISIONING_URL = "http://localhost:19999";
