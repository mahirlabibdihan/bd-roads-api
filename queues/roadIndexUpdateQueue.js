const { Queue } = require("bullmq");
const { createProducerConnection } = require("../config/redis");

const QUEUE_NAME = "road-index-updates";
let queue;
let producerConnection;

const getQueue = () => {
  if (!queue) {
    producerConnection = createProducerConnection();
    queue = new Queue(QUEUE_NAME, { connection: producerConnection });
    queue.on("error", () => {});
  }
  return queue;
};

const resetQueue = async () => {
  const oldQueue = queue;
  const oldConnection = producerConnection;
  queue = undefined;
  producerConnection = undefined;
  await Promise.allSettled([oldQueue?.close(), oldConnection?.disconnect()]);
};

module.exports = { QUEUE_NAME, getQueue, resetQueue };
