const Queue = require('bull'),
      Web3 = require('web3'),
      Tx = require('ethereumjs-tx').Transaction,
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
const queueNames = ['RequestTx', 'PendingTx'];

const reqQueue = new Queue(queueNames[0], REDIS_URL);
const txQueue = new Queue(queueNames[1], REDIS_URL);

log.info('\n--Start TransferWorker--\n'.blue);

// Access Token이 없을 경우에는 종료
if (!config.INFURA_ACCESS_TOKEN) {
  log.error('message: "ACCESS_TOKEN" for infura.io is required.'.red);
  process.exit(1);
}

// const endpoint = `${config.ETH_ENDPOINT}/${config.INFURA_ACCESS_TOKEN}`;
// const web3 = new Web3(new Web3.providers.HttpProvider(endpoint));

const endpoint = `${config.ETH_WS_ENDPOINT}/${config.INFURA_ACCESS_TOKEN}`;
const web3 = new Web3(new Web3.providers.WebsocketProvider(endpoint));

log.info(`Ethereum Endpoint is ${endpoint}`);

let gasPrices = {};

/*
* GasPrice를 GasStation에서 가져온다.
* low, medium, high로 분류되어 가져온다.
*/
const getCurrentGasPrices = async () => {
  log.info('Getting gas price from https://ethgasstation.info'.blue);

  let response = await axios.get('https://ethgasstation.info/json/ethgasAPI.json')
  gasPrices = {
    time: Date.now(),
    low: response.data.safeLow / 10,
    medium: response.data.average / 10,
    high: response.data.fast / 10
  }
  log.green(gasPrices);
};

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

/*
* Private Key를 가져온다.
*/
const getPrivateKey = () => {
  return Buffer.from(
    config.PRIVATE_KEY,
    'hex',
  );
};

const updateRequest = async (body) => {
  let tzDate = new Date(Date.now() - (new Date().getTimezoneOffset() * 60000));
  body.modifiedAt = tzDate.toISOString().slice(0, 19).replace('T', ' ');
  return await axios.put(
    `${config.NODESERVER_URL}/api/request/${body.no}`,
    body);
};

const writeError = async (dbid, message) => {
  let body = {
    no: dbid,
    memo: message,
    status: STATUS.ERROR
  };

  return await updateRequest(body);
};

/*
* Transaction을 전송하는 Job
*/
const transferJob = async (job, done) => {
  log.info(`\nStart a new transfer job!! [id:${job.id}]\n`.blue);
  log.green(job.data)

  // 한번의 재접속에도 오류가 발생하면 종료.
  if (!await isConnected()) {
    if (!await isConnected()) {
      let errmsg = `Connection error with infura.(${endpoint})`;
      return done(new Error(`{ message: ${errmsg} }`));
    }
  }

  try {
    let res = await updateRequest({
      no: job.data.dbid,
      status: STATUS.PREPARE
    });

    // config.GASPRICE_GET_SECONDS 의 시간이 지나면 GasPrice를 가져옴
    if (!Object.keys(gasPrices).length || (Date.now()-gasPrices['time']) / 1000 > config.GASPRICE_GET_SECONDS) {
      await getCurrentGasPrices();
    } else {
      log.info(`GasPrice is cached.(gasprice: ${gasPrices[config.FEE_LEVEL]})`);
    }

    // 지갑의 Balance를 체크한다. Fee와 전송할 금액보다 적으면 오류
    let walletBalanceWei = await web3.eth.getBalance(job.data.fromAddress);
    let walletBalance = web3.utils.fromWei(walletBalanceWei, 'ether');
    let fee = web3.utils.fromWei(String(gasPrices[config.FEE_LEVEL]*21000), 'gwei');

    log.green(
      `balance: ${walletBalance}\n`,
      `send: ${job.data.value}\n`,
      `fee:${fee}\n`,
    );

    if (Number(walletBalance) < Number(job.data.value) + Number(fee)) {
      let errmsg = 'Balance is too low.';
      return done(new Error(`{ message: ${errmsg} }`));
    }

    // Nonce값을 가져온다. Block이 되지 않고 Pending된 TX까지 계산함.
    let nonce = await web3.eth.getTransactionCount(job.data.fromAddress, 'pending');

    let rawTx = {
      "to": job.data.toAddress,
      "value": web3.utils.toHex( web3.utils.toWei(job.data.value, 'ether') ),
      "gas": 21000,
      "gasPrice": gasPrices[config.FEE_LEVEL] * 1000000000,
      "nonce": nonce,
    }

    // Private를 가져와서 올바른지 확인함
    const privateKey = getPrivateKey();
    const acc = web3.eth.accounts.privateKeyToAccount(privateKey.toString('hex'));
    if (acc.address !== job.data.fromAddress) {
      let errmsg = `Private Key is wrong!(address: ${job.data.fromAddress})`;
      return done(new Error(`{ message: ${errmsg} }`));
    }
    log.info(`PrivateKey is validate.\n`);

    log.info(`Chain: ${config.CHAIN}`.blue);
    log.info('Raw Transaction');
    log.info(rawTx);

    // Transaction을 생성해 Sign하고 전송함. TXID가 생성되면 Job이 종료한다.
    const tx = new Tx(rawTx, { chain: config.CHAIN, hardfork: 'petersburg' });
    tx.sign(privateKey);
    const serializedTx = tx.serialize();
    web3.eth.sendSignedTransaction('0x' + serializedTx.toString('hex'))
    .on('transactionHash', async (txid) => {
      return done(null, { txid: txid });
    })
    // .on('receipt', (receipt) => {
    //   console.log("Success: ", receipt);
    //   return done(null, { receipt: receipt });
    // })
    .on('error', async (error) => {
      return done(error);
    });
  } catch (error) {
    return done(error);
  }
};

const main = async () => {
  if (!await isConnected()) {
    log.error(`Connection error with infura.(${endpoint})`.red);
    process.exit(1);
  }

  log.info('Connection is Successed.');

  await getCurrentGasPrices();

  log.info('\nStart watching requestTX Queue...'.blue);

  reqQueue.process(transferJob);

  reqQueue.on('completed', async (job, result) => {
    log.info('\nTransaction is successed.'.blue);
    let tx = Object.assign(result, job.data);

    // DB에 상태를 업데이트하기 위해서 API를 호출한다.
    await updateRequest({
      no: tx.dbid,
      status: STATUS.PENDING,
      txid: tx.txid,
      memo: ""
    });

    // Transaction을 pendingTx Queue에 넣어 MonitorWorker가 상태를 감시할 수 있도록 한다.
    await txQueue.add(tx);

    // Todo: Slack에 메시지 전달

    log.info('Result:')
    log.green(tx);
  });

  reqQueue.on('failed', async (job, err) =>{
    // DB에 상태를 업데이트하기 위해서 API를 호출한다.
    await writeError(job.data.dbid, err.message);
    // Todo: Slack에 메시지 전달

    log.red(job.data);
    log.red(err);
  });
}

main();
