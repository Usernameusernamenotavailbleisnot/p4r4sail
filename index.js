const axios = require('axios');
const fs = require('fs');
const path = require('path');
const ethers = require('ethers');
const winston = require('winston');
const { HttpsProxyAgent } = require('https-proxy-agent');

// Retry configuration
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 2000; // Base delay in milliseconds

// Configure Winston logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.printf(info => `[${info.timestamp}] ${info.level}: ${info.message}`)
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.printf(info => `[${info.timestamp}] ${info.level}: ${info.message}`)
      )
    }),
    new winston.transports.File({ 
      filename: 'parasail-bot.log',
      format: winston.format.combine(
        winston.format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.printf(info => `[${info.timestamp}] ${info.level}: ${info.message}`)
      )
    })
  ]
});

class ParasailNodeBot {
  constructor(privateKey, proxy) {
    this.privateKey = privateKey;
    this.proxy = proxy;
    this.proxyAgent = this.createProxyAgent(proxy);
    this.baseUrl = 'https://www.parasail.network/api';
    this.walletAddress = null;
    this.bearerToken = null;
  }

  createProxyAgent(proxyString) {
    if (!proxyString) return null;
    
    try {
      // Format is user:pw@ip:port
      const [auth, host] = proxyString.split('@');
      const [username, password] = auth.split(':');
      const [ip, port] = host.split(':');
      
      const proxyUrl = `http://${username}:${password}@${ip}:${port}`;
      return new HttpsProxyAgent(proxyUrl);
    } catch (error) {
      logger.error(`Invalid proxy format: ${proxyString}. Error: ${error.message}`);
      return null;
    }
  }

  async generateSignature() {
    const wallet = new ethers.Wallet(this.privateKey);
    this.walletAddress = wallet.address;
    
    const message = `By signing this message, you confirm that you agree to the Parasail Terms of Service.

Parasail (including the Website and Parasail Smart Contracts) is not intended for:
(a) access and/or use by Excluded Persons;
(b) access and/or use by any person or entity in, or accessing or using the Website from, an Excluded Jurisdiction.

Excluded Persons are prohibited from accessing and/or using Parasail (including the Website and Parasail Smart Contracts).

For full terms, refer to: https://parasail.network/Parasail_User_Terms.pdf`;
    
    const signature = await wallet.signMessage(message);
    return {
      address: wallet.address,
      msg: message,
      signature
    };
  }

  async verifyUser(retryCount = 0) {
    try {
      const signatureData = await this.generateSignature();
      
      logger.info(`Attempting verification for address: ${signatureData.address}`);
      
      const response = await axios.post(`${this.baseUrl}/user/verify`, signatureData, {
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Content-Type': 'application/json'
        },
        httpsAgent: this.proxyAgent
      });

      this.bearerToken = response.data.token;
      logger.info('User verification successful');
      return response.data;
    } catch (error) {
      if (error.response) {
        logger.error(`Verification Error Details: Status: ${error.response.status}`);
        logger.error(`Data: ${JSON.stringify(error.response.data)}`);
      } else if (error.request) {
        logger.error(`No response received: ${error.request}`);
      } else {
        logger.error(`Error setting up request: ${error.message}`);
      }
      
      // Retry logic with exponential backoff
      if (retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
        logger.warn(`Retrying verification in ${delay}ms... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.verifyUser(retryCount + 1);
      }
      
      logger.error(`Max retries reached for verification. Giving up.`);
      throw error;
    }
  }

  async getNodeStats(retryCount = 0) {
    try {
      const response = await axios.get(`${this.baseUrl}/v1/node/node_stats`, {
        params: { address: this.walletAddress },
        headers: {
          'Authorization': `Bearer ${this.bearerToken}`,
          'Accept': 'application/json, text/plain, */*'
        },
        httpsAgent: this.proxyAgent
      });
      
      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 401) {
        logger.info('Token expired. Attempting to refresh...');
        await this.verifyUser();
        return this.getNodeStats();
      }

      if (error.response) {
        logger.error(`Node Stats Error: Status: ${error.response.status}`);
        logger.error(`Data: ${JSON.stringify(error.response.data)}`);
      } else {
        logger.error(`Failed to fetch node stats: ${error.message}`);
      }
      
      // Retry logic with exponential backoff for network errors and 5xx errors
      const isRetryable = !error.response || (error.response && error.response.status >= 500);
      if (isRetryable && retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
        logger.warn(`Retrying get node stats in ${delay}ms... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.getNodeStats(retryCount + 1);
      }
      
      if (retryCount >= MAX_RETRIES) {
        logger.error(`Max retries reached for getting node stats. Giving up.`);
      }
      
      throw error;
    }
  }

  async checkIn(retryCount = 0) {
    try {
      const checkInResponse = await axios.post(
        `${this.baseUrl}/v1/node/check_in`, 
        { address: this.walletAddress },
        {
          headers: {
            'Authorization': `Bearer ${this.bearerToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*'
          },
          httpsAgent: this.proxyAgent
        }
      );

      logger.info('Node check-in successful');
      return checkInResponse.data;
    } catch (error) {
      if (error.response && error.response.status === 401) {
        logger.info('Token expired. Attempting to refresh...');
        await this.verifyUser();
        return this.checkIn();
      }
      
      if (error.response) {
        logger.error(`Check-in Error: Status: ${error.response.status}`);
        logger.error(`Data: ${JSON.stringify(error.response.data)}`);
      } else {
        logger.error(`Check-in error: ${error.message}`);
      }
      
      // Retry logic with exponential backoff for network errors and 5xx errors
      const isRetryable = !error.response || (error.response && error.response.status >= 500);
      if (isRetryable && retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
        logger.warn(`Retrying check-in in ${delay}ms... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.checkIn(retryCount + 1);
      }
      
      if (retryCount >= MAX_RETRIES) {
        logger.error(`Max retries reached for check-in. Giving up.`);
      }
      
      throw error;
    }
  }

  async onboardNode(retryCount = 0) {
    try {
      const response = await axios.post(`${this.baseUrl}/v1/node/onboard`, 
        { address: this.walletAddress },
        {
          headers: {
            'Authorization': `Bearer ${this.bearerToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*'
          },
          httpsAgent: this.proxyAgent
        }
      );

      logger.info('Node onboarding successful');
      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 401) {
        logger.info('Token expired. Attempting to refresh...');
        await this.verifyUser();
        return this.onboardNode();
      }
      
      if (error.response) {
        logger.error(`Onboarding Error: Status: ${error.response.status}`);
        logger.error(`Data: ${JSON.stringify(error.response.data)}`);
      } else {
        logger.error(`Onboarding error: ${error.message}`);
      }
      
      // Retry logic with exponential backoff for network errors and 5xx errors
      const isRetryable = !error.response || (error.response && error.response.status >= 500);
      if (isRetryable && retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
        logger.warn(`Retrying onboarding in ${delay}ms... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.onboardNode(retryCount + 1);
      }
      
      if (retryCount >= MAX_RETRIES) {
        logger.error(`Max retries reached for onboarding. Giving up.`);
      }
      
      throw error;
    }
  }

  logNodeStats(stats) {
    logger.info('Node Statistics:');
    logger.info(`Has Node: ${stats.data.has_node ? 'Yes' : 'No'}`);
    logger.info(`Node Address: ${stats.data.node_address}`);
    logger.info(`Points: ${stats.data.points}`);
    logger.info(`Pending Rewards: ${stats.data.pending_rewards || 'None'}`);
    logger.info(`Total Distributed: ${stats.data.total_distributed || 'None'}`);
    logger.info(`Last Check-in: ${stats.data.last_checkin_time 
      ? new Date(stats.data.last_checkin_time * 1000).toLocaleString() 
      : 'N/A'}`);
    logger.info(`Card Count: ${stats.data.card_count}`);
  }

  async performRoutineTasks() {
    try {
      await this.onboardNode();
      await this.checkIn();
      
      const stats = await this.getNodeStats();
      this.logNodeStats(stats);
      
      // Schedule next check-in after 24 hours
      logger.info(`Next check-in scheduled in 24 hours`);
    } catch (error) {
      logger.error(`Routine tasks failed: ${error.message}`);
    }
  }

  async start() {
    logger.info(`Starting Parasail Node Bot for address: ${this.walletAddress || 'Unknown'}`);
    logger.info(`Using proxy: ${this.proxy ? 'Yes' : 'No'}`);
    
    try {
      await this.verifyUser();
      logger.info(`Wallet Address: ${this.walletAddress}`);

      await this.performRoutineTasks();
      
      // Setup interval for daily check-ins (24 hours)
      setInterval(() => {
        logger.info('Running scheduled check-in');
        this.performRoutineTasks().catch(error => {
          logger.error(`Scheduled check-in failed: ${error.message}`);
        });
      }, 24 * 60 * 60 * 1000);
      
    } catch (error) {
      logger.error(`Initialization failed: ${error.message}`);
    }
  }
}

function readFileLines(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      logger.error(`File not found: ${filePath}`);
      return [];
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  } catch (error) {
    logger.error(`Error reading file ${filePath}: ${error.message}`);
    return [];
  }
}

async function main() {
  logger.info('Starting Parasail Node Bot - Multiple Account Mode');
  
  // Read private keys and proxies
  const privateKeysPath = path.resolve('./pk.txt');
  const proxiesPath = path.resolve('./proxy.txt');
  
  const privateKeys = readFileLines(privateKeysPath);
  const proxies = readFileLines(proxiesPath);
  
  if (privateKeys.length === 0) {
    logger.error('No private keys found in pk.txt. Exiting.');
    process.exit(1);
  }
  
  logger.info(`Found ${privateKeys.length} private keys`);
  logger.info(`Found ${proxies.length} proxies`);
  
  // Create bot instances
  const bots = [];
  
  for (let i = 0; i < privateKeys.length; i++) {
    const privateKey = privateKeys[i];
    // Assign a proxy if available, otherwise null
    const proxy = i < proxies.length ? proxies[i] : null;
    
    if (!proxy) {
      logger.warn(`No proxy available for private key at index ${i}. Running without proxy.`);
    }
    
    const bot = new ParasailNodeBot(privateKey, proxy);
    bots.push(bot);
  }
  
  // Start all bots with some delay between them
  for (let i = 0; i < bots.length; i++) {
    logger.info(`Starting bot ${i+1} of ${bots.length}`);
    
    try {
      // Stagger the starts to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, i * 5000));
      await bots[i].start();
    } catch (error) {
      logger.error(`Failed to start bot ${i+1}: ${error.message}`);
    }
  }
}

// Handle process termination
process.on('SIGINT', () => {
  logger.info('Received SIGINT. Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM. Shutting down...');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught exception: ${error.message}`);
  logger.error(error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise);
  logger.error('Reason:', reason);
});

main().catch(error => {
  logger.error('Main error:', error);
});
