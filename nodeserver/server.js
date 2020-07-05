'use strict';

const express    = require('express');
const bodyParser = require('body-parser');
const morgan     = require('morgan');
const config     = require('./environment');
const app        = express();

app.use(morgan('dev'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const port = process.env.PORT || 50080;

var router = express.Router();
router.use((req, res, next) => {
  // Log
  // console.log(req.host, req.port, req.url);
  console.log(config.REDIS_HOST)
  next();
});

router.get('/', (req, res) => {
  res.json({ message: 'Hello, World!' });
});

router.route('/q')
  // .post((req, res) => {
  //   var bear = new Bear();
  //   bear.name = req.body.name;

  //   bear.save(function(err) {
  //     if (err)
  //       res.send(err);

  //     res.json({ message: 'Bear created!' });
  //   });
  // })

  .get((req, res) => {
    res.json({ message: 'q list' });
  });

const Queue      = require('bull');
const reqQueue = new Queue('SendRequest', `redis://${config.REDIS_HOST}:6379`);

router.route('/job')
  .get((req, res) => {
    res.json({ message: 'get id:' + req.params.id });
  })

  .post(async (req, res) => {
    const job = await reqQueue.add(req.body);
    console.log(job);
    res.json({
      message: `create new queue(id:${job.id})`,
      data: job.data
    });
  })

app.use('/api', router);

app.listen(port);
console.log('Magic happens on port ' + port);
