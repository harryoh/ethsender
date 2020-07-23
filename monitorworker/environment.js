const environment = {
  common: {
    REDIS_PORT: process.env.REDIS_PORT || 6379,
    REDIS_HOST: process.env.REDIS_HOST || 'redis',
    INFURA_ACCESS_TOKEN: process.env.INFURA_ACCESS_TOKEN,
    NODESERVER_URL: 'http://nodeserver:50080',
    QUEUE_RELOAD_SECONDS: 3600
  },
  development: {
    CHAIN: 'ropsten',
    ETH_ENDPOINT: 'https://ropsten.infura.io/v3',
    ETH_WS_ENDPOINT: 'wss://ropsten.infura.io/ws/v3',
  },
  production: {
    CHAIN: 'mainnet',
    ETH_ENDPOINT: 'https://mainnet.infura.io/v3',
    ETH_WS_ENDPOINT: 'wss://mainnet.infura.io/ws/v3',
  }
}

const nodeEnv = process.env.NODE_ENV || 'development';

module.exports = Object.assign(environment['common'], environment[nodeEnv]);
