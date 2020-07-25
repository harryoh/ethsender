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
* Ether Node와 연결이 되어 있는지 확인
* 연결이 안되어 있으면 다시 한번 연결
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

// DB에 시간을 저장할 때에 Timezone이 적용되어 있는 시간을 저장
const getDataTime = () => {
  let tzDate = new Date(Date.now() - (new Date().getTimezoneOffset() * 60000));
  return tzDate.toISOString().slice(0, 19).replace('T', ' ');
};

// TX의 상태값을 변경
const updateRequest = async (body) => {
  // body.modifiedAt = getDataTime();
  return await axios.put(
    `${config.NODESERVER_URL}/api/tx/${body.txid}`,
    body);
};

// Transaction이 Confirm이 났을때 처리
const txSuccess = async (tx) => {
  return new Promise(async (resolve, reject) => {
    if (!tx || !tx.blockNumber) {
      return reject(new Error(`Transaction(${tx.hash}) is not blocked!`));
    }
    log.info(`Transaction(${tx.hash}) was confirmed!(BlockNumber: ${tx.blockNumber})`);

    try {
      await updateRequest({
        txid: tx.hash,
        status: STATUS.COMPLETE,
        memo: `blockNumber: ${tx.blockNumber}`,
        completedAt: getDataTime()
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

  // 감시할 TX가 들어왔을 때, 먼저 해당 TX의 상태를 확인하고 만약 이미 Block에 포함되었다면 바로 처리
  const txn = await web3.eth.getTransaction(job.data.txid);
  if (txn && txn.blockNumber) {
    try {
      await txSuccess(txn);
    } catch (error) {
      return done(error);
    }
    return done();
  }

  // 새로운 블록이 들어왔을때에 실행
  const subscription = web3.eth.subscribe('newBlockHeaders')
  subscription.on("error", (error) => {
    log.error(error);
    return done(error);
  });
  subscription.on('data', async (blockHeader) => {
    log.info(`A new block was generated!(${blockHeader.number})`);

    // 새로운 Block에 감시할 TX가 포함되었는지 확인
    const tx = await web3.eth.getTransaction(job.data.txid)
    if (tx && tx.blockNumber) {
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

// Job을 초기화하고 Pending중인 TX의 정보를 가져와서 Queue에 넣는다.
// DB와 Queue간에 잘못된 정보가 존재할 경우 이로써 싱크를 맞춘다.
const initJob = async () => {
  log.info('Initialing Tx Monitoring Jobs...');
  try {
    let res = await axios.get(`${config.NODESERVER_URL}/api/tx/pending`);
    await txQueue.empty();

    for (let i=0; i < res.data.length; i++) {
      await txQueue.add({
        txid: res.data[i].txid,
        dbid: res.data[i].no,
        fromAddress: res.data[i].from_address,
        toAddress: res.data[i].to_address,
        value: res.data[i].coin
      });
    }
  } catch(err) {
    log.error(err);
  }
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

  // 주기적으로 initJob을 호출하여 문제의 여지를 해결함.
  if (config.QUEUE_RELOAD_SECONDS > 0) {
    setInterval(initJob, config.QUEUE_RELOAD_SECONDS*1000);
  }
}

main();
