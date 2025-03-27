# p4r4sail

## Overview
This tool is a customized, enhanced version of the p4r4sail Node Bot designed to efficiently manage multiple p4r4sail network nodes with proxy support. It focuses on automation, stability, and scalability for users managing multiple accounts.

## Key Features
- **Multi-Account Support**: Manage an unlimited number of p4r4sail nodes from a single instance
- **Proxy Integration**: Each account can be assigned a dedicated proxy to prevent IP restrictions
- **Advanced Logging**: Colored, timestamped logs with both console and file output
- **Automated Check-ins**: Regular 24-hour check-ins for each account
- **Error Resilience**: Robust error handling and automatic recovery

## Requirements
- Node.js v14 or higher
- Ethereum wallet private keys
- HTTP proxies (optional but recommended)
- Internet connection

## Installation

```bash
# Clone the repository
git clone https://github.com/Usernameusernamenotavailbleisnot/p4r4sail.git
cd p4r4sail

# Install dependencies
npm install
```

## Configuration

### Private Keys Setup
Create a `pk.txt` file in the project root folder:
```
# Format: One private key per line
# Comments start with #
0x123abc...
0x456def...
0xaabbcc...
```

### Proxy Setup
Create a `proxy.txt` file in the project root folder:
```
# Format: user:password@ip:port
# One proxy per line
user1:pass1@192.168.1.1:8080
user2:pass2@192.168.1.2:8080
```

## Usage

```bash
# Start the application
npm start

# To run in background with PM2
pm2 start index.js --name p4r4sail
```

## How It Works
1. The application reads all private keys and proxies from their respective files
2. Each private key is paired with a proxy (if available)
3. For each pair, a separate bot instance is created
4. Each bot:
   - Verifies the wallet
   - Onboards the node
   - Performs check-ins
   - Schedules regular 24-hour check-ins
   - Logs all activities

## Fault Tolerance
- Automatic token refresh when expired
- Proxy error handling
- Process termination handling
- Comprehensive error logging

## Dependencies
- `axios`: HTTP client for API requests
- `ethers`: Ethereum wallet interactions
- `winston`: Advanced logging system
- `https-proxy-agent`: Proxy support for requests

## Disclaimer
This tool is provided as-is without any warranties. Use at your own risk and responsibility. Always review code before running it on your system.

## License
MIT License
