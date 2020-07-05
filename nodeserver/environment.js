const environment = {
  common: {
    REDIS_PORT: process.env.REDIS_PORT || 6379,
    REDIS_HOST: process.env.REDIS_HOST || 'redis'
  },
  development: {
  },
  production: {
  }
}

const nodeEnv = process.env.NODE_ENV || 'development';

module.exports = Object.assign(environment['common'], environment[nodeEnv]);
