const environment = {
  common: {
    REDIS_PORT: process.env.REDIS_PORT || 6379,
    REDIS_HOST: process.env.REDIS_HOST || 'redis',
    DB: {
      host: 'db',
      port: 3306,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE
    }
  },
  development: {
  },
  production: {
  }
}

const nodeEnv = process.env.NODE_ENV || 'development';

module.exports = Object.assign(environment['common'], environment[nodeEnv]);
