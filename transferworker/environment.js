const environment = {
  common: {
    REDIS_PORT: process.env.REDIS_PORT || 6379,
    REDIS_HOST: process.env.REDIS_HOST || 'redis',
    INFURA_ACCESS_TOKEN: process.env.INFURA_ACCESS_TOKEN || 'fdc0ff2dab784f86a794b4ec72f73e36',
    GASPRICE_GET_SECONDS: 3600,
    NODESERVER_URL: 'http://nodeserver:50080'
  },
  development: {
    CHAIN: 'ropsten',
    ETH_ENDPOINT: 'https://ropsten.infura.io/v3',
    ETH_WS_ENDPOINT: 'wss://ropsten.infura.io/ws/v3',
    FEE_LEVEL: 'high',
  },
  production: {
    CHAIN: 'mainnet',
    ETH_ENDPOINT: 'https://mainnet.infura.io/v3',
    ETH_WS_ENDPOINT: 'wss://mainnet.infura.io/ws/v3',
    FEE_LEVEL: 'low',
  }
}

const nodeEnv = process.env.NODE_ENV || 'development';

module.exports = Object.assign(environment['common'], environment[nodeEnv]);
