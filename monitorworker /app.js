const Queue = require('bull');

const config = require('./environment');

const REDIS_URL = `redis://${config.REDIS_HOST}:${config.REDIS_PORT}`;
const queueNames = ['PendingTx'];

const txQueue = new Queue(queueNames[0], REDIS_URL);

const Web3 = require('web3');
const axios = require('axios');
const log = require('ololog').configure({ time: true });
require ('ansicolor').nice

log.info('\n--Start MonitorWorker--\n'.blue);

// Access Token이 없을 경우에는 종료
if (!config.INFURA_ACCESS_TOKEN) {
  log.error('Error: "ACCESS_TOKEN" for infura.io is required.'.red);
  process.exit(1);
}

const endpoint = `${config.ETH_ENDPOINT}/${config.INFURA_ACCESS_TOKEN}`;
const web3 = new Web3(new Web3.providers.HttpProvider(endpoint));

log.info(`Ethereum Endpoint is ${endpoint}`);

/*
* Eth Node와 연결이 되어 있는지 확인
*/
const isConnected = async (ep) => {
  let connected = false;
  ep = (ep) ? ep:endpoint;
  try {
    connected = await web3.eth.net.isListening();
  } catch (e) {
    web3.setProvider(ep);
  } finally {
    return connected;
  }
};

const initJob = async () => {
  // Job Clear, Read txs from database, Add Queue
};

const monitorJob = async (job, done) => {
  log.info(`\nStart a new monitor job!! [id:${job.id}]\n`.blue);
  log.green(job.data)

  const txn = await web3.eth.getTransaction(job.data.txid)
  if (txn.blockNumber === null) {
    // Wait for confirming.
    // Use WebSocket
  }

  console.log(txn.blockNumber);

  // Write to Database
  done();
};

const main = async () => {
  if (!await isConnected()) {
    log.error(`Connection error with infura.(${endpoint})`.red);
    process.exit(1);
  }
  log.info('Connection is Successed.');

  initJob();

  log.info('\nStart watching pendingTx Queue...'.blue);
  txQueue.process(monitorJob);

}

main();
