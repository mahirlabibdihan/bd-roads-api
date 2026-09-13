const Redis = require("ioredis");
const { REDIS_URL, REDIS_CONNECT_TIMEOUT_MS } = require("./config");

const connection = new Redis(REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 250, 5000),
});

const createProducerConnection = () =>
  new Redis(REDIS_URL, {
    lazyConnect: true,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });

module.exports = { connection, createProducerConnection };
