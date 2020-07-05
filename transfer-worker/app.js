const Queue = require('bull');

const config = require('./environment');

const REDIS_URL = `redis://${config.REDIS_HOST}:${config.REDIS_PORT}`;
const queueNames = ['SendRequest', 'SendTx'];

const reqQueue = new Queue(queueNames[0], REDIS_URL);
const txQueue = new Queue(queueNames[1], REDIS_URL);

const transferJob = async (job, done) => {
  console.log(job.data);
  return done();
};

reqQueue.process(transferJob);
