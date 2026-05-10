#!/bin/bash

# Create project directory
mkdir -p ~/powercut-aggregator
cd ~/powercut-aggregator

# Initialize Git
git init
git config user.name "Mark Haworth"
git config user.email "mark@willowhey.net"

# Create package.json
cat > package.json << 'EOF'
{
  "name": "powercut-aggregator",
  "version": "1.0.0",
  "description": "UK Power Cut Aggregator - aggregates power outages from all 14 DNOs",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node server.js"
  },
  "keywords": ["power", "outages", "uk", "dno"],
  "author": "Mark Haworth",
  "license": "MIT"
}
EOF

# Create server.js
cat > server.js << 'EOF'
const http = require('http');

const hostname = '0.0.0.0';
const port = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Power Cut Aggregator</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
          h1 { color: #333; }
          .status { background: #4CAF50; color: white; padding: 10px; border-radius: 5px; display: inline-block; }
        </style>
      </head>
      <body>
        <h1>Power Cut Aggregator</h1>
        <p class="status">✓ Hello World - Server is running!</p>
        <p>UK Power Outage Monitoring System</p>
        <p><small>Created: ${new Date().toISOString()}</small></p>
      </body>
    </html>
  `);
});

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
  console.log(`Press Ctrl+C to stop`);
});
EOF

# Create README.md
cat > README.md << 'EOF'
# Power Cut Aggregator

A Node.js web application that aggregates power cut notifications from all 14 UK Distribution Network Operators (DNOs) into a single unified interface.

## Overview

Rather than checking each DNO's individual website, this application pulls official power outage data from all UK DNOs and displays them on one map/dashboard.

## Getting Started

### Prerequisites
- Node.js 16+
- npm

### Installation

```bash
npm install
```

### Running Locally

```bash
npm start
```

The server will run on `http://localhost:3000`

## Deployment

This project is set up for automatic deployment via GitHub to Hostinger.

## License

MIT
EOF

# Create .gitignore
cat > .gitignore << 'EOF'
node_modules/
.env
.env.local
*.log
npm-debug.log*
.DS_Store
EOF

# Add files to git
git add .

# Create initial commit
git commit -m "Initial commit: Hello World server"

# Add remote and push
git remote add origin git@github.com:fushtik/powercut-aggregator.git
git branch -M main
git push -u origin main

echo "✓ Project created and pushed to GitHub!"
echo "Repository: https://github.com/fushtik/powercut-aggregator"
