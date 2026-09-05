process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test_secret_for_jest_only_1234567890";
process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/payguard_test";
