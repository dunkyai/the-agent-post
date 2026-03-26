// Set env vars BEFORE any app code is imported
process.env.GATEWAY_TOKEN = "test-gateway-token-12345";
process.env.DB_PATH = ":memory:";
process.env.INSTANCE_ID = "test-instance";
process.env.PROVISIONING_URL = "http://localhost:19999";
process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-for-tests";
process.env.MESSAGE_LIMIT = "250";
