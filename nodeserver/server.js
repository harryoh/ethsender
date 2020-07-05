'use strict';

const express = require('express'),
      bodyParser = require('body-parser'),
      morgan = require('morgan'),
      Queue = require('bull'),
      Arena = require('bull-arena');

const config = require('./environment');

const app = express();
const REDIS_URL = `redis://${config.REDIS_HOST}:${config.REDIS_PORT}`;
const queueNames = ['SendRequest', 'SendTx'];

const reqQueue = new Queue(queueNames[0], REDIS_URL);
const txQueue = new Queue(queueNames[1], REDIS_URL);

app.use(morgan('dev'));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(require('method-override')());

const port = process.env.PORT || 50080;

var router = express.Router();
router.use((req, res, next) => {
  // Log
  // console.log(req.host, req.port, req.url);
  next();
});

router.get('/', (req, res) => {
  res.json({ message: 'Hello, World!' });
});


// const sampleData = [
//   {
//     "dbid": "1",
//     "fromAddress": "11111",
//     "toAddress": "222222",
//     "balance": "0.1"
//   }, {
//     "dbid": "2",
//     "fromAddress": "11111",
//     "toAddress": "222222",
//     "balance": "0.1"
//   }, {
//     "dbid": "3",
//     "fromAddress": "11111",
//     "toAddress": "222222",
//     "balance": "0.1"
//   }
// ]

router.route('/job')
  .get((req, res) => {
    res.json({ message: 'get id:' + req.params.id });
  })

  .post(async (req, res) => {
    let job;
    let joblist=[];
    if (!req.body.length) {
      return res.json(500, {
        message: 'Error: Data format are wrong!'
      })
    }

    for (var i=0; i<req.body.length; i++) {
      job = await reqQueue.add(req.body[i]);
      joblist.push(job.id);
    }

    res.json({
      message: `create new queues(len: ${req.body.length})`,
      joblist: joblist.toString(),
      data: req.body
    });
  })

app.use('/api', router);

const arena = Arena({
  queues: queueNames.map(q => ({
      name: q,
      hostId: 'redis',
      redis: {
        port: config.REDIS_PORT,
        host: config.REDIS_HOST
      }
  })),
}, {
  basePath: '/arena',
  disableListen: true
});

app.use('/', arena);

var server = app.listen( port, () => {
  console.log('Listening on port ' + server.address().port);
});
