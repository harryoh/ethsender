const Queue = require('bull'),
      Web3 = require('web3'),
      axios = require('axios'),
      log = require('ololog').configure({ time: true });

require ('ansicolor').nice
const config = require('./environment');

const STATUS = {
  EMPTY: 0,
  PREPARE: 1,
  PENDING: 2,
  COMPLETE: 3,
  ERROR: 5
};

const REDIS_URL = `redis://${config.REDIS_HOST}:${config.REDIS_PORT}`;
const queueNames = ['PendingTx'];
const txQueue = new Queue(queueNames[0], REDIS_URL);

log.info('\n--Start MonitorWorker--\n'.blue);

// Access Token이 없을 경우에는 종료
if (!config.INFURA_ACCESS_TOKEN) {
  log.error('Error: "ACCESS_TOKEN" for infura.io is required.'.red);
  process.exit(1);
}

// const endpoint = `${config.ETH_ENDPOINT}/${config.INFURA_ACCESS_TOKEN}`;
// const web3 = new Web3(new Web3.providers.HttpProvider(endpoint));

const endpoint = `${config.ETH_WS_ENDPOINT}/${config.INFURA_ACCESS_TOKEN}`;
const web3 = new Web3(new Web3.providers.WebsocketProvider(endpoint));

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
  // Todo: Job Clear, Read txs from database, Add Queue
};

const updateRequest = async (body) => {
  let tzDate = new Date(Date.now() - (new Date().getTimezoneOffset() * 60000));
  body.modifiedAt = tzDate.toISOString().slice(0, 19).replace('T', ' ');
  return await axios.put(
    `${config.NODESERVER_URL}/api/tx/${body.txid}`,
    body);
};

const txSuccess = async (tx) => {
  return new Promise(async (resolve, reject) => {
    if (!tx.blockNumber) {
      return reject(new Error(`Transaction(${tx.hash}) is not blocked!`));
    }
    log.info(`Transaction(${tx.hash}) was confirmed!(BlockNumber: ${tx.blockNumber})`);

    try {
      await updateRequest({
        txid: tx.hash,
        status: STATUS.COMPLETE,
        memo: `blockNumber: ${tx.blockNumber}`
      });
    } catch(err) {
      reject(err);
    };
    resolve(tx);
  });
};

const monitorJob = async (job, done) => {
  log.info(`\nWatching transaction(${job.data.txid})...\n`.blue)
  if (!await isConnected()) {
    if (!await isConnected()) {
      let errmsg = `Connection error with infura.(${endpoint})`
      log.error(`Error: ${errmsg}`.red);
      return done(new Error(`{ error: ${errmsg} }`));
    }
  }
  const txn = await web3.eth.getTransaction(job.data.txid)
  if (txn.blockNumber) {
    try {
      await txSuccess(txn);
    } catch (error) {
      log.error(error);
      return done(error);
    }
    return done();
  }

  const subscription = web3.eth.subscribe('newBlockHeaders')
  subscription.on("error", (error) => {
    log.error(error);
    return done(error);
  });
  subscription.on('data', async (blockHeader) => {
    log.info(`A new block was generated!(${blockHeader.number})`);
    const tx = await web3.eth.getTransaction(job.data.txid)
    if (tx.blockNumber) {
      try {
        await txSuccess(tx);
      } catch (error) {
        log.error(error);
        return done(error);
      }
      subscription.unsubscribe((error, success) => {
        if (error) {
          log.error(error);
        }
        return done();
      });
    }
  });
};

const main = async () => {
  if (!await isConnected()) {
    log.error(`Connection error with infura.(${endpoint})`.red);
    process.exit(1);
  }
  log.info('Connection is Successed.');

  await initJob();

  log.info('\nStart watching pendingTx Queue...'.blue);
  txQueue.process(monitorJob);
}

main();
